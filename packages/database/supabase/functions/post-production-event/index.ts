import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";
import z from "npm:zod@^4.5.4";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { datetime, getCompanyTimeZone } from "../lib/datetime.ts";
import { corsPreflight, errorResponse, jsonResponse } from "../lib/response.ts";
import { requirePermissions } from "../lib/supabase.ts";

import { credit, debit, journalReference } from "../lib/utils.ts";
import { getCurrentAccountingPeriod } from "../shared/get-accounting-period.ts";
import { getNextSequence } from "../shared/get-next-sequence.ts";
import { getDefaultPostingGroup } from "../shared/get-posting-group.ts";
import { round } from "../shared/precision.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

const payloadValidator = z.object({
  productionEventId: z.string(),
  userId: z.string(),
  companyId: z.string(),
  // Reverse the net journal lines previously posted for this event (e.g.
  // before deleting it) instead of posting its current state.
  reverse: z.boolean().optional(),
});

serve(async (req: Request) => {
  const preflight = corsPreflight(req);
  if (preflight) return preflight;

  const payload = await req.json();

  try {
    const { productionEventId, userId, companyId, reverse } =
      payloadValidator.parse(payload);

    const client = await requirePermissions(req, companyId, userId, { update: "production" });
    const today = datetime.today(await getCompanyTimeZone(client, companyId)).toString();

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
      return jsonResponse({ success: true });
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
        .in("entityType", ["ItemPostingGroup", "Item", "Location", "Employee", "WorkCenter", "Process"]),
    ]);

    if (productionEvent.error) throw new Error("Failed to fetch production event");
    if (accountDefaults?.error || !accountDefaults?.data) {
      throw new Error("Error getting account defaults");
    }
    if (!accountDefaults.data.laborAbsorptionAccount) {
      throw new Error("laborAbsorptionAccount not configured in account defaults");
    }
    // Cast until the cloud-generated DB types include the new column.
    const overheadAbsorptionAccount = (accountDefaults.data as any)
      .overheadAbsorptionAccount as string | undefined;

    const event = productionEvent.data;

    if (reverse && !event.postedToGL) {
      // Nothing was posted for this event, so there is nothing to reverse.
      return jsonResponse({ success: true });
    }

    if (!reverse && (!event.endTime || !event.duration || !event.workCenterId)) {
      // Leave postedToGL untouched so the event can still be posted later
      // (manually or by complete_job_to_inventory) once it's completable.
      const reason = !event.endTime
        ? "event has no end time"
        : !event.duration
        ? "event has no duration"
        : "event has no work center";
      // FIXME: returns { success: false } at HTTP 200, so callers (error === null)
      // read it as success. A real status (409/422?) needs its own decision — see §6c.
      return jsonResponse({ success: false, reason });
    }

    const jobId = (event.jobOperation as any).jobId as string;

    let cost = 0;
    let overheadCost = 0;
    if (!reverse) {
      const workCenter = await client
        .from("workCenter")
        .select("laborRate, machineRate, overheadRate")
        .eq("id", event.workCenterId!)
        .single();

      if (workCenter.error) throw new Error(`Failed to fetch work center ${event.workCenterId}: ${workCenter.error.message}`);

      const durationHours = (event.duration ?? 0) / 3600;
      const rate =
        event.type === "Machine"
          ? Number(workCenter.data.machineRate ?? 0)
          : Number(workCenter.data.laborRate ?? 0);

      cost = durationHours * rate;
      overheadCost = durationHours * Number(workCenter.data.overheadRate ?? 0);

      if (overheadCost > 0 && !overheadAbsorptionAccount) {
        throw new Error(
          "overheadAbsorptionAccount not configured in account defaults"
        );
      }
    }

    // Net amount already posted for this specific event, grouped by account.
    const eventReference = journalReference.to.productionEvent(
      productionEventId
    );
    const priorLines = event.postedToGL
      ? await db
          .selectFrom("journalLine")
          .select(["accountId", (eb) => eb.fn.sum("amount").as("amount")])
          .where("documentLineReference", "=", eventReference)
          .where("companyId", "=", companyId)
          .groupBy("accountId")
          .execute()
      : [];
    const reversalLines = priorLines.filter(
      (line) => Math.abs(Number(line.amount)) >= 0.000001
    );

    // Did this event's job post any production-event lines under the old
    // job-tagged scheme (documentLineReference = job:...)? Those can't be
    // attributed to one event, so editing/reversing a posted event that has no
    // per-event lines can't be done safely — it needs a manual journal entry.
    // This is rate-independent: unlike recomputing cost, it still recognizes a
    // zero-cost posted event (which posted nothing) as safe to delete even
    // after the work center's rate later changes.
    const hasOldSchemePostings =
      event.postedToGL && reversalLines.length === 0
        ? Number(
            (
              await db
                .selectFrom("journalLine")
                .select((eb) => eb.fn.countAll().as("count"))
                .where("documentType", "=", "Production Event")
                .where("documentId", "=", jobId)
                .where(
                  "documentLineReference",
                  "=",
                  journalReference.to.job(jobId)
                )
                .where("companyId", "=", companyId)
                .executeTakeFirst()
            )?.count ?? 0
          ) > 0
        : false;

    // Block only when the event posted amounts under the old scheme that we
    // can't attribute/reverse. A zero-cost posted event posted nothing, so
    // there's nothing to reverse and it's safe to delete.
    if (event.postedToGL && reversalLines.length === 0 && hasOldSchemePostings) {
      // FIXME: returns { success: false } at HTTP 200, so callers (error === null)
      // read it as success. A real status (409/422?) needs its own decision — see §6c.
      return jsonResponse({
        success: false,
        reason:
          "event was posted before per-event journal references; adjust with a manual journal entry",
      });
    }

    if (cost <= 0 && overheadCost <= 0 && reversalLines.length === 0) {
      // Nothing to post and nothing to reverse. On a reversal this clears the
      // flag so the event can be deleted; on a post it marks it done.
      await client
        .from("productionEvent")
        .update({ postedToGL: !reverse })
        .eq("id", productionEventId);
      return jsonResponse({ success: true });
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
      // Reposting an edited event: first negate the net previously posted for
      // this event per account, then post the new amount.
      ...reversalLines.map((line) => ({
        accountId: line.accountId,
        description: "Production Event Reversal",
        amount: round(-Number(line.amount)),
        quantity: 1,
        documentType: "Production Event",
        documentId: jobId,
        documentLineReference: eventReference,
        journalLineReference,
        companyId,
      })),
      ...(!reverse && cost > 0
        ? [
            {
              accountId: accountDefaults.data.workInProgressAccount,
              description: "WIP Account",
              amount: round(debit("asset", cost)),
              quantity: 1,
              documentType: "Production Event",
              documentId: jobId,
              documentLineReference: eventReference,
              journalLineReference,
              companyId,
            },
            {
              accountId: accountDefaults.data.laborAbsorptionAccount!,
              description: "Labor/Machine Absorption",
              amount: round(credit("expense", cost)),
              quantity: 1,
              documentType: "Production Event",
              documentId: jobId,
              documentLineReference: eventReference,
              journalLineReference,
              companyId,
            },
          ]
        : []),
      ...(!reverse && overheadCost > 0
        ? [
            {
              accountId: accountDefaults.data.workInProgressAccount,
              description: "WIP Account (Overhead)",
              amount: round(debit("asset", overheadCost)),
              quantity: 1,
              documentType: "Production Event",
              documentId: jobId,
              documentLineReference: eventReference,
              journalLineReference,
              companyId,
            },
            {
              accountId: overheadAbsorptionAccount!,
              description: "Overhead Absorption",
              amount: round(credit("expense", overheadCost)),
              quantity: 1,
              documentType: "Production Event",
              documentId: jobId,
              documentLineReference: eventReference,
              journalLineReference,
              companyId,
            },
          ]
        : []),
    ];

    const accountingPeriodId = await getCurrentAccountingPeriod(
      client,
      companyId,
      db,
      today
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
          description: `${event.type} Time — Job ${job.data.jobId}${
            reverse
              ? " (Reversal)"
              : reversalLines.length > 0
              ? " (Adjustment)"
              : ""
          }`,
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
          if (job.data.itemId && dimensionMap.has("Item")) {
            dimensionInserts.push({
              journalLineId: jl.id,
              dimensionId: dimensionMap.get("Item")!,
              valueId: job.data.itemId,
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
        .set({ postedToGL: !reverse })
        .where("id", "=", productionEventId)
        .execute();
    });

    return jsonResponse({ success: true });
  } catch (err) {
    return errorResponse(err, 500);
  }
});
