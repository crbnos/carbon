// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCompanyTimeZone, journalReference } from "@carbon/database";
import { DOCUMENT_JOURNAL_STATUSES } from "@carbon/database/accounting-posting";
import {
  assertPostingStatusUnchanged,
  journalPostingStatus,
  MissingAccountDefaultError,
  resolveDefaultAccount
} from "@carbon/database/journal-posting-status";
import {
  inOrder,
  many,
  maybeSingle,
  notNull,
  single,
  type Tables,
  updateRows
} from "@carbon/database/rows";
import { getNextSequence } from "@carbon/database/sequence";
import { credit, datetime, debit, round } from "@carbon/utils";
import { nanoid } from "nanoid";
import { z } from "zod";
import { defineServerFn } from "../define-server-fn";
import { InvalidInputError, NotFoundError } from "../errors";
import { TIME_ENTRY_BEFORE_CUTOVER_ERROR } from "../lib/cutover-void";
import { getCurrentAccountingPeriod } from "../lib/get-accounting-period";
import { getDefaultPostingGroup } from "../lib/get-posting-group";

export const postProductionEventInput = z.object({
  productionEventId: z.string(),
  // Reverse the net journal lines previously posted for this event (e.g.
  // before deleting it) instead of posting its current state.
  reverse: z.boolean().optional()
});

/**
 * `success: false` with a `reason` is a skip the caller may ignore (the event is
 * not completable yet, or was posted under the old job-tagged scheme). FIXME:
 * callers read `error === null` as success, so a real status for these needs
 * its own decision.
 */
export type PostProductionEventResult = { success: boolean; reason?: string };

