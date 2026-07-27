import { format } from "https://deno.land/std@0.205.0/datetime/mod.ts";
import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { z } from "https://deno.land/x/zod@v3.21.4/mod.ts";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsHeaders } from "../lib/headers.ts";
import { getFunctionLogger } from "../lib/logging.ts";
import { requirePermissions } from "../lib/supabase.ts";
import { Database } from "../lib/types.ts";
import { getCurrentAccountingPeriod } from "../shared/get-accounting-period.ts";
import { getDefaultPostingGroup } from "../shared/get-posting-group.ts";
import {
  AdjustmentItemCost,
  bookAdjustment,
  createAdjustmentJournal,
} from "../shared/post-adjustment.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);
const logger = getFunctionLogger("post-nonconformance");

// The GL/cost posting path for inspection-reject and NCR-disposition inventory
// write-offs. The caller (inspection reject route / closeIssue) owns the
// physical/status side — tracked-entity flips, nonConformance.status — and hands
// this function a batch of explicit SIGNED movements. In ONE transaction each
// movement books through the shared core: item ledger + cost layers + (when
// companySettings.accountingEnabled) a balanced journal against the company's
// scrapAccount (offset), one shared journal per call. Scrap / Return post a
// Negative Adjmt. (Dr Scrap / Cr Inventory + relieve layers); a kept lot's
// restore posts a Positive Adjmt. (Dr Inventory / Cr Scrap + create a layer).
const payloadValidator = z.object({
  companyId: z.string(),
  userId: z.string(),
  // Drives both the itemLedger/costLedger documentType and the journal
  // sourceType — 'Non-Conformance' for a disposition close, 'Inbound Inspection'
  // for an inspection reject.
  documentType: z.enum(["Non-Conformance", "Inbound Inspection"]),
  documentId: z.string(),
  description: z.string().optional().nullable(),
  postingDate: z.string().optional().nullable(),
  movements: z
    .array(
      z.object({
        itemId: z.string(),
        locationId: z.string().optional().nullable(),
        trackedEntityId: z.string().optional().nullable(),
        // SIGNED: < 0 removes value (scrap/return), > 0 restores value (kept).
        quantity: z.number(),
        comment: z.string().optional().nullable(),
      })
    )
    .min(1),
});

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    const {
      companyId,
      userId,
      documentType,
      documentId,
      description,
      postingDate: providedPostingDate,
      movements,
    } = payloadValidator.parse(payload);

    const client = await requirePermissions(req, companyId, userId, {
      update: "quality",
    });

    const postingDate = providedPostingDate || format(new Date(), "yyyy-MM-dd");

    // Only movements that actually move stock post anything.
    const effectiveMovements = movements.filter((m) => m.quantity !== 0);
    if (effectiveMovements.length === 0) {
      return new Response(JSON.stringify({ success: true, journalId: null }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const itemIds = [...new Set(effectiveMovements.map((m) => m.itemId))];

    const [itemsResult, itemCostsResult, accountingSettings] =
      await Promise.all([
        client
          .from("item")
          .select("id, itemTrackingType, replenishmentSystem")
          .in("id", itemIds)
          .eq("companyId", companyId),
        client
          .from("itemCost")
          .select("itemId, costingMethod, unitCost, standardCost, itemPostingGroupId")
          .in("itemId", itemIds)
          .eq("companyId", companyId),
        client
          .from("companySettings")
          .select("accountingEnabled")
          .eq("id", companyId)
          .single(),
      ]);

    if (itemsResult.error) throw new Error("Failed to fetch items");
    if (itemCostsResult.error) throw new Error("Failed to fetch item costs");
    if (accountingSettings.error) {
      throw new Error("Failed to fetch company settings");
    }

    // The generated types are deep enough that a multi-row .select() infers as
    // {} here; type the projected rows explicitly (the reference sidesteps this
    // via .single()).
    type NcItemRow = {
      id: string;
      itemTrackingType: string | null;
      replenishmentSystem:
        | Database["public"]["Enums"]["itemReplenishmentSystem"]
        | null;
    };
    type NcItemCostRow = {
      itemId: string;
      costingMethod: Database["public"]["Enums"]["itemCostingMethod"];
      unitCost: number | null;
      standardCost: number | null;
      itemPostingGroupId: string | null;
    };
    const itemById = new Map<string, NcItemRow>(
      ((itemsResult.data ?? []) as NcItemRow[]).map((row) => [row.id, row])
    );
    const costByItem = new Map<string, NcItemCostRow>(
      ((itemCostsResult.data ?? []) as NcItemCostRow[]).map((row) => [
        row.itemId,
        row,
      ])
    );

    // The accountingEnabled flag gates ALL journal writes: when false the posting
    // core still moves the ledger + cost layers, just no journal. Fail closed —
    // a failed settings read must not silently post without GL.
    const accountingEnabled =
      accountingSettings.data?.accountingEnabled ?? false;
    const accountDefaults = accountingEnabled
      ? await getDefaultPostingGroup(client, companyId)
      : null;
    if (
      accountingEnabled &&
      (accountDefaults?.error || !accountDefaults?.data)
    ) {
      throw new Error("Error getting account defaults");
    }

    // Active dimensions for the company group — journal lines get
    // Item / ItemPostingGroup / Location tags (post-adjustment precedent).
    const dimensionMap: Record<string, string> = {};
    if (accountingEnabled) {
      const companyRecord = await client
        .from("company")
        .select("companyGroupId")
        .eq("id", companyId)
        .single();
      if (companyRecord.error) throw new Error("Failed to fetch company");
      const dimensions = await client
        .from("dimension")
        .select("id, entityType")
        .eq("companyGroupId", companyRecord.data.companyGroupId)
        .eq("active", true)
        .in("entityType", ["Item", "ItemPostingGroup", "Location"]);
      if (dimensions.error) throw new Error("Failed to fetch dimensions");
      for (const dim of dimensions.data ?? []) {
        if (dim.entityType) dimensionMap[dim.entityType] = dim.id;
      }
    }

    // Resolve the accounting period BEFORE opening the transaction —
    // getCurrentAccountingPeriod uses the REST client and calling it
    // mid-transaction parks the (size 1) pool in idle-in-transaction.
    const accountingPeriodId = accountingEnabled
      ? await getCurrentAccountingPeriod(client, companyId, db)
      : null;

    const journalDescription =
      description?.trim() ||
      (documentType === "Inbound Inspection"
        ? "Inbound Inspection write-off"
        : "Non-Conformance disposition");

    let journalId: string | null = null;

    await db.transaction().execute(async (trx) => {
      // Idempotent per (documentType, documentId): a reject posts one write-off
      // per inspection, a disposition close posts once per NCR (reopen is blocked
      // after posting). A retry after a partial route failure — e.g. the caller's
      // status/NCR step failed after this already committed — must not double-post.
      const alreadyPosted = await trx
        .selectFrom("itemLedger")
        .select("id")
        .where("companyId", "=", companyId)
        .where("documentType", "=", documentType)
        .where("documentId", "=", documentId)
        .limit(1)
        .executeTakeFirst();
      if (alreadyPosted) return;

      // One shared journal per call (per reject / per disposition close), a line
      // pair per movement — created lazily so an all-zero-value run posts none.
      const accounting =
        accountingEnabled && accountDefaults?.data && accountingPeriodId
          ? {
              accountingPeriodId,
              accountDefaults: {
                rawMaterialsAccount: accountDefaults.data.rawMaterialsAccount,
                finishedGoodsAccount: accountDefaults.data.finishedGoodsAccount,
                inventoryAdjustmentVarianceAccount:
                  accountDefaults.data.inventoryAdjustmentVarianceAccount,
              },
              // Cost of quality: offset to scrapAccount, falling back to the
              // variance account for companies whose scrapAccount is unset.
              offsetAccount:
                accountDefaults.data.scrapAccount ??
                accountDefaults.data.inventoryAdjustmentVarianceAccount,
              offsetDescription: "Scrap / Cost of Quality",
              sourceType: documentType,
              description: journalDescription,
              userId,
              dimensions: dimensionMap,
              getJournalId: async () => {
                if (!journalId) {
                  journalId = await createAdjustmentJournal(trx, {
                    companyId,
                    accountingPeriodId,
                    description: journalDescription,
                    postingDate,
                    userId,
                    sourceType: documentType,
                  });
                }
                return journalId;
              },
            }
          : null;

      for (const movement of effectiveMovements) {
        const itemRow = itemById.get(movement.itemId);
        if (!itemRow) throw new Error(`Item ${movement.itemId} not found`);
        const costRow = costByItem.get(movement.itemId);
        // Missing itemCost (rare) — post the ledger movement at zero value so a
        // disposition is never blocked; no journal results from a zero cost.
        const itemCost: AdjustmentItemCost = costRow
          ? {
              costingMethod: costRow.costingMethod,
              unitCost: costRow.unitCost,
              standardCost: costRow.standardCost,
            }
          : { costingMethod: "Average", unitCost: 0, standardCost: 0 };

        await bookAdjustment(trx, {
          ledger: {
            postingDate,
            itemId: movement.itemId,
            quantity: movement.quantity,
            locationId: movement.locationId ?? null,
            storageUnitId: null,
            trackedEntityId: movement.trackedEntityId ?? null,
            entryType:
              movement.quantity < 0 ? "Negative Adjmt." : "Positive Adjmt.",
            documentType,
            documentId,
            comment: movement.comment ?? null,
            companyId,
            createdBy: userId,
          },
          item: {
            itemTrackingType: itemRow.itemTrackingType,
            replenishmentSystem: itemRow.replenishmentSystem,
            itemPostingGroupId: costRow?.itemPostingGroupId ?? null,
          },
          itemCost,
          accounting,
        });
      }
    });

    return new Response(JSON.stringify({ success: true, journalId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    logger.error("post-nonconformance failed", {
      error: String((err as Error).stack ?? err),
    });
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
