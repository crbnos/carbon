import { format } from "https://deno.land/std@0.205.0/datetime/mod.ts";
import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { z } from "https://deno.land/x/zod@v3.21.4/mod.ts";
import { Transaction } from "kysely";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsHeaders } from "../lib/headers.ts";
import { getFunctionLogger } from "../lib/logging.ts";
import { requirePermissions } from "../lib/supabase.ts";
import type { Json } from "../lib/types.ts";
import { getCurrentAccountingPeriod } from "../shared/get-accounting-period.ts";
import { getDefaultPostingGroup } from "../shared/get-posting-group.ts";
import { bookAdjustment } from "../shared/post-adjustment.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);
const logger = getFunctionLogger("post-inventory-adjustment");

// The single write path for manual inventory adjustments (ERP quantities page,
// MES shop floor). Ports the former app-side insertManualInventoryAdjustment
// semantics — Set Quantity resolution, storage-unit transfers, serial/batch
// stock-target resolution, tracked-entity creation/updates — and books every
// movement through the shared posting core in ONE transaction: item ledger +
// cost layers + (when companySettings.accountingEnabled) a balanced journal
// against the inventory adjustment variance account. Storage-unit transfers
// move value-neutral stock and never post to the GL.
const payloadValidator = z.object({
  adjustmentType: z.enum(["Positive Adjmt.", "Negative Adjmt.", "Set Quantity"]),
  itemId: z.string(),
  locationId: z.string(),
  storageUnitId: z.string().optional().nullable(),
  trackedEntityId: z.string().optional().nullable(),
  // 0 is legal for Set Quantity (set to zero); a negative magnitude is never
  // valid — direction comes from adjustmentType, not the sign.
  quantity: z.number().min(0),
  readableId: z.string().optional().nullable(),
  originalStorageUnitId: z.string().optional().nullable(),
  expirationDate: z.string().optional().nullable(),
  comment: z.string().optional().nullable(),
  companyId: z.string(),
  userId: z.string(),
});