/** Posts (or reverses) a production event's labor/machine and overhead cost to WIP. */
const postProductionEvent = defineServerFn({
  name: "post-production-event",
  input: postProductionEventInput,
  permissions: { update: "production" },
  async run(
    ctx,
    { productionEventId, reverse }
  ): Promise<PostProductionEventResult> {
    const { db, companyId, userId } = ctx;
    const today = datetime
      .today(await getCompanyTimeZone(db, companyId))
      .toString();

    const companyRecord = await single(
      db,
      "company",
      { id: companyId },
      { columns: ["companyGroupId"] }
    );

    if (companyRecord.error) throw new Error("Failed to fetch company");

    const [productionEvent, accountDefaults, dimensions] = await inOrder([
      () =>
        // `jobOperation!inner`: only an event that belongs to an operation.
        maybeSingle<
          "productionEvent",
          Tables["productionEvent"]["Row"] & {
            jobOperation: Pick<
              Tables["jobOperation"]["Row"],
              "jobId" | "processId"
            > | null;
          }
        >(
          db,
          "productionEvent",
          { id: productionEventId, companyId, jobOperationId: notNull },
          {
            embed: {
              jobOperation: {
                table: "jobOperation",
                via: "jobOperationId",
                columns: ["jobId", "processId"]
              }
            }
          }
        ),
      () => getDefaultPostingGroup(db, companyId),
      () =>
        companyRecord.data.companyGroupId
          ? many(
              db,
              "dimension",
              {
                companyGroupId: companyRecord.data.companyGroupId,
                active: true,
                entityType: [
                  "ItemPostingGroup",
                  "Item",
                  "Location",
                  "Employee",
                  "WorkCenter",
                  "Process"
                ]
              },
              { columns: ["id", "entityType"] }
            )
          : Promise.resolve({ data: null, error: null })
    ]);

    if (productionEvent.error)
      throw new Error("Failed to fetch production event");
    // Service-role client: a production event outside companyId is a 404.
    if (!productionEvent.data) {
      throw new NotFoundError("Production event not found");
    }
    if (accountDefaults?.error || !accountDefaults?.data) {
      throw new Error("Error getting account defaults");
    }

    // Every event with a cost posts a journal: Provisional before the
    // company's accounting cutover, Posted after it. Read here to decide
    // whether to resolve a period, and again inside the transaction.
    const postingStatus = await journalPostingStatus(db, companyId);

    // After the cutover an empty absorption account refuses the posting, as
    // it always has. Before it, the line becomes a stand-in (see below).
    if (
      postingStatus === "Posted" &&
      !accountDefaults.data.laborAbsorptionAccount
    ) {
      throw new MissingAccountDefaultError("laborAbsorptionAccount");
    }

    const event = productionEvent.data;

    if (reverse && !event.postedToGL) {
      // Nothing was posted for this event, so there is nothing to reverse.
      return { success: true } as PostProductionEventResult;
    }

    if (
      !reverse &&
      (!event.endTime || !event.duration || !event.workCenterId)
    ) {
      // Leave postedToGL untouched so the event can still be posted later
      // (manually or by complete_job_to_inventory) once it's completable.
      const reason = !event.endTime
        ? "event has no end time"
        : !event.duration
          ? "event has no duration"
          : "event has no work center";
      // FIXME: returns { success: false } at HTTP 200, so callers (error === null)
      // read it as success. A real status (409/422?) needs its own decision — see §6c.
      return { success: false, reason } as PostProductionEventResult;
    }

    const jobId = (event.jobOperation as any).jobId as string;

    let cost = 0;
    let overheadCost = 0;
    if (!reverse) {
      const workCenter = await single(
        db,
        "workCenter",
        { id: event.workCenterId! },
        { columns: ["laborRate", "machineRate", "overheadRate"] }
      );

      if (workCenter.error)
        throw new Error(
          `Failed to fetch work center ${event.workCenterId}: ${workCenter.error.message}`
        );

      const durationHours = (event.duration ?? 0) / 3600;
      const rate =
        event.type === "Machine"
          ? Number(workCenter.data.machineRate ?? 0)
          : Number(workCenter.data.laborRate ?? 0);

      cost = durationHours * rate;
      overheadCost = durationHours * Number(workCenter.data.overheadRate ?? 0);

      if (
        postingStatus === "Posted" &&
        overheadCost > 0 &&
        !accountDefaults.data.overheadAbsorptionAccount
      ) {
        throw new MissingAccountDefaultError("overheadAbsorptionAccount");
      }
    }

    // Net amount already posted for this specific event, grouped by account.
    const eventReference =
      journalReference.to.productionEvent(productionEventId);

    // The enable superseded the journal of an event posted before the
    // cutover and opened the job's WIP with its cost, so the reads below see
    // nothing to reverse: a re-post would add the cost again and a reversal
    // would leave it. The re-post is dated today, after the cutover, so no
    // closed period refuses it.
    if (event.postedToGL) {
      const superseded = await db
        .selectFrom("journalLine")
        .innerJoin("journal", (join) =>
          join
            .onRef("journal.id", "=", "journalLine.journalId")
            .onRef("journal.companyId", "=", "journalLine.companyId")
        )
        .select("journalLine.id")
        .where("journalLine.documentLineReference", "=", eventReference)
        .where("journalLine.companyId", "=", companyId)
        .where("journal.status", "=", "Superseded")
        .limit(1)
        .executeTakeFirst();
      if (superseded) {
        throw new InvalidInputError(TIME_ENTRY_BEFORE_CUTOVER_ERROR);
      }
    }
    const priorLines = event.postedToGL
      ? await db
          .selectFrom("journalLine")
          .innerJoin("journal", (join) =>
            join
              .onRef("journal.id", "=", "journalLine.journalId")
              .onRef("journal.companyId", "=", "journalLine.companyId")
          )
          .select([
            "journalLine.accountId",
            "journalLine.accountDefaultRole",
            (eb) => eb.fn.sum("journalLine.amount").as("amount")
          ])
          .where("journalLine.documentLineReference", "=", eventReference)
          .where("journalLine.companyId", "=", companyId)
          .where("journal.status", "in", [...DOCUMENT_JOURNAL_STATUSES])
          .groupBy(["journalLine.accountId", "journalLine.accountDefaultRole"])
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
                .innerJoin("journal", (join) =>
                  join
                    .onRef("journal.id", "=", "journalLine.journalId")
                    .onRef("journal.companyId", "=", "journalLine.companyId")
                )
                .select((eb) => eb.fn.countAll().as("count"))
                .where("journalLine.documentType", "=", "Production Event")
                .where("journalLine.documentId", "=", jobId)
                .where(
                  "journalLine.documentLineReference",
                  "=",
                  journalReference.to.job(jobId)
                )
                .where("journalLine.companyId", "=", companyId)
                .where("journal.status", "in", [...DOCUMENT_JOURNAL_STATUSES])
                .executeTakeFirst()
            )?.count ?? 0
          ) > 0
        : false;

    // Block only when the event posted amounts under the old scheme that we
    // can't attribute/reverse. A zero-cost posted event posted nothing, so
    // there's nothing to reverse and it's safe to delete.
    if (
      event.postedToGL &&
      reversalLines.length === 0 &&
      hasOldSchemePostings
    ) {
      // FIXME: returns { success: false } at HTTP 200, so callers (error === null)
      // read it as success. A real status (409/422?) needs its own decision — see §6c.
      return {
        success: false,
        reason:
          "event was posted before per-event journal references; adjust with a manual journal entry"
      } as PostProductionEventResult;
    }

    if (cost <= 0 && overheadCost <= 0 && reversalLines.length === 0) {
      // Nothing to post and nothing to reverse. On a reversal this clears the
      // flag so the event can be deleted; on a post it marks it done.
      await updateRows(
        db,
        "productionEvent",
        { postedToGL: !reverse },
        { id: productionEventId, companyId }
      );
      return { success: true } as PostProductionEventResult;
    }

    const dimensionMap = new Map<string, string>();
    if (dimensions?.data) {
      for (const dim of dimensions.data) {
        if (dim.entityType) dimensionMap.set(dim.entityType, dim.id);
      }
    }

    const job = await single(
      db,
      "job",
      { id: jobId },
      { columns: ["itemId", "locationId", "jobId"] }
    );

    if (job.error) throw new Error("Failed to fetch job");

    const finishedItemCost = job.data.itemId
      ? await single(
          db,
          "itemCost",
          { itemId: job.data.itemId, companyId },
          { columns: ["itemPostingGroupId"] }
        )
      : null;

    const journalLineReference = nanoid();

    // Resolved only for a line that is built: after the cutover an empty
    // default has already refused the posting above.
    const laborAbsorption =
      !reverse && cost > 0
        ? resolveDefaultAccount(
            accountDefaults.data,
            "laborAbsorptionAccount",
            postingStatus
          )
        : null;
    const overheadAbsorption =
      !reverse && overheadCost > 0
        ? resolveDefaultAccount(
            accountDefaults.data,
            "overheadAbsorptionAccount",
            postingStatus
          )
        : null;

    const journalLineInserts = [
      // Reposting an edited event: first negate the net previously posted for
      // this event per account, then post the new amount.
      ...reversalLines.map((line) => ({
        accountId: line.accountId,
        accountDefaultRole: line.accountDefaultRole,
        description: "Production Event Reversal",
        amount: round(-Number(line.amount)),
        quantity: 1,
        documentType: "Production Event" as const,
        documentId: jobId,
        documentLineReference: eventReference,
        journalLineReference,
        companyId
      })),
      ...(laborAbsorption
        ? [
            {
              accountId: accountDefaults.data.workInProgressAccount,
              accountDefaultRole: null,
              description: "WIP Account",
              amount: round(debit("asset", cost)),
              quantity: 1,
              documentType: "Production Event" as const,
              documentId: jobId,
              documentLineReference: eventReference,
              journalLineReference,
              companyId
            },
            {
              accountId: laborAbsorption.accountId,
              accountDefaultRole: laborAbsorption.accountDefaultRole,
              description: "Labor/Machine Absorption",
              amount: round(credit("expense", cost)),
              quantity: 1,
              documentType: "Production Event" as const,
              documentId: jobId,
              documentLineReference: eventReference,
              journalLineReference,
              companyId
            }
          ]
        : []),
      ...(overheadAbsorption
        ? [
            {
              accountId: accountDefaults.data.workInProgressAccount,
              accountDefaultRole: null,
              description: "WIP Account (Overhead)",
              amount: round(debit("asset", overheadCost)),
              quantity: 1,
              documentType: "Production Event" as const,
              documentId: jobId,
              documentLineReference: eventReference,
              journalLineReference,
              companyId
            },
            {
              accountId: overheadAbsorption.accountId,
              accountDefaultRole: overheadAbsorption.accountDefaultRole,
              description: "Overhead Absorption",
              amount: round(credit("expense", overheadCost)),
              quantity: 1,
              documentType: "Production Event" as const,
              documentId: jobId,
              documentLineReference: eventReference,
              journalLineReference,
              companyId
            }
          ]
        : [])
    ];

    // A Provisional journal has no accounting period.
    const accountingPeriodId =
      postingStatus === "Posted"
        ? await getCurrentAccountingPeriod(companyId, db, today)
        : null;

    await db.transaction().execute(async (trx) => {
      await assertPostingStatusUnchanged(trx, companyId, postingStatus);

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
          status: postingStatus,
          postedAt: datetime.timestamp(),
          postedBy: userId,
          createdBy: userId
        })
        .returning(["id"])
        .executeTakeFirstOrThrow();

      const journalLineResults = await trx
        .insertInto("journalLine")
        .values(
          journalLineInserts.map((line) => ({
            ...line,
            journalId: journalResult.id
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
              companyId
            });
          }
          if (job.data.itemId && dimensionMap.has("Item")) {
            dimensionInserts.push({
              journalLineId: jl.id,
              dimensionId: dimensionMap.get("Item")!,
              valueId: job.data.itemId,
              companyId
            });
          }
          if (job.data.locationId && dimensionMap.has("Location")) {
            dimensionInserts.push({
              journalLineId: jl.id,
              dimensionId: dimensionMap.get("Location")!,
              valueId: job.data.locationId,
              companyId
            });
          }
          if (event.employeeId && dimensionMap.has("Employee")) {
            dimensionInserts.push({
              journalLineId: jl.id,
              dimensionId: dimensionMap.get("Employee")!,
              valueId: event.employeeId,
              companyId
            });
          }
          if (event.workCenterId && dimensionMap.has("WorkCenter")) {
            dimensionInserts.push({
              journalLineId: jl.id,
              dimensionId: dimensionMap.get("WorkCenter")!,
              valueId: event.workCenterId,
              companyId
            });
          }
          const processId = (event.jobOperation as any)?.processId as
            | string
            | null;
          if (processId && dimensionMap.has("Process")) {
            dimensionInserts.push({
              journalLineId: jl.id,
              dimensionId: dimensionMap.get("Process")!,
              valueId: processId,
              companyId
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
        .where("companyId", "=", companyId)
        .execute();
    });

    return { success: true };
  }
});

export default postProductionEvent;
