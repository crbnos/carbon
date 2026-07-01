import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { format } from "https://deno.land/std@0.205.0/datetime/mod.ts";
import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";
import z from "npm:zod@^3.24.1";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsHeaders } from "../lib/headers.ts";
import { requirePermissions } from "../lib/supabase.ts";
import { credit, debit, journalReference } from "../lib/utils.ts";
import { getCurrentAccountingPeriod } from "../shared/get-accounting-period.ts";
import { getNextSequence } from "../shared/get-next-sequence.ts";
import { getDefaultPostingGroup } from "../shared/get-posting-group.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

const payloadValidator = z.object({
  jobId: z.string(),
  userId: z.string(),
  companyId: z.string(),
});

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const payload = await req.json();
  const today = format(new Date(), "yyyy-MM-dd");

  try {
    const { jobId, userId, companyId } = payloadValidator.parse(payload);

    const client = await requirePermissions(req, companyId, userId, { update: "production" });

    const [accountingSettings, companyRecord] = await Promise.all([
      client
        .from("companySettings")
        .select("accountingEnabled")
        .eq("id", companyId)
        .single(),
      client
        .from("company")
        .select("companyGroupId")
        .eq("id", companyId)
        .single(),
    ]);

    const accountingEnabled = accountingSettings.data?.accountingEnabled ?? false;

    if (!accountingEnabled) {
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (companyRecord.error) throw new Error("Failed to fetch company");

    const accountDefaults = await getDefaultPostingGroup(client, companyId);
    if (accountDefaults?.error || !accountDefaults?.data) {
      throw new Error("Error getting account defaults");
    }

    await db.transaction().execute(async (trx) => {
      const wipBalance = await trx
        .selectFrom("journalLine")
        .innerJoin("journal", "journal.id", "journalLine.journalId")
        .select((eb) => eb.fn.sum("journalLine.amount").as("balance"))
        .where(
          "journalLine.accountId",
          "=",
          accountDefaults.data!.workInProgressAccount
        )
        .where("journalLine.documentId", "=", jobId)
        .where("journal.companyId", "=", companyId)
        .executeTakeFirst();

      const remainingWip = Number(wipBalance?.balance ?? 0);

      if (Math.abs(remainingWip) < 0.01) return;

      const job = await trx
        .selectFrom("job")
        .where("id", "=", jobId)
        .select(["jobId", "itemId", "locationId"])
        .executeTakeFirstOrThrow();

      // Resolve the item dimensions so the WIP variance lines are attributable
      // to the finished good (mirrors the WIP lines posted during completion).
      const companyGroupId = companyRecord.data.companyGroupId;
      const dimensionMap = new Map<string, string>();
      if (companyGroupId) {
        const dimensions = await trx
          .selectFrom("dimension")
          .select(["id", "entityType"])
          .where("companyGroupId", "=", companyGroupId)
          .where("active", "=", true)
          .where("entityType", "in", ["ItemPostingGroup", "Item", "Location"])
          .execute();
        for (const dim of dimensions) {
          if (dim.entityType) dimensionMap.set(dim.entityType, dim.id);
        }
      }

      const finishedItemCost = job.itemId
        ? await trx
            .selectFrom("itemCost")
            .select(["itemPostingGroupId"])
            .where("itemId", "=", job.itemId)
            .where("companyId", "=", companyId)
            .executeTakeFirst()
        : null;

      const journalLineReference = nanoid();

      const journalLineInserts = [
        {
          accountId: accountDefaults.data!.materialVarianceAccount,
          description: "Production Variance",
          amount: debit("expense", Math.abs(remainingWip)),
          quantity: 0,
          documentType: "Job Close",
          documentId: jobId,
          documentLineReference: journalReference.to.job(jobId),
          journalLineReference,
          companyId,
        },
        {
          accountId: accountDefaults.data!.workInProgressAccount,
          description: "WIP Account",
          amount: credit("asset", Math.abs(remainingWip)),
          quantity: 0,
          documentType: "Job Close",
          documentId: jobId,
          documentLineReference: journalReference.to.job(jobId),
          journalLineReference,
          companyId,
        },
      ];

      const accountingPeriodId = await getCurrentAccountingPeriod(
        client,
        companyId,
        db
      );

      const journalEntryId = await getNextSequence(
        trx,
        "journalEntry",
        companyId
      );

      const journalResult = await trx
        .insertInto("journal")
        .values({
          journalEntryId,
          accountingPeriodId,
          description: `Job Close Variance ${job.jobId}`,
          postingDate: today,
          companyId,
          sourceType: "Job Close",
          status: "Posted",
          postedAt: new Date().toISOString(),
          postedBy: userId,
          createdBy: userId,
        })
        .returning(["id"])
        .executeTakeFirstOrThrow();

      const journalLineResults = await trx
        .insertInto("journalLine")
        .values(
          journalLineInserts.map((line) => ({
            ...line,
            journalId: journalResult.id,
          }))
        )
        .returning(["id"])
        .execute();

      if (dimensionMap.size > 0) {
        const dimensionInserts: {
          journalLineId: string;
          dimensionId: string;
          valueId: string;
          companyId: string;
        }[] = [];

        journalLineResults.forEach((jl) => {
          if (job.itemId && dimensionMap.has("Item")) {
            dimensionInserts.push({
              journalLineId: jl.id,
              dimensionId: dimensionMap.get("Item")!,
              valueId: job.itemId,
              companyId,
            });
          }
          if (
            finishedItemCost?.itemPostingGroupId &&
            dimensionMap.has("ItemPostingGroup")
          ) {
            dimensionInserts.push({
              journalLineId: jl.id,
              dimensionId: dimensionMap.get("ItemPostingGroup")!,
              valueId: finishedItemCost.itemPostingGroupId,
              companyId,
            });
          }
          if (job.locationId && dimensionMap.has("Location")) {
            dimensionInserts.push({
              journalLineId: jl.id,
              dimensionId: dimensionMap.get("Location")!,
              valueId: job.locationId,
              companyId,
            });
          }
        });

        if (dimensionInserts.length > 0) {
          await trx
            .insertInto("journalLineDimension")
            .values(dimensionInserts)
            .execute();
        }
      }
    });

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