// Business-validation failures are 400s with the exact message the app routes
// string-match on; everything else is a 500 so real outages surface in
// monitoring. Body key is `message` so getEdgeFunctionErrorMessage can pull
// the real reason out of the response body.
class ValidationError extends Error {}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    const {
      adjustmentType,
      itemId,
      locationId,
      storageUnitId,
      trackedEntityId,
      quantity,
      readableId,
      originalStorageUnitId,
      expirationDate: providedExpirationDate,
      comment,
      companyId,
      userId,
    } = payloadValidator.parse(payload);

    const client = await requirePermissions(req, companyId, userId, {
      update: "inventory",
    });

    const today = format(new Date(), "yyyy-MM-dd");
    const nowIso = new Date().toISOString();

    const [
      storageUnitQuantities,
      itemResult,
      itemCostResult,
      accountingSettings,
      shelfLife,
    ] = await Promise.all([
      client.rpc("get_item_quantities_by_tracking_id", {
        item_id: itemId,
        company_id: companyId,
        location_id: locationId,
      }),
      client
        .from("item")
        .select("id, itemTrackingType, replenishmentSystem, readableIdWithRevision")
        .eq("id", itemId)
        .eq("companyId", companyId)
        .single(),
      client
        .from("itemCost")
        .select("costingMethod, unitCost, standardCost, itemPostingGroupId")
        .eq("itemId", itemId)
        .eq("companyId", companyId)
        .single(),
      client
        .from("companySettings")
        .select("accountingEnabled")
        .eq("id", companyId)
        .single(),
      client
        .from("itemShelfLife")
        .select("mode, days")
        .eq("itemId", itemId)
        .eq("companyId", companyId)
        .maybeSingle(),
    ]);

    if (itemResult.error) throw new Error("Failed to fetch item");
    if (itemCostResult.error) throw new Error("Failed to fetch item cost");
    // Fail closed: a failed quantity read must abort, not read as "no stock" —
    // a Set Quantity against an empty snapshot would post the full target as
    // new stock on top of whatever actually exists.
    if (storageUnitQuantities.error) {
      throw new Error("Failed to fetch current quantities");
    }
    if (shelfLife.error) throw new Error("Failed to fetch item shelf life");
    const item = {
      itemTrackingType: itemResult.data.itemTrackingType,
      replenishmentSystem: itemResult.data.replenishmentSystem,
      itemPostingGroupId: itemCostResult.data.itemPostingGroupId,
    };
    const itemCost = itemCostResult.data;

    // The accountingEnabled flag gates ALL journal writes: when false the
    // posting core receives accounting = null and books ledger + layers only.
    // Fail closed: a failed settings read must not silently post without GL.
    if (accountingSettings.error) {
      throw new Error("Failed to fetch company settings");
    }
    const accountingEnabled =
      accountingSettings.data?.accountingEnabled ?? false;
    const accountDefaults = accountingEnabled
      ? await getDefaultPostingGroup(client, companyId)
      : null;
    if (accountingEnabled && (accountDefaults?.error || !accountDefaults?.data)) {
      throw new Error("Error getting account defaults");
    }

    // Active dimensions for the company group (post-shipment precedent) —
    // journal lines get Item / ItemPostingGroup / Location tags.
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
      // Fail closed: journal lines must not silently lose dimension tags.
      if (dimensions.error) throw new Error("Failed to fetch dimensions");
      for (const dim of dimensions.data ?? []) {
        if (dim.entityType) dimensionMap[dim.entityType] = dim.id;
      }
    }
    // Resolve the accounting period BEFORE opening the Kysely transaction —
    // getCurrentAccountingPeriod uses the REST client and calling it
    // mid-transaction parks the (size 1) pool in idle-in-transaction.
    const accountingPeriodId = accountingEnabled
      ? await getCurrentAccountingPeriod(client, companyId, db)
      : null;
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
            description: comment?.trim()
              ? `Inventory Adjustment — ${comment.trim()}`
              : "Inventory Adjustment",
            userId,
            dimensions: dimensionMap,
          }
        : null;

    // get_item_quantities_by_tracking_id rows (scoped to item + location);
    // only the fields this function reads.
    type TrackingQuantityRow = {
      trackedEntityId: string | null;
      storageUnitId: string | null;
      quantity: number | null;
      readableId: string | null;
    };
    const trackingRows = (storageUnitQuantities.data ??
      []) as TrackingQuantityRow[];

    const ledgerBase = {
      postingDate: today,
      itemId,
      locationId,
      storageUnitId: storageUnitId ?? null,
      trackedEntityId: trackedEntityId ?? null,
      documentType: null,
      documentId: null,
      comment: comment || null,
      companyId,
      createdBy: userId,
    };

    // null == undefined — loose equality is deliberate (ported behavior).
    const currentQuantity = trackedEntityId
      ? trackingRows.find((q) => q.trackedEntityId == trackedEntityId)
      : trackingRows.find((q) => q.storageUnitId == storageUnitId);
    const currentQuantityOnHand = currentQuantity?.quantity ?? 0;

    // Fixed Duration shelf-life fallback for NEW tracked entities when the
    // user did not type an expiry. Other modes stay NULL (resolved at
    // production/receipt time, not on a manual adjustment).
    const resolveExpirationForNewEntity = (): string | null => {
      if (providedExpirationDate) return providedExpirationDate;
      if (
        !shelfLife.error &&
        shelfLife.data?.mode === "Fixed Duration" &&
        shelfLife.data.days
      ) {
        return format(
          new Date(Date.now() + Number(shelfLife.data.days) * 86_400_000),
          "yyyy-MM-dd"
        );
      }
      return null;
    };

    // Existing-entity expiry override: only when the user supplied a value
    // that differs from the current one. Ports updateTrackedEntityExpiry —
    // appends to attributes.expiryOverrides so the override is traceable.
    const applyExpirationOverride = async (
      trx: Transaction<DB>,
      targetEntityId: string
    ) => {
      if (!providedExpirationDate) return;
      const existing = await trx
        .selectFrom("trackedEntity")
        .select(["expirationDate", "attributes", "status"])
        .where("id", "=", targetEntityId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (!existing || existing.expirationDate === providedExpirationDate)
        return;
      if (existing.status === "Consumed") {
        throw new ValidationError(
          "Cannot edit expiry of a consumed tracked entity"
        );
      }
      const prevAttrs =
        (existing.attributes as Record<string, unknown> | null) ?? {};
      const prevHistory = Array.isArray(prevAttrs.expiryOverrides)
        ? (prevAttrs.expiryOverrides as Record<string, unknown>[])
        : [];
      const nextAttrs = {
        ...prevAttrs,
        expiryOverrides: [
          ...prevHistory,
          {
            previous: existing.expirationDate ?? null,
            next: providedExpirationDate,
            reason: comment?.trim() || "Updated via inventory adjustment",
            source: "Inventory Adjustment",
            userId,
            at: nowIso,
          },
        ],
      };
      await trx
        .updateTable("trackedEntity")
        .set({
          expirationDate: providedExpirationDate,
          attributes: nextAttrs as unknown as Json,
        })
        .where("id", "=", targetEntityId)
        .execute();
    };

    let resultLedgerId: string | null = null;

    // Storage-unit transfer for a tracked entity: negative at the original
    // unit, positive at the new one. Value does not move — no GL, no layers.
    const isStorageUnitTransfer =
      trackedEntityId &&
      originalStorageUnitId &&
      originalStorageUnitId !== storageUnitId;

    await db.transaction().execute(async (trx) => {
      if (isStorageUnitTransfer) {
        if (readableId !== undefined && readableId !== null) {
          await trx
            .updateTable("trackedEntity")
            .set({ readableId })
            .where("id", "=", trackedEntityId!)
            .where("companyId", "=", companyId)
            .execute();
        }
        await applyExpirationOverride(trx, trackedEntityId!);

        await bookAdjustment(trx, {
          ledger: {
            ...ledgerBase,
            storageUnitId: originalStorageUnitId!,
            entryType: "Negative Adjmt.",
            quantity: -currentQuantityOnHand,
          },
          item,
          itemCost,
          accounting,
          skipValuation: true,
        });
        const positive = await bookAdjustment(trx, {
          ledger: {
            ...ledgerBase,
            entryType: "Positive Adjmt.",
            quantity: currentQuantityOnHand,
          },
          item,
          itemCost,
          accounting,
          skipValuation: true,
        });
        resultLedgerId = positive.itemLedgerId;
        return;
      }

      let entryType: "Positive Adjmt." | "Negative Adjmt." =
        adjustmentType === "Set Quantity" ? "Positive Adjmt." : adjustmentType;
      let adjustmentQuantity = quantity;

      if (adjustmentType === "Set Quantity" && currentQuantity) {
        const quantityDifference = quantity - currentQuantityOnHand;
        if (quantityDifference > 0) {
          entryType = "Positive Adjmt.";
          adjustmentQuantity = quantityDifference;
        } else if (quantityDifference < 0) {
          entryType = "Negative Adjmt.";
          adjustmentQuantity = Math.abs(quantityDifference);
        } else {
          // No quantity change — readableId / expirationDate may still change.
          if (trackedEntityId && readableId !== undefined && readableId !== null) {
            await trx
              .updateTable("trackedEntity")
              .set({ readableId })
              .where("id", "=", trackedEntityId)
              .where("companyId", "=", companyId)
              .execute();
          }
          if (trackedEntityId) {
            await applyExpirationOverride(trx, trackedEntityId);
          }
          resultLedgerId = null;
          return;
        }
      }

      // Resolve the stock target for a negative adjustment when a serial
      // number is provided or nothing matched the loose lookup.
      if (entryType === "Negative Adjmt." && (readableId || !currentQuantity)) {
        if (readableId) {
          const resolvedQtyRow = trackingRows.find(
            (q) =>
              q.readableId === readableId &&
              q.trackedEntityId != null &&
              (q.quantity ?? 0) > 0
          );
          if (!resolvedQtyRow) {
            throw new ValidationError("Serial number not found");
          }
          const resolvedId = resolvedQtyRow.trackedEntityId as string;
          const resolvedQty = resolvedQtyRow.quantity ?? 0;
          if (adjustmentQuantity > resolvedQty) {
            throw new ValidationError(
              "Insufficient quantity for negative adjustment"
            );
          }
          await trx
            .updateTable("trackedEntity")
            .set({ quantity: resolvedQty - adjustmentQuantity, readableId })
            .where("id", "=", resolvedId)
            .where("companyId", "=", companyId)
            .execute();
          const booked = await bookAdjustment(trx, {
            ledger: {
              ...ledgerBase,
              trackedEntityId: resolvedId,
              entryType,
              quantity: -Math.abs(adjustmentQuantity),
            },
            item,
            itemCost,
            accounting,
          });
          resultLedgerId = booked.itemLedgerId;
          return;
        }

        // No serial number provided. Prefer untracked (legacy) stock in this bin.
        const legacyRow = trackingRows.find(
          (q) => q.trackedEntityId == null && q.storageUnitId == storageUnitId
        );
        if (legacyRow) {
          const legacyQty = legacyRow.quantity ?? 0;
          if (adjustmentQuantity > legacyQty) {
            throw new ValidationError(
              "Insufficient quantity for negative adjustment"
            );
          }
          const booked = await bookAdjustment(trx, {
            ledger: {
              ...ledgerBase,
              trackedEntityId: null,
              entryType,
              quantity: -Math.abs(adjustmentQuantity),
            },
            item,
            itemCost,
            accounting,
          });
          resultLedgerId = booked.itemLedgerId;
          return;
        }

        // No untracked stock in the bin — resolve a tracked entity sitting in
        // the same storage unit. Ambiguous when more than one holds stock.
        const trackedRowsInUnit = trackingRows.filter(
          (q) =>
            q.trackedEntityId != null &&
            q.storageUnitId == storageUnitId &&
            (q.quantity ?? 0) > 0
        );
        if (trackedRowsInUnit.length === 0) {
          throw new ValidationError(
            "Insufficient quantity for negative adjustment"
          );
        }
        if (trackedRowsInUnit.length > 1) {
          throw new ValidationError(
            "Multiple tracked entities in this storage unit — select a specific row to adjust"
          );
        }
        const targetRow = trackedRowsInUnit[0];
        const targetQty = targetRow.quantity ?? 0;
        if (adjustmentQuantity > targetQty) {
          throw new ValidationError(
            "Insufficient quantity for negative adjustment"
          );
        }
        const targetId = targetRow.trackedEntityId as string;
        await trx
          .updateTable("trackedEntity")
          .set({ quantity: targetQty - adjustmentQuantity })
          .where("id", "=", targetId)
          .where("companyId", "=", companyId)
          .execute();
        const booked = await bookAdjustment(trx, {
          ledger: {
            ...ledgerBase,
            trackedEntityId: targetId,
            entryType,
            quantity: -Math.abs(adjustmentQuantity),
          },
          item,
          itemCost,
          accounting,
        });
        resultLedgerId = booked.itemLedgerId;
        return;
      }

      let signedQuantity = adjustmentQuantity;
      if (entryType === "Negative Adjmt.") {
        if (adjustmentQuantity > currentQuantityOnHand) {
          throw new ValidationError(
            "Insufficient quantity for negative adjustment"
          );
        }
        signedQuantity = -Math.abs(adjustmentQuantity);
      }

      if (trackedEntityId) {
        if (currentQuantity) {
          const entityUpdate: Record<string, unknown> = {
            quantity: signedQuantity + currentQuantityOnHand,
          };
          if (readableId !== undefined && readableId !== null) {
            entityUpdate.readableId = readableId;
          }
          await trx
            .updateTable("trackedEntity")
            .set(entityUpdate)
            .where("id", "=", trackedEntityId)
            .where("companyId", "=", companyId)
            .execute();
          await applyExpirationOverride(trx, trackedEntityId);
        } else {
          const expirationDate = resolveExpirationForNewEntity();
          // Stamp the trace blob so the popover Source / Override steps can
          // show the entity originated from a manual inventory adjustment.
          const adjustmentStamp = {
            userId,
            at: nowIso,
            reason: comment?.trim() || "Created via inventory adjustment",
          };
          const attributes: Record<string, unknown> = {
            "Inventory Adjustment": adjustmentStamp,
            ...(expirationDate
              ? {
                  expiryOverrides: [
                    {
                      previous: null,
                      next: expirationDate,
                      reason: adjustmentStamp.reason,
                      source: "Inventory Adjustment",
                      userId: adjustmentStamp.userId,
                      at: adjustmentStamp.at,
                    },
                  ],
                }
              : {}),
          };
          await trx
            .insertInto("trackedEntity")
            .values({
              id: trackedEntityId,
              sourceDocument: "Item",
              sourceDocumentId: itemId,
              sourceDocumentReadableId:
                itemResult.data.readableIdWithRevision ?? undefined,
              readableId: readableId ?? null,
              quantity: signedQuantity,
              status: "Available",
              expirationDate,
              attributes: attributes as unknown as Json,
              companyId,
              createdBy: userId,
            })
            .execute();
        }
      }

      const booked = await bookAdjustment(trx, {
        ledger: {
          ...ledgerBase,
          entryType,
          quantity: signedQuantity,
        },
        item,
        itemCost,
        accounting,
      });
      resultLedgerId = booked.itemLedgerId;
    });

    return new Response(
      JSON.stringify({
        success: true,
        itemLedger: resultLedgerId ? { id: resultLedgerId } : null,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (err) {
    logger.error("post-inventory-adjustment failed", {
      error: String((err as Error).stack ?? err),
    });
    const isValidationError = err instanceof ValidationError;
    return new Response(
      JSON.stringify({ message: (err as Error).message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: isValidationError ? 400 : 500,
      }
    );
  }
});
