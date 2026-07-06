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
  productionEventId: z.string(),
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
    const { productionEventId, userId, companyId } =
      payloadValidator.parse(payload);

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

    const [productionEvent, accountDefaults, dimensions] = await Promise.all([
      client
        .from("productionEvent")
        .select("*, jobOperation!inner(jobId, processId)")
        .eq("id", productionEventId)
        .single(),
      getDefaultPostingGroup(client, companyId),
      client
        .from("dimension")
        .select("id, entityType")
        .eq("companyGroupId", companyRecord.data.companyGroupId)
        .eq("active", true)
        .in("entityType", ["ItemPostingGroup", "Location", "Employee", "WorkCenter", "Process"]),
    ]);

    if (productionEvent.error) throw new Error("Failed to fetch production event");
    if (accountDefaults?.error || !accountDefaults?.data) {
      throw new Error("Error getting account defaults");
    }
    if (!accountDefaults.data.laborAbsorptionAccount) {
      throw new Error("laborAbsorptionAccount not configured in account defaults");
    }

    const event = productionEvent.data;
    if (!event.endTime || !event.duration || !event.workCenterId) {
      await client
        .from("productionEvent")
        .update({ postedToGL: true })
        .eq("id", productionEventId);
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const jobId = (event.jobOperation as any).jobId as string;

    const workCenter = await client
      .from("workCenter")
      .select("laborRate, machineRate")
      .eq("id", event.workCenterId)
      .single();

    if (workCenter.error) throw new Error(`Failed to fetch work center ${event.workCenterId}: ${workCenter.error.message}`);

    const durationHours = event.duration / 3600;
    const rate =
      event.type === "Machine"
        ? Number(workCenter.data.machineRate ?? 0)
        : Number(workCenter.data.laborRate ?? 0);

    const cost = durationHours * rate;

    if (cost <= 0) {
      await client
        .from("productionEvent")
        .update({ postedToGL: true })
        .eq("id", productionEventId);
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const dimensionMap = new Map<string, string>();
    if (dimensions?.data) {
      for (const dim of dimensions.data) {
        if (dim.entityType) dimensionMap.set(dim.entityType, dim.id);
      }
    }

    const job = await client
      .from("job")
      .select("itemId, locationId, jobId")
      .eq("id", jobId)
      .single();

    if (job.error) throw new Error("Failed to fetch job");

    const finishedItemCost = job.data.itemId
      ? await client
          .from("itemCost")
          .select("itemPostingGroupId")
          .eq("itemId", job.data.itemId)
          .eq("companyId", companyId)
          .single()
      : null;

    const journalLineReference = nanoid();

    const journalLineInserts = [
      {
        accountId: accountDefaults.data.workInProgressAccount,
        description: "WIP Account",
        amount: debit("asset", cost),
        quantity: 1,
        documentType: "Production Event",
        documentId: jobId,
        documentLineReference: journalReference.to.job(jobId),
        journalLineReference,
        companyId,
      },
      {
        accountId: accountDefaults.data.laborAbsorptionAccount!,
        description: "Labor/Machine Absorption",
        amount: credit("expense", cost),
        quantity: 1,
        documentType: "Production Event",
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

    await db.transaction().execute(async (trx) => {
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
          description: `${event.type} Time — Job ${job.data.jobId}`,
          postingDate: today,
          companyId,
          sourceType: "Production Event",
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
          if (
            finishedItemCost?.data?.itemPostingGroupId &&
            dimensionMap.has("ItemPostingGroup")
          ) {
            dimensionInserts.push({
              journalLineId: jl.id,
              dimensionId: dimensionMap.get("ItemPostingGroup")!,
              valueId: finishedItemCost.data.itemPostingGroupId,
              companyId,
            });
          }
          if (job.data.locationId && dimensionMap.has("Location")) {
            dimensionInserts.push({
              journalLineId: jl.id,
              dimensionId: dimensionMap.get("Location")!,
              valueId: job.data.locationId,
              companyId,
            });
          }
          if (event.employeeId && dimensionMap.has("Employee")) {
            dimensionInserts.push({
              journalLineId: jl.id,
              dimensionId: dimensionMap.get("Employee")!,
              valueId: event.employeeId,
              companyId,
            });
          }
          if (event.workCenterId && dimensionMap.has("WorkCenter")) {
            dimensionInserts.push({
              journalLineId: jl.id,
              dimensionId: dimensionMap.get("WorkCenter")!,
              valueId: event.workCenterId,
              companyId,
            });
          }
          const processId = (event.jobOperation as any)?.processId as string | null;
          if (processId && dimensionMap.has("Process")) {
            dimensionInserts.push({
              journalLineId: jl.id,
              dimensionId: dimensionMap.get("Process")!,
              valueId: processId,
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

      await trx
        .updateTable("productionEvent")
        .set({ postedToGL: true })
        .where("id", "=", productionEventId)
        .execute();
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
