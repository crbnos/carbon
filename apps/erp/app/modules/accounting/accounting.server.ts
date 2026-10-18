// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineServiceFn } from "@carbon/api/service-fn.server";
import { paged, payload, unwrap } from "@carbon/api/service-tools.server";
import type { Database } from "@carbon/database";
import { fetchAllFromTable, fetchAllRecords } from "@carbon/database";
import type { RunType } from "@carbon/database/run-type";
import { round } from "@carbon/utils";
import { z } from "zod";
import {
  insertPurchaseOrder,
  upsertPurchaseOrderLine
} from "~/modules/purchasing/purchasing.service";
import { insertSalesOrder } from "~/modules/sales/sales.service";
import { invokeCreate, invokePosting } from "~/modules/shared/shared.service";
import { getUserDefaults } from "~/modules/users/users.service";
import { fromServerFn } from "../shared/shared.service";
import * as service from "./accounting.service";
import {
  accountMoveRefusal,
  depreciationRunLinesMatch,
  getNextPeriodEnd,
  getNextRevenueRecognitionPeriodEnd,
  monthEndOf
} from "./accounting.utils";

const runTypes = ["Revenue Recognition", "Lease"] as const satisfies RunType[];

// ── Depreciation runs ───────────────────────────────────────────────────────
/**
 * Create a Draft depreciation run.
 *
 * @remarks
 * `periodEnd` snaps to its month end; without it, the run is for the month
 * after the company's last depreciation run (the current month when there is
 * none). Refuses a period that does not end after the last run, a month that
 * has not started, and a period that already has a run. The run holds what
 * every active asset depreciates up to that month. With nothing to
 * depreciate, or when a later period's posted run already covers these
 * months, it refuses instead of creating a run. Refused before the company's
 * accounting cutover.
 *
 * @mcp
 */
export const createDepreciationRun = defineServiceFn({
  input: z.object({ periodEnd: z.string().optional() }),
  permission: { create: "accounting" },
  async run(ctx, input) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;

    const lastRun = await client
      .from("depreciationRun")
      .select("periodEnd")
      .eq("companyId", companyId)
      .order("periodEnd", { ascending: false })
      .limit(1);
    const lastPeriodEnd = lastRun.data?.[0]?.periodEnd ?? null;

    // Depreciation is monthly, so a picked date snaps to its month end, and it
    // must come after the last run: the calculation depreciates every month
    // from the last posted run up to it.
    const periodEnd = input.periodEnd
      ? monthEndOf(input.periodEnd)
      : getNextPeriodEnd(lastPeriodEnd);
    if (lastPeriodEnd && periodEnd <= lastPeriodEnd) {
      return ctx.error(
        "rule",
        "The period must end after the last depreciation run"
      );
    }

    const futureError = await service.futureRunPeriodError(
      client,
      companyId,
      periodEnd
    );
    if (futureError) return ctx.error("rule", futureError);

    const existing = await client
      .from("depreciationRun")
      .select("id")
      .eq("periodEnd", periodEnd)
      .eq("companyId", companyId);
    if (existing.data && existing.data.length > 0) {
      return ctx.error(
        "conflict",
        "A depreciation run already exists for this period"
      );
    }

    return service.createDepreciationRunAt(ctx, periodEnd);
  }
});

/**
 * Post a Draft depreciation run.
 *
 * @remarks
 * Refuses a run that is not Draft, a month that has not started, a run whose
 * months a later period's posted run already covers, and a run whose lines
 * no longer match what the assets should depreciate (recalculate it first).
 * Every asset's class must name its depreciation expense and accumulated
 * depreciation accounts. Posts one journal per month, each in its own period
 * (the run's period when that month is Closed), with the deferred tax
 * journals when tax depreciation is on, and adds the amounts to each asset's
 * accumulated depreciation. Refused before the company's accounting cutover.
 *
 * @mcp
 */
export const postDepreciationRun = defineServiceFn({
  input: z.object({ depreciationRunId: z.string() }),
  permission: { update: "accounting" },
  async run(ctx, { depreciationRunId }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const companyGroupId = ctx.company.groupId;

    const run = await client
      .from("depreciationRun")
      .select("*")
      .eq("id", depreciationRunId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (run.error) {
      return ctx.error("internal", "Failed to get depreciation run", run.error);
    }
    if (!run.data) return ctx.error("notFound", "Depreciation run not found");
    if (run.data.status !== "Draft") {
      return ctx.error("conflict", "Run is not in Draft status");
    }
    const { periodEnd, depreciationRunId: readableId } = run.data;

    const futureError = await service.futureRunPeriodError(
      client,
      companyId,
      periodEnd
    );
    if (futureError) return ctx.error("rule", futureError);

    const [settings, accountDefaults] = await Promise.all([
      client
        .from("companySettings")
        .select("assetTaxDepreciationEnabled, assetTaxRate")
        .eq("id", companyId)
        .single(),
      client
        .from("accountDefault")
        .select("deferredTaxLiabilityAccountId, deferredTaxExpenseAccountId")
        .eq("companyId", companyId)
        .single()
    ]);
    const taxEnabled = settings.data?.assetTaxDepreciationEnabled ?? false;
    const taxRate = settings.data?.assetTaxRate
      ? Number(settings.data.assetTaxRate)
      : null;
    const dtlAccountId =
      accountDefaults.data?.deferredTaxLiabilityAccountId ?? null;
    const dtExpenseAccountId =
      accountDefaults.data?.deferredTaxExpenseAccountId ?? null;

    const [lines, dimensions] = await Promise.all([
      // A catch-up run holds one line per asset per month: past PostgREST's
      // 1000-row cap for a large register.
      fetchAllFromTable<{
        id: string;
        fixedAssetId: string;
        periodEnd: string | null;
        amount: number;
        taxAmount: number | null;
        fixedAsset: {
          fixedAssetId: string;
          fixedAssetClass: {
            depreciationExpenseAccountId: string | null;
            accumulatedDepreciationAccountId: string | null;
          } | null;
        } | null;
      }>(
        client,
        "depreciationRunLine",
        "id, fixedAssetId, periodEnd, amount, taxAmount, fixedAsset:fixedAssetId(fixedAssetId, fixedAssetClass:fixedAssetClassId(depreciationExpenseAccountId, accumulatedDepreciationAccountId))",
        (query: any) =>
          query
            .eq("depreciationRunId", depreciationRunId)
            .eq("companyId", companyId)
            .order("id", { ascending: true })
      ),
      client
        .from("dimension")
        .select("id, entityType")
        .eq("companyGroupId", companyGroupId)
        .eq("active", true)
    ]);
    if (lines.error || !lines.data) {
      return ctx.error("internal", "Failed to fetch run lines", lines.error);
    }

    // A line from before per-month lines has no periodEnd: it is the run's.
    const lineMonth = (line: { periodEnd: string | null }) =>
      line.periodEnd ?? periodEnd;

    // A Draft is computed once. An asset disposed, added or re-valued since —
    // or a later period posted first — makes it post the wrong depreciation.
    const proposal = await service.buildDepreciationRunLines(client, {
      companyId,
      companyGroupId,
      periodEnd,
      runId: depreciationRunId
    });
    if (!proposal.data) {
      return ctx.error(
        "internal",
        "Failed to calculate depreciation",
        proposal.error
      );
    }
    if (proposal.data.laterPostedRunId) {
      return ctx.error(
        "rule",
        `${proposal.data.laterPostedRunId} is already posted for a later period and includes these months; delete ${readableId}`
      );
    }
    if (
      !depreciationRunLinesMatch(
        lines.data.map((line) => ({ ...line, periodEnd: lineMonth(line) })),
        proposal.data.lines
      )
    ) {
      return ctx.error(
        "conflict",
        `Depreciation run ${readableId} is out of date with the fixed assets; recalculate it before posting`
      );
    }

    // Each month posts in its own period (the run's when that month is Closed).
    const periods = await service.resolveRunPostingPeriods(client, {
      companyId,
      monthEnds: lines.data.map(lineMonth),
      runPeriodEnd: periodEnd
    });
    if (!periods.data) {
      return ctx.error(
        "internal",
        "Failed to get accounting period",
        periods.error
      );
    }

    for (const line of lines.data) {
      const assetClass = line.fixedAsset?.fixedAssetClass;
      if (
        !assetClass?.depreciationExpenseAccountId ||
        !assetClass?.accumulatedDepreciationAccountId
      ) {
        return ctx.error(
          "rule",
          `Asset ${line.fixedAsset?.fixedAssetId ?? line.fixedAssetId} is missing depreciation account configuration`
        );
      }
    }

    const dimensionId = (entityType: string) =>
      (dimensions.data ?? []).find((d) => d.entityType === entityType)?.id;

    try {
      await service.postDepreciationRun(ctx.asSystem.pg, {
        depreciationRunId,
        depreciationRunReadableId: readableId,
        periods: periods.data,
        lineIds: lines.data.map((line) => line.id),
        locationDimensionId: dimensionId("Location"),
        assetClassDimensionId: dimensionId("FixedAssetClass"),
        taxEnabled,
        taxRate,
        dtlAccountId,
        dtExpenseAccountId,
        companyId,
        userId: ctx.auditUserId
      });
    } catch (err) {
      return err instanceof service.RunOutOfDateError
        ? ctx.error("conflict", err.message, err)
        : service.refusal(ctx, err, "Failed to post depreciation run");
    }

    return { id: depreciationRunId, readableId };
  }
});

/**
 * Recalculate a Draft depreciation run.
 *
 * @remarks
 * Replaces the run's lines with what the assets should depreciate up to its
 * period end now, keeping its id and number. Refuses a run that is not Draft,
 * and one whose months a later period's posted run already covers. A run left
 * with nothing to depreciate is deleted (`deleted`); `changed` is false when
 * it already held exactly these lines.
 *
 * @mcp
 */
export const recalculateDepreciationRun = defineServiceFn({
  input: z.object({ depreciationRunId: z.string() }),
  permission: { update: "accounting" },
  async run(ctx, { depreciationRunId }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;

    const run = await client
      .from("depreciationRun")
      .select("depreciationRunId, periodEnd, status")
      .eq("id", depreciationRunId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (run.error) {
      return ctx.error("internal", "Failed to get depreciation run", run.error);
    }
    if (!run.data) return ctx.error("notFound", "Depreciation run not found");
    if (run.data.status !== "Draft") {
      return ctx.error("conflict", "Run is not in Draft status");
    }
    const readableId = run.data.depreciationRunId;

    const proposal = await service.buildDepreciationRunLines(client, {
      companyId,
      companyGroupId: ctx.company.groupId,
      periodEnd: run.data.periodEnd,
      runId: depreciationRunId
    });
    if (!proposal.data) {
      return ctx.error(
        "internal",
        "Failed to calculate depreciation",
        proposal.error
      );
    }
    if (proposal.data.laterPostedRunId) {
      return ctx.error(
        "rule",
        `${proposal.data.laterPostedRunId} is already posted for a later period and includes these months; delete ${readableId}`
      );
    }

    try {
      const result = await service.replaceDepreciationRunLines(
        ctx.asSystem.pg,
        {
          depreciationRunId,
          lines: proposal.data.lines,
          companyId,
          userId: ctx.auditUserId
        }
      );
      return {
        id: depreciationRunId,
        readableId,
        lineCount: proposal.data.lines.length,
        changed: result.changed,
        deleted: result.deleted
      };
    } catch (err) {
      return ctx.error(
        "internal",
        "Failed to recalculate depreciation run",
        err
      );
    }
  }
});

/**
 * Repeat a posted depreciation run for its own period.
 *
 * @remarks
 * Creates a Draft run at the posted run's period end holding only the active
 * assets no run at that period covers yet, such as assets registered after
 * it posted. Refuses a run that is not Posted, months a later period's posted
 * run already covers, and a repeat with nothing to depreciate.
 *
 * @mcp
 */
export const repeatDepreciationRun = defineServiceFn({
  input: z.object({ depreciationRunId: z.string() }),
  permission: { create: "accounting" },
  async run(ctx, { depreciationRunId }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;

    const sourceRun = await client
      .from("depreciationRun")
      .select("periodEnd, status")
      .eq("id", depreciationRunId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (sourceRun.error) {
      return ctx.error(
        "internal",
        "Failed to load source run",
        sourceRun.error
      );
    }
    if (!sourceRun.data) {
      return ctx.error("notFound", "Depreciation run not found");
    }
    if (sourceRun.data.status !== "Posted") {
      return ctx.error("rule", "Only posted runs can be repeated");
    }
    const { periodEnd } = sourceRun.data;

    // No runId: every run already at this period covers its assets, so the
    // repeat holds only the active assets none of them does.
    const proposal = await service.buildDepreciationRunLines(client, {
      companyId,
      companyGroupId: ctx.company.groupId,
      periodEnd
    });
    if (!proposal.data) {
      return ctx.error(
        "internal",
        "Failed to calculate depreciation",
        proposal.error
      );
    }
    if (proposal.data.laterPostedRunId) {
      return ctx.error(
        "rule",
        `${proposal.data.laterPostedRunId} is already posted for a later period and includes these months`
      );
    }
    const { lines } = proposal.data;
    if (lines.length === 0) {
      return ctx.error(
        "rule",
        "Every active asset is already covered for this period, or has nothing to depreciate"
      );
    }

    const created = await service.insertDepreciationRun(client, {
      periodEnd,
      lines,
      companyId,
      createdBy: ctx.auditUserId
    });
    if (created.error || !created.data) {
      return ctx.error(
        "internal",
        "Failed to create repeat depreciation run",
        created.error
      );
    }
    return { id: created.data.id, readableId: created.data.depreciationRunId };
  }
});

/**
 * Reverse a posted depreciation run.
 *
 * @remarks
 * Only the latest posted run can be reversed. Reverses every journal the run
 * posted, each on its own date or on today when its period is Closed, takes
 * the amounts back off each asset's accumulated depreciation and returns the
 * run to Draft.
 *
 * @mcp destructive
 */
export const reverseDepreciationRun = defineServiceFn({
  input: z.object({ depreciationRunId: z.string() }),
  permission: { update: "accounting" },
  async run(ctx, { depreciationRunId }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;

    // Every journal the run posted: each month's, and each month's deferred
    // tax. One line per asset per month: past PostgREST's 1000-row cap.
    const lines = await fetchAllRecords(() =>
      client
        .from("depreciationRunLine")
        .select(
          "id, journal:journalId(postingDate), deferredTaxJournal:deferredTaxJournalId(postingDate)"
        )
        .eq("depreciationRunId", depreciationRunId)
        .eq("companyId", companyId)
        .order("id")
    );
    if (lines.error || !lines.data) {
      return ctx.error(
        "internal",
        "Failed to load depreciation run",
        lines.error
      );
    }

    // Each journal reverses on its own date, or today when that period is
    // Closed.
    const periods = await service.resolveReversalPeriods(client, {
      companyId,
      postingDates: lines.data.flatMap((line) =>
        [
          line.journal?.postingDate,
          line.deferredTaxJournal?.postingDate
        ].filter((date): date is string => Boolean(date))
      )
    });
    if (!periods.data) {
      return ctx.error(
        "internal",
        "Failed to get accounting period",
        periods.error
      );
    }

    try {
      const reversed = await service.reverseDepreciationRun(ctx.asSystem.pg, {
        depreciationRunId,
        periods: periods.data,
        companyId,
        userId: ctx.auditUserId
      });
      return { id: depreciationRunId, readableId: reversed.depreciationRunId };
    } catch (err) {
      return err instanceof service.RunReversalError
        ? ctx.error("rule", err.message, err)
        : ctx.error("internal", "Failed to reverse depreciation run", err);
    }
  }
});

// ── Revenue recognition and lease runs ──────────────────────────────────────
/**
 * Create a Draft revenue recognition or lease run.
 *
 * @remarks
 * `periodEnd` snaps to its month end; without it, the run is for the month
 * after the last run of its type (the month before the current one when there
 * is none). The run claims every Planned schedule row of its type due by the
 * period end, after the type's synthesizers add contract revenue (revenue
 * runs) or rental accruals (lease runs). Refuses a month that has not
 * started, a period that already has a Draft of the type, and a period with
 * nothing due. Refused before the company's accounting cutover.
 *
 * @mcp
 */
export const createRevenueRecognitionRun = defineServiceFn({
  input: z.object({
    type: z.enum(runTypes),
    periodEnd: z.string().optional()
  }),
  permission: { create: "accounting" },
  async run(ctx, { type, periodEnd }) {
    if (periodEnd) {
      // Schedule rows fall on month ends, so a picked day means its month: a
      // mid-month date would leave that month's rows out. Depreciation runs
      // snap the same way.
      return service.proposeRunAt(ctx, monthEndOf(periodEnd), type);
    }

    const client = ctx.asCaller.supabase;
    const lastRun = await client
      .from("revenueRecognitionRun")
      .select("periodEnd")
      .eq("companyId", ctx.company.id)
      .eq("type", type)
      .order("periodEnd", { ascending: false })
      .limit(1);
    return service.proposeRunAt(
      ctx,
      getNextRevenueRecognitionPeriodEnd(
        lastRun.data?.[0]?.periodEnd ?? null,
        await service.getCompanyToday(client, ctx.company.id)
      ),
      type
    );
  }
});

/**
 * Post a Draft revenue recognition or lease run.
 *
 * @remarks
 * Refuses a run that is not Draft, a month that has not started, and a run
 * that is out of date: a held row's amount or status changed, or a Planned
 * row of its type is due by its period end and not in it (recalculate it
 * first). Posts one journal per month the rows fall in, each in that month's
 * period (the run's period when that month is Closed), with the Customer,
 * Item, Location, Project and Supplier dimensions, and marks the rows
 * Posted. Refused before the company's accounting cutover.
 *
 * @mcp
 */
export const postRevenueRecognitionRun = defineServiceFn({
  input: z.object({ runId: z.string() }),
  permission: { update: "accounting" },
  async run(ctx, { runId }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;

    const run = await client
      .from("revenueRecognitionRun")
      .select("periodEnd, status")
      .eq("id", runId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (run.error) {
      return ctx.error("internal", "Failed to get the run", run.error);
    }
    if (!run.data) return ctx.error("notFound", "Run not found");
    if (run.data.status !== "Draft") {
      return ctx.error("conflict", "Run is not in Draft status");
    }

    const futureError = await service.futureRunPeriodError(
      client,
      companyId,
      run.data.periodEnd
    );
    if (futureError) return ctx.error("rule", futureError);

    // Each row posts in the period of the month it was scheduled for (the
    // run's own period when that month is Closed).
    const [scheduledLines, dimensions] = await Promise.all([
      // A run claims every due row of the company: past PostgREST's 1000-row
      // cap, an unread month would have no period and fail the post.
      fetchAllRecords(() =>
        client
          .from("revenueRecognitionRunLine")
          .select(
            "id, schedule:revenueRecognitionSchedule!revenueRecognitionRunLine_schedule_fkey(scheduledDate)"
          )
          .eq("runId", runId)
          .eq("companyId", companyId)
          .order("id")
      ),
      client
        .from("dimension")
        .select("id, entityType")
        .eq("companyGroupId", ctx.company.groupId)
        .eq("active", true)
    ]);
    if (scheduledLines.error || !scheduledLines.data) {
      return ctx.error(
        "internal",
        "Failed to load revenue recognition run",
        scheduledLines.error
      );
    }

    const periods = await service.resolveRunPostingPeriods(client, {
      companyId,
      monthEnds: scheduledLines.data.flatMap((line) =>
        line.schedule ? [monthEndOf(line.schedule.scheduledDate)] : []
      ),
      runPeriodEnd: run.data.periodEnd
    });
    if (!periods.data) {
      return ctx.error(
        "internal",
        "Failed to get accounting period",
        periods.error
      );
    }

    const dimensionId = (entityType: string) =>
      (dimensions.data ?? []).find((d) => d.entityType === entityType)?.id;

    try {
      await service.postRevenueRecognitionRun(ctx.asSystem.pg, {
        runId,
        companyId,
        userId: ctx.auditUserId,
        periods: periods.data,
        dimensionIds: {
          customer: dimensionId("Customer"),
          item: dimensionId("Item"),
          location: dimensionId("Location"),
          project: dimensionId("Project"),
          supplier: dimensionId("Supplier")
        }
      });
    } catch (err) {
      return err instanceof service.RunOutOfDateError
        ? ctx.error("conflict", err.message, err)
        : service.refusal(ctx, err, "Failed to post revenue recognition run");
    }

    return { id: runId };
  }
});

/**
 * Repeat a posted revenue recognition or lease run for the next month.
 *
 * @remarks
 * Creates a Draft run of the same type for the month after the posted run's
 * period end, claiming every Planned row of the type due by then. Refuses a
 * run that is not Posted, a month that has not started, a month that already
 * has a Draft of the type, and a month with nothing due.
 *
 * @mcp
 */
export const repeatRevenueRecognitionRun = defineServiceFn({
  input: z.object({ runId: z.string() }),
  permission: { create: "accounting" },
  async run(ctx, { runId }) {
    const sourceRun = await ctx.asCaller.supabase
      .from("revenueRecognitionRun")
      .select("periodEnd, status, type")
      .eq("id", runId)
      .eq("companyId", ctx.company.id)
      .maybeSingle();
    if (sourceRun.error) {
      return ctx.error(
        "internal",
        "Failed to load source run",
        sourceRun.error
      );
    }
    if (!sourceRun.data) return ctx.error("notFound", "Run not found");
    if (sourceRun.data.status !== "Posted") {
      return ctx.error("rule", "Only posted runs can be repeated");
    }
    return service.proposeRunAt(
      ctx,
      getNextPeriodEnd(sourceRun.data.periodEnd),
      sourceRun.data.type
    );
  }
});

/**
 * Reverse a posted revenue recognition or lease run.
 *
 * @remarks
 * Reverses every journal the run posted, each on its own date or on today
 * when its period is Closed, puts its rows back to Planned under the same run
 * and clears what posting stamped (lease schedule lines, contract ledger
 * entries and revenue months), then returns the run to Draft. A legacy
 * revenue run that held only lease rows gives them to the next lease run and
 * is deleted (`deleted`).
 *
 * @mcp destructive
 */
export const reverseRevenueRecognitionRun = defineServiceFn({
  input: z.object({ runId: z.string() }),
  permission: { update: "accounting" },
  async run(ctx, { runId }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;

    // Every journal the run posted, through the schedule rows it holds.
    const lines = await client
      .from("revenueRecognitionRunLine")
      .select(
        "schedule:revenueRecognitionSchedule!revenueRecognitionRunLine_schedule_fkey(journal:journalId(postingDate))"
      )
      .eq("runId", runId)
      .eq("companyId", companyId);
    if (lines.error) {
      return ctx.error(
        "internal",
        "Failed to load revenue recognition run",
        lines.error
      );
    }

    // Each journal reverses on its own date, or today when that period is
    // Closed.
    const periods = await service.resolveReversalPeriods(client, {
      companyId,
      postingDates: lines.data.flatMap((line) =>
        line.schedule?.journal?.postingDate
          ? [line.schedule.journal.postingDate]
          : []
      )
    });
    if (!periods.data) {
      return ctx.error(
        "internal",
        "Failed to get accounting period",
        periods.error
      );
    }

    try {
      const reversed = await service.reverseRevenueRecognitionRun(
        ctx.asSystem.pg,
        {
          runId,
          periods: periods.data,
          companyId,
          userId: ctx.auditUserId
        }
      );
      return {
        id: runId,
        readableId: reversed.runId,
        deleted: reversed.deleted
      };
    } catch (err) {
      return err instanceof service.RunReversalError
        ? ctx.error("rule", err.message, err)
        : ctx.error(
            "internal",
            "Failed to reverse revenue recognition run",
            err
          );
    }
  }
});

/**
 * Recalculate a Draft revenue recognition or lease run.
 *
 * @remarks
 * Keeps the run's id and number, releases its rows, runs its type's
 * synthesizers again and claims every Planned row of the type due by its
 * period end. A run with nothing due any more is deleted (`deleted`);
 * `changed` is false when it already held exactly these rows. Refuses a run
 * that is not Draft. Refused before the company's accounting cutover.
 *
 * @mcp
 */
export const recalculateRevenueRecognitionRun = defineServiceFn({
  input: z.object({ runId: z.string() }),
  permission: { update: "accounting" },
  async run(ctx, { runId }) {
    // A run left with nothing due is deleted: the caller goes back to its
    // own type's list.
    const run = await ctx.asCaller.supabase
      .from("revenueRecognitionRun")
      .select("type")
      .eq("id", runId)
      .eq("companyId", ctx.company.id)
      .maybeSingle();

    const result = await invokePosting(
      ctx,
      "recalculate-revenue-recognition-run",
      { runId },
      service.recalculateRevenueRecognitionRun
    );
    if (result.error) {
      return fromServerFn(
        ctx,
        result.error,
        "Failed to recalculate revenue recognition run"
      );
    }
    return {
      id: runId,
      readableId: result.data.runId,
      type: run.data?.type ?? ("Revenue Recognition" as RunType),
      lineCount: result.data.lineCount,
      changed: result.data.changed,
      deleted: result.data.deleted
    };
  }
});

/**
 * Delete a Draft revenue recognition or lease run.
 *
 * @remarks
 * Releases the rows the run claimed, so a later run can claim them again,
 * then deletes it. A Posted run is never deleted: reverse it first.
 *
 * @mcp destructive
 */
export const deleteRevenueRecognitionRun = defineServiceFn({
  input: z.object({ runId: z.string() }),
  permission: { delete: "accounting" },
  async run(ctx, { runId }) {
    const run = await ctx.asCaller.supabase
      .from("revenueRecognitionRun")
      .select("type")
      .eq("id", runId)
      .eq("companyId", ctx.company.id)
      .maybeSingle();
    if (run.error) {
      return ctx.error("internal", "Failed to get the run", run.error);
    }
    if (!run.data) return ctx.error("notFound", "Run not found");

    try {
      await service.deleteRevenueRecognitionRun(ctx.asSystem.pg, {
        runId,
        companyId: ctx.company.id,
        userId: ctx.auditUserId
      });
    } catch (err) {
      return service.refusal(ctx, err, "Failed to delete the run");
    }
    return { id: runId, type: run.data.type };
  }
});

// ── Period close ────────────────────────────────────────────────────────────

/**
 * Lock an accounting period.
 *
 * @remarks
 * Only an Open period can be locked. A Locked period refuses operational
 * documents (receipts, shipments, invoices) and still takes accounting
 * adjustments such as depreciation and disposals. A period must be locked
 * before it can be closed. Refused before the company's accounting cutover.
 *
 * @mcp
 */
export const lockPeriod = defineServiceFn({
  input: z.object({ periodId: z.string() }),
  permission: { update: "accounting" },
  async run(ctx, { periodId }) {
    const result = await service.lockAccountingPeriod(ctx.asCaller.supabase, {
      periodId,
      companyId: ctx.company.id,
      userId: ctx.auditUserId
    });
    if (result.error)
      return service.refusal(ctx, result.error, "Failed to lock period");
    return { periodId, closeStatus: "Locked" as const };
  }
});

/**
 * Unlock an accounting period.
 *
 * @remarks
 * Only a Locked period can be unlocked. It returns to Open.
 *
 * @mcp
 */
export const unlockPeriod = defineServiceFn({
  input: z.object({ periodId: z.string() }),
  permission: { update: "accounting" },
  async run(ctx, { periodId }) {
    const result = await service.unlockAccountingPeriod(ctx.asCaller.supabase, {
      periodId,
      companyId: ctx.company.id,
      userId: ctx.auditUserId
    });
    if (result.error) {
      return service.refusal(ctx, result.error, "Failed to unlock period");
    }
    return { periodId, closeStatus: "Open" as const };
  }
});

/**
 * Close an accounting period.
 *
 * @remarks
 * Evaluates the period's close checklist and refuses while a Blocker check
 * fails or a required task is still Open (the refusal says which). Then it
 * records the final state of the automatic tasks, closes the period and
 * snapshots every account's balance at its end. Periods close in order.
 * Refused before the company's accounting cutover.
 *
 * @mcp
 */
export const closePeriod = defineServiceFn({
  input: z.object({ periodId: z.string() }),
  permission: { update: "accounting" },
  async run(ctx, { periodId }) {
    const result = await service.closePeriodWithChecklist(
      ctx.asCaller.supabase,
      ctx.asSystem.pg,
      {
        companyId: ctx.company.id,
        companyGroupId: ctx.company.groupId,
        periodId,
        userId: ctx.auditUserId
      }
    );
    if (result.error)
      return service.refusal(ctx, result.error, "Failed to close period");
    return { periodId };
  }
});

/**
 * Create the run a period close task waits on.
 *
 * @remarks
 * `run` names it: a revenue recognition, lease or depreciation run for the
 * period's end date. Refuses a period that ends in a month that has not
 * started, and a period that already has a Draft run of that kind
 * (recalculate it instead). Otherwise it creates the run as New Run does,
 * which refuses a period with nothing due.
 *
 * @mcp
 */
export const createRunForPeriod = defineServiceFn({
  input: z.object({
    periodId: z.string(),
    run: z.enum([...runTypes, "Depreciation"])
  }),
  permission: { create: "accounting", update: "accounting" },
  async run(ctx, { periodId, run }) {
    const client = ctx.asCaller.supabase;
    const period = await client
      .from("accountingPeriod")
      .select("endDate")
      .eq("id", periodId)
      .eq("companyId", ctx.company.id)
      .maybeSingle();
    if (period.error) {
      return ctx.error("internal", "Failed to load the period", period.error);
    }
    if (!period.data) return ctx.error("notFound", "Period not found");
    const periodEnd = period.data.endDate;

    if (run !== "Depreciation") {
      const created = await service.proposeRunAt(ctx, periodEnd, run);
      return created instanceof Error ? created : { ...created, run };
    }

    const futureError = await service.futureRunPeriodError(
      client,
      ctx.company.id,
      periodEnd
    );
    if (futureError) return ctx.error("rule", futureError);

    // One Draft per period: recalculate it rather than make another.
    const existingDraft = await client
      .from("depreciationRun")
      .select("id, depreciationRunId")
      .eq("periodEnd", periodEnd)
      .eq("companyId", ctx.company.id)
      .eq("status", "Draft")
      .limit(1)
      .maybeSingle();
    if (existingDraft.data) {
      return ctx.error(
        "conflict",
        `${existingDraft.data.depreciationRunId} is already a draft for this period. Recalculate it instead.`,
        { draftRunId: existingDraft.data.id }
      );
    }

    const created = await service.createDepreciationRunAt(ctx, periodEnd);
    return created instanceof Error ? created : { ...created, run };
  }
});

/**
 * Mark a period close task done.
 *
 * @remarks
 * For Action and Manual tasks: an automatic task is evaluated by the system
 * and cannot be completed by hand. `notes` are kept on the task.
 *
 * @mcp
 */
export const closeTaskComplete = defineServiceFn({
  input: z.object({ taskId: z.string(), notes: z.string().optional() }),
  permission: { update: "accounting" },
  async run(ctx, { taskId, notes }) {
    const result = await service.completeCloseTask(ctx.asCaller.supabase, {
      taskId,
      notes,
      companyId: ctx.company.id,
      userId: ctx.auditUserId
    });
    if (result.error) {
      return service.refusal(ctx, result.error, "Failed to complete task");
    }
    return { taskId, status: "Done" as const };
  }
});

/**
 * Skip a period close task, with a reason.
 *
 * @remarks
 * A Blocker task can never be skipped: resolve what it checks instead. The
 * reason is required.
 *
 * @mcp
 */
export const closeTaskSkip = defineServiceFn({
  input: z.object({ taskId: z.string(), skippedReason: z.string() }),
  permission: { update: "accounting" },
  async run(ctx, { taskId, skippedReason }) {
    const result = await service.skipCloseTask(ctx.asCaller.supabase, {
      taskId,
      skippedReason,
      companyId: ctx.company.id,
      userId: ctx.auditUserId
    });
    if (result.error)
      return service.refusal(ctx, result.error, "Failed to skip task");
    return { taskId, status: "Skipped" as const };
  }
});

// ── Journal entries ─────────────────────────────────────────────────────────

/**
 * Create an empty Draft manual journal entry.
 *
 * @remarks
 * Takes the next journal entry number. Add its lines and post it with
 * `saveJournalEntry`.
 *
 * @mcp
 */
export const createJournalEntry = defineServiceFn({
  input: z.object({}),
  permission: { create: "accounting" },
  async run(ctx) {
    const created = await invokeCreate(ctx, {
      type: "journalEntry"
    });
    if (created.error || !created.data) {
      return ctx.error(
        "internal",
        "Failed to create journal entry",
        created.error
      );
    }
    return { id: String(created.data.id) };
  }
});

const journalLineInput = z.object({
  /** The stored line this one edits; a line without one is inserted. */
  id: z.string().optional(),
  accountId: z.string(),
  description: z.string().optional(),
  debit: z.number(),
  credit: z.number(),
  dimensions: z
    .array(z.object({ dimensionId: z.string(), valueId: z.string() }))
    .optional()
});

/**
 * Save a Draft manual journal entry with its lines, and post it.
 *
 * @remarks
 * Every line needs an account and exactly one of a debit or a credit. The
 * lines replace the entry's stored lines: a line whose `id` matches a stored
 * one is updated in place, any other is inserted, and stored lines not sent
 * are deleted. Only a Draft entry of the company can be saved. With `post`
 * the entry is then posted, which refuses an entry whose debits and credits
 * differ, and refuses before the company's accounting cutover.
 *
 * @mcp destructive
 */
export const saveJournalEntry = defineServiceFn({
  input: z.object({
    journalEntryId: z.string(),
    postingDate: z.string(),
    description: z.string().optional(),
    lines: z.array(journalLineInput),
    post: z.boolean().optional()
  }),
  permission: { update: "accounting" },
  async run(ctx, { journalEntryId, postingDate, description, lines, post }) {
    if (!postingDate) {
      return ctx.error("validation", "Posting date is required");
    }
    for (const line of lines) {
      if (!line.accountId) {
        return ctx.error("validation", "Each line must have an account");
      }
      if (
        (line.debit <= 0 && line.credit <= 0) ||
        (line.debit > 0 && line.credit > 0)
      ) {
        return ctx.error(
          "validation",
          "Each line must have either a debit or credit amount"
        );
      }
    }

    const saved = await service.saveJournalEntryWithLines(
      ctx.asCaller.supabase,
      {
        journalEntryId,
        postingDate,
        description,
        updatedBy: ctx.auditUserId,
        lines,
        companyId: ctx.company.id,
        companyGroupId: ctx.company.groupId
      }
    );
    if (saved.error) {
      return service.refusal(ctx, saved.error, "Failed to save journal entry");
    }

    if (post) {
      const posted = await service.postJournalEntry(
        ctx.asCaller.supabase,
        journalEntryId,
        ctx.auditUserId
      );
      if (posted.error) {
        return service.refusal(
          ctx,
          posted.error,
          "Failed to post journal entry"
        );
      }
    }
    return { journalEntryId, posted: post === true };
  }
});

// ── Fixed assets ────────────────────────────────────────────────────────────
/**
 * Take a fixed asset out of service.
 *
 * @remarks
 * Records today (in the company's time zone) and the reason. The asset stays
 * Active and keeps depreciating; its fleet status reads In Maintenance, and
 * it cannot be returned to inventory until it is back in service. Refuses an
 * asset that is Disposed or already out of service, and a unit on rent:
 * return it from its rental agreement, which can take it out of service.
 *
 * @mcp
 */
export const takeFixedAssetOutOfService = defineServiceFn({
  input: z.object({
    fixedAssetId: z.string(),
    reason: z.string().trim().min(1, { message: "Reason is required" })
  }),
  permission: { update: "accounting" },
  async run(ctx, { fixedAssetId, reason }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const refused = await service.outOfServiceRefusal(
      client,
      ctx.asSystem.supabase,
      fixedAssetId,
      companyId
    );
    if (refused) {
      return ctx.error(refused.category, refused.message, refused.cause);
    }

    const result = await service.setFixedAssetOutOfService(client, {
      id: fixedAssetId,
      companyId,
      reason,
      since: await service.getCompanyToday(client, companyId),
      updatedBy: ctx.auditUserId
    });
    if (result.error) {
      return ctx.error(
        "internal",
        "Failed to take the asset out of service",
        result.error
      );
    }
    return { fixedAssetId };
  }
});

/**
 * Return a fixed asset to service.
 *
 * @remarks
 * Clears the out-of-service date and reason. Its fleet status reads
 * Available (or On Rent / Reserved) again.
 *
 * @mcp
 */
export const returnFixedAssetToService = defineServiceFn({
  input: z.object({ fixedAssetId: z.string() }),
  permission: { update: "accounting" },
  async run(ctx, { fixedAssetId }) {
    const result = await service.returnFixedAssetToService(
      ctx.asCaller.supabase,
      {
        id: fixedAssetId,
        companyId: ctx.company.id,
        updatedBy: ctx.auditUserId
      }
    );
    if (result.error) {
      return ctx.error(
        "internal",
        "Failed to return the asset to service",
        result.error
      );
    }
    return { fixedAssetId };
  }
});

// A construction-in-progress asset collects purchased cost alongside job
// cost, so it can still be purchased while Under Construction; receipt and
// invoice posting add a CIP cost row and leave its status alone.
const PURCHASABLE_ASSET_STATUSES: string[] = ["Draft", "Under Construction"];
const SELLABLE_ASSET_STATUSES: string[] = ["Active", "Fully Depreciated"];

/**
 * Buy a fixed asset: a Draft purchase order with one Fixed Asset line.
 *
 * @remarks
 * Only a Draft or Under Construction asset can be purchased. The order is for
 * `supplierId`, at the asset's location (else the caller's default
 * location), with one line for the asset: quantity 1, price 0, to be priced
 * on the order. Receiving and invoicing the line capitalize the asset.
 *
 * @mcp
 */
export const purchaseFixedAsset = defineServiceFn({
  input: z.object({ fixedAssetId: z.string(), supplierId: z.string() }),
  permission: { create: "purchasing" },
  async run(ctx, { fixedAssetId, supplierId }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;

    const [asset, defaults] = await Promise.all([
      service.getFixedAsset(client, fixedAssetId, companyId),
      getUserDefaults(client, ctx.auditUserId, companyId)
    ]);
    if (asset.error || !asset.data) {
      return ctx.error("notFound", "Failed to get fixed asset", asset.error);
    }
    if (!PURCHASABLE_ASSET_STATUSES.includes(asset.data.status)) {
      return ctx.error(
        "rule",
        "Only a Draft or Under Construction asset can be purchased"
      );
    }

    const locationId = asset.data.locationId ?? defaults.data?.locationId ?? "";

    const order = await insertPurchaseOrder(client, {
      supplierId,
      locationId,
      status: "Draft",
      purchaseOrderType: "Purchase",
      companyId,
      companyGroupId: ctx.company.groupId,
      createdBy: ctx.auditUserId
    });
    if (order.error || !order.data) {
      return ctx.error(
        "internal",
        "Failed to create purchase order",
        order.error
      );
    }
    const purchaseOrderId = order.data.id;

    const line = await upsertPurchaseOrderLine(client, {
      purchaseOrderId,
      purchaseOrderLineType: "Fixed Asset",
      assetId: fixedAssetId,
      description: asset.data.name,
      locationId,
      purchaseQuantity: 1,
      supplierUnitPrice: 0,
      supplierShippingCost: 0,
      supplierTaxAmount: 0,
      taxPercent: 0,
      exchangeRate: 1,
      purchaseUnitOfMeasureCode: "EA",
      inventoryUnitOfMeasureCode: "EA",
      conversionFactor: 1,
      companyId,
      createdBy: ctx.auditUserId
    });
    if (line.error) {
      // No order without its asset line: the caller would be left with an
      // empty Draft it may not be allowed to delete.
      const removed = await ctx.asSystem.supabase
        .from("purchaseOrder")
        .delete()
        .eq("id", purchaseOrderId)
        .eq("companyId", companyId);
      return ctx.error(
        "internal",
        "Failed to add the asset to the purchase order",
        { line: line.error, cleanup: removed.error }
      );
    }
    return { purchaseOrderId };
  }
});

/**
 * Sell a fixed asset: a Draft sales order with one Fixed Asset line.
 *
 * @remarks
 * Only an Active or Fully Depreciated asset can be sold. The order is for
 * `customerId`, at the asset's location (else the caller's default
 * location), with one line for the asset priced at its net book value
 * (acquisition cost less accumulated depreciation). Shipping and invoicing
 * the line dispose of the asset.
 *
 * @mcp
 */
export const sellFixedAsset = defineServiceFn({
  input: z.object({ fixedAssetId: z.string(), customerId: z.string() }),
  permission: { create: "sales" },
  async run(ctx, { fixedAssetId, customerId }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;

    const [asset, defaults] = await Promise.all([
      service.getFixedAsset(client, fixedAssetId, companyId),
      getUserDefaults(client, ctx.auditUserId, companyId)
    ]);
    if (asset.error || !asset.data) {
      return ctx.error("notFound", "Failed to get fixed asset", asset.error);
    }
    if (!SELLABLE_ASSET_STATUSES.includes(asset.data.status)) {
      return ctx.error("rule", "Only active assets can be sold");
    }

    const order = await insertSalesOrder(client, {
      customerId,
      locationId: asset.data.locationId ?? defaults.data?.locationId ?? "",
      status: "Draft",
      companyId,
      companyGroupId: ctx.company.groupId,
      createdBy: ctx.auditUserId
    });
    if (order.error || !order.data) {
      return ctx.error("internal", "Failed to create sales order", order.error);
    }
    const salesOrderId = order.data.id;

    const line = await client.from("salesOrderLine").insert({
      salesOrderId,
      salesOrderLineType: "Fixed Asset",
      assetId: fixedAssetId,
      description: asset.data.name,
      saleQuantity: 1,
      unitPrice: round(
        Number(asset.data.acquisitionCost) -
          Number(asset.data.accumulatedDepreciation)
      ),
      locationId: asset.data.locationId ?? "",
      taxPercent: 0,
      exchangeRate: 1,
      companyId,
      createdBy: ctx.auditUserId
    });
    if (line.error) {
      // No order without its asset line, as `purchaseFixedAsset`.
      const removed = await ctx.asSystem.supabase
        .from("salesOrder")
        .delete()
        .eq("id", salesOrderId)
        .eq("companyId", companyId);
      return ctx.error(
        "internal",
        "Failed to add the asset to the sales order",
        { line: line.error, cleanup: removed.error }
      );
    }
    return { salesOrderId };
  }
});

/**
 * Scrap a fixed asset.
 *
 * @remarks
 * Only an Active or Fully Depreciated asset can be disposed. Posts the
 * disposal journal on `disposalDate`, in that date's period: Dr accumulated
 * depreciation, Dr the class's loss on disposal account for the whole net
 * book value, Cr the asset account at cost. Records the disposal (no
 * proceeds) and sets the asset Disposed. A sale goes through a sales order
 * instead (`sellFixedAsset`). Refused before the company's accounting
 * cutover.
 *
 * @mcp destructive
 */
export const disposeFixedAsset = defineServiceFn({
  input: z.object({
    fixedAssetId: z.string(),
    disposalDate: z.string().min(1, { message: "Disposal date is required" })
  }),
  permission: { update: "accounting" },
  async run(ctx, { fixedAssetId, disposalDate }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;

    const [asset, dimensions] = await Promise.all([
      client
        .from("fixedAsset")
        .select("*, fixedAssetClass:fixedAssetClassId(*)")
        .eq("id", fixedAssetId)
        .eq("companyId", companyId)
        .single(),
      client
        .from("dimension")
        .select("id, entityType")
        .eq("companyGroupId", ctx.company.groupId)
        .eq("active", true)
    ]);
    if (asset.error || !asset.data.fixedAssetClass) {
      return ctx.error("notFound", "Failed to get asset", asset.error);
    }
    if (!SELLABLE_ASSET_STATUSES.includes(asset.data.status)) {
      return ctx.error(
        "rule",
        "Only Active or Fully Depreciated assets can be disposed"
      );
    }
    const assetClass = asset.data.fixedAssetClass;

    const period = await service.getOrCreateAccountingPeriod(
      client,
      companyId,
      disposalDate,
      "accounting"
    );
    if (period.error || !period.data) {
      return ctx.error(
        "internal",
        "Failed to get accounting period",
        period.error
      );
    }

    const dimensionId = (entityType: string) =>
      (dimensions.data ?? []).find((d) => d.entityType === entityType)?.id;

    try {
      await service.postDisposal(ctx.asSystem.pg, {
        fixedAssetId,
        fixedAssetReadableId: asset.data.fixedAssetId,
        disposalDate,
        disposalMethod: "Scrapping",
        acquisitionCost: Number(asset.data.acquisitionCost),
        accumulatedDepreciation: Number(asset.data.accumulatedDepreciation),
        locationId: asset.data.locationId,
        fixedAssetClassId: asset.data.fixedAssetClassId,
        assetAccountId: assetClass.assetAccountId,
        accumulatedDepreciationAccountId:
          assetClass.accumulatedDepreciationAccountId,
        lossOnDisposalAccountId: assetClass.lossOnDisposalAccountId,
        accountingPeriodId: period.data,
        locationDimensionId: dimensionId("Location"),
        assetClassDimensionId: dimensionId("FixedAssetClass"),
        companyId,
        userId: ctx.auditUserId
      });
    } catch (err) {
      return service.refusal(ctx, err, "Failed to post asset disposal");
    }
    return { fixedAssetId };
  }
});

/**
 * Register a Draft fixed asset onto the books.
 *
 * @remarks
 * Posts the acquisition journal on `acquisitionDate`: Dr the class's asset
 * account at `acquisitionCost`, Cr accumulated depreciation for an asset
 * capitalized mid-life (`accumulatedDepreciation`), Cr retained earnings for
 * the net book value. The journal is Provisional before the company's
 * accounting cutover and Posted after it, in that date's period. Then the
 * asset becomes Active, or Under Construction in a construction-in-progress
 * class, in the same transaction. Only a Draft asset can be registered.
 *
 * @mcp
 */
export const registerFixedAsset = defineServiceFn({
  input: z.object({
    fixedAssetId: z.string(),
    acquisitionCost: z
      .number()
      .positive({ message: "Acquisition cost must be positive" }),
    acquisitionDate: z
      .string()
      .min(1, { message: "Acquisition date is required" }),
    accumulatedDepreciation: z
      .number()
      .min(0, { message: "Accumulated depreciation must be >= 0" }),
    depreciationStartDate: z
      .string()
      .min(1, { message: "Depreciation start date is required" })
  }),
  permission: { update: "accounting" },
  async run(ctx, { fixedAssetId, ...registration }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;

    const [asset, defaults, dimensions] = await Promise.all([
      client
        .from("fixedAsset")
        .select(
          "fixedAssetId, locationId, fixedAssetClassId, fixedAssetClass:fixedAssetClassId(assetAccountId, accumulatedDepreciationAccountId, isConstructionInProgress)"
        )
        .eq("id", fixedAssetId)
        .eq("companyId", companyId)
        .single(),
      service.getDefaultAccounts(client, companyId),
      client
        .from("dimension")
        .select("id, entityType")
        .eq("companyGroupId", ctx.company.groupId)
        .eq("active", true)
    ]);
    if (asset.error || !asset.data?.fixedAssetClass) {
      return ctx.error("notFound", "Failed to get fixed asset", asset.error);
    }
    if (defaults.error) {
      return ctx.error(
        "internal",
        "Failed to get the default accounts",
        defaults.error
      );
    }
    if (dimensions.error) {
      return ctx.error(
        "internal",
        "Failed to resolve dimensions",
        dimensions.error
      );
    }

    const assetClass = asset.data.fixedAssetClass;
    const dimensionId = (entityType: string) =>
      dimensions.data.find((d) => d.entityType === entityType)?.id;

    try {
      // A GL entry (Dr asset / Cr owner equity) rather than a bare status
      // flip, so no capitalized asset exists without a journal. An asset in a
      // construction-in-progress class is registered as Under Construction: it
      // accumulates cost until it is capitalized into its in-service class,
      // and is not depreciated before then.
      await service.postAssetRegistration(ctx.asSystem.pg, {
        fixedAssetId,
        fixedAssetReadableId: asset.data.fixedAssetId,
        registration,
        posting: {
          locationId: asset.data.locationId,
          fixedAssetClassId: asset.data.fixedAssetClassId,
          assetAccountId: assetClass.assetAccountId,
          accumulatedDepreciationAccountId:
            assetClass.accumulatedDepreciationAccountId,
          offsetAccountId: defaults.data.retainedEarningsAccount,
          locationDimensionId: dimensionId("Location"),
          assetClassDimensionId: dimensionId("FixedAssetClass"),
          resolveAccountingPeriodId: async (postingDate) => {
            const period = await service.getOrCreateAccountingPeriod(
              client,
              companyId,
              postingDate,
              "accounting"
            );
            if (period.error || !period.data) {
              throw new Error(
                period.error?.message ?? "Failed to get accounting period"
              );
            }
            return period.data;
          }
        },
        status: assetClass.isConstructionInProgress
          ? "Under Construction"
          : "Active",
        companyId,
        userId: ctx.auditUserId
      });
    } catch (err) {
      return service.refusal(ctx, err, "Failed to register asset");
    }
    return { fixedAssetId };
  }
});

// ── Currencies and exchange rates ───────────────────────────────────────────

/**
 * Pin a currency's exchange rate for the company.
 *
 * @remarks
 * `rate` is units of the currency per one unit of the base currency. A pin
 * always beats the daily market rate until it is reset. The base currency's
 * rate is always 1 and cannot be pinned.
 *
 * @mcp
 */
export const overrideExchangeRate = defineServiceFn({
  input: z.object({
    currencyCode: z.string().trim().min(1, { message: "Currency is required" }),
    rate: z.number().positive({ message: "Rate must be positive" })
  }),
  permission: { update: "accounting" },
  async run(ctx, { currencyCode, rate }) {
    const client = ctx.asCaller.supabase;
    // The resolver checks base before overrides, so a pin on the base code
    // would be dead data (and turn wrong the day the base changes).
    const company = await client
      .from("company")
      .select("baseCurrencyCode")
      .eq("id", ctx.company.id)
      .single();
    if (company.data?.baseCurrencyCode === currencyCode) {
      return ctx.error("rule", "The base currency's exchange rate is always 1");
    }

    const result = await service.upsertExchangeRateOverride(client, {
      companyId: ctx.company.id,
      currencyCode,
      rate,
      createdBy: ctx.auditUserId,
      updatedBy: ctx.auditUserId
    });
    if (result.error) {
      return ctx.error(
        "internal",
        "Failed to update exchange rate",
        result.error
      );
    }
    return { currencyCode, rate };
  }
});

/**
 * Reset a currency to the market exchange rate.
 *
 * @remarks
 * Removes the company's pinned rate for the currency, so the daily market
 * rate applies again.
 *
 * @mcp destructive
 */
export const resetExchangeRate = defineServiceFn({
  input: z.object({
    currencyCode: z.string().min(1, { message: "Currency code is required" })
  }),
  permission: { update: "accounting" },
  async run(ctx, { currencyCode }) {
    const result = await service.deleteExchangeRateOverride(
      ctx.asCaller.supabase,
      ctx.company.id,
      currencyCode
    );
    if (result.error) {
      return ctx.error(
        "internal",
        "Failed to reset exchange rate",
        result.error
      );
    }
    return { currencyCode };
  }
});

/**
 * Update a currency's settings, and pin its exchange rate when it was edited.
 *
 * @remarks
 * Saves the decimal places, the historical exchange rate and the custom
 * fields for the company group. `rate` is pinned as the company's rate only
 * when it differs from `displayedRate` (the rate the caller showed, so a
 * market move while editing is not an edit) and from the rate in effect,
 * compared at the internal scale; the base currency is never pinned. Both
 * writes are one transaction.
 *
 * @mcp
 */
export const updateCurrency = defineServiceFn({
  input: z.object({
    currencyId: z.string(),
    code: z.string(),
    decimalPlaces: z.number().min(0).max(4),
    historicalExchangeRate: z.number().positive().optional(),
    rate: z.number().positive().optional(),
    displayedRate: z.number().optional(),
    customFields: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .optional()
  }),
  permission: { update: "accounting" },
  async run(ctx, input) {
    const companyId = ctx.company.id;
    const { rate, displayedRate } = input;

    let overrideRate: number | null = null;
    if (
      rate !== undefined &&
      (displayedRate === undefined || round(displayedRate) !== round(rate))
    ) {
      const current = await service.getExchangeRates(
        ctx.asCaller.supabase,
        companyId
      );
      if (current.error) {
        return ctx.error(
          "internal",
          "Failed to read the current exchange rate",
          current.error
        );
      }
      const resolved = current.data.find((r) => r.currencyCode === input.code);
      if (
        resolved?.source !== "base" &&
        (resolved?.rate == null || round(Number(resolved.rate)) !== round(rate))
      ) {
        overrideRate = rate;
      }
    }

    try {
      const saved = await service.saveCurrencyWithRateOverride(
        ctx.asSystem.pg,
        {
          currencyId: input.currencyId,
          companyId,
          companyGroupId: ctx.company.groupId,
          userId: ctx.auditUserId,
          config: {
            decimalPlaces: input.decimalPlaces,
            historicalExchangeRate: input.historicalExchangeRate ?? null,
            customFields: input.customFields ?? {}
          },
          overrideRate
        }
      );
      if (!saved) return ctx.error("notFound", "Currency not found");
    } catch (err) {
      return ctx.error("internal", "Failed to update currency", err);
    }
    return { currencyId: input.currencyId };
  }
});

// ── Chart of accounts ───────────────────────────────────────────────────────

/**
 * Move an account to another group in the chart of accounts.
 *
 * @remarks
 * `parentId` is the group account it moves under; without it the account
 * moves to the top of the chart. It takes the new group's class and balance
 * type (Balance Sheet or Income Statement). The parent must be a group of
 * the company group's chart, and not the account itself or one of its own
 * accounts.
 *
 * @mcp
 */
export const moveAccount = defineServiceFn({
  input: z.object({ accountId: z.string(), parentId: z.string().optional() }),
  permission: { update: "accounting" },
  async run(ctx, { accountId, parentId }) {
    const client = ctx.asCaller.supabase;
    let update: {
      parentId: string | null;
      updatedBy: string;
      class?: Database["public"]["Enums"]["glAccountClass"];
      incomeBalance?: Database["public"]["Enums"]["glIncomeBalance"];
    } = { parentId: parentId || null, updatedBy: ctx.auditUserId };

    if (parentId) {
      const accounts = await client
        .from("account")
        .select("id, parentId, isGroup, class, incomeBalance")
        .eq("companyGroupId", ctx.company.groupId);
      if (accounts.error) {
        return ctx.error(
          "internal",
          "Failed to get parent account",
          accounts.error
        );
      }
      const refused = accountMoveRefusal(accounts.data, accountId, parentId);
      if (refused) return ctx.error("rule", refused);
      const parent = accounts.data.find((a) => a.id === parentId);
      update = {
        ...update,
        class: parent?.class ?? undefined,
        incomeBalance: parent?.incomeBalance ?? undefined
      };
    }

    const result = await client
      .from("account")
      .update(update)
      .eq("id", accountId)
      .eq("companyGroupId", ctx.company.groupId)
      .select("id")
      .single();
    if (result.error) {
      return ctx.error("internal", "Failed to move account", result.error);
    }
    return { accountId };
  }
});

/**
 * Import a chart of accounts and the default accounts.
 *
 * @remarks
 * `chart` is the customer's chart, `defaults` names the customer's account
 * number for every default account role and fixed asset class account, and
 * `resolutions` picks the row a used Carbon account merges into. Plans and
 * applies the import in one transaction: the Carbon account behind a default
 * becomes the chart row the template names, a Carbon account whose number
 * matches an unclaimed row becomes that row, and every other leaf is deleted
 * or merged. Refused once any company of the group has an accounting cutover,
 * and while the plan has an unresolved row. Not published: the import
 * rewrites the whole group's chart, and runs from the import page only.
 */
export const importChartOfAccounts = defineServiceFn({
  input: service.applyAccountImportInput,
  permission: { update: "accounting" },
  async run(ctx, input) {
    const result = await invokePosting(
      ctx,
      "apply-account-import",
      input,
      service.applyAccountImport
    );
    if (result.error) {
      return fromServerFn(
        ctx,
        result.error,
        "Failed to import the chart of accounts"
      );
    }
    return { counts: result.data.counts };
  }
});

// ── Accounting cutover ──────────────────────────────────────────────────────

/**
 * Enable accounting from a cutover date.
 *
 * @remarks
 * One-way. `confirmation` must be the company's name. Refuses while a
 * readiness check fails or Migration Clearing does not total zero. Posts the
 * opening balance journal the day before the cutover, turns Provisional
 * journals dated on or after it into Posted and those before it into
 * Superseded, journals legacy documents, and records the cutover. Not
 * published: the one-way enable runs from the activation wizard only.
 */
export const enableAccountingCutover = defineServiceFn({
  input: z.object({ cutoverDate: z.string(), confirmation: z.string() }),
  permission: { update: "accounting" },
  async run(ctx, input) {
    const result = await invokePosting(
      ctx,
      "activate-accounting",
      input,
      service.activateAccounting
    );
    if (result.error) {
      return fromServerFn(ctx, result.error, "Failed to enable accounting");
    }
    return { cutoverDate: input.cutoverDate };
  }
});
/**
 * Get account ledger
 *
 * @mcp read
 */
export const getAccountLedger = defineServiceFn({
  input: z.looseObject({
    accountId: z.string(),
    companyIds: z.array(z.string()).optional(),
    startDate: z.string().nullable(),
    endDate: z.string().nullable(),
    limit: z.number(),
    offset: z.number()
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getAccountLedger(
        ctx.asCaller.supabase,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get account ledger summary
 *
 * @mcp read
 */
export const getAccountLedgerSummary = defineServiceFn({
  input: z.looseObject({
    accountId: z.string(),
    startDate: z.string().nullable(),
    endDate: z.string().nullable()
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getAccountLedgerSummary(
        ctx.asCaller.supabase,
        ctx.company.groupId,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get financial statement balances
 *
 * @mcp read
 */
export const getFinancialStatementBalances = defineServiceFn({
  input: z.looseObject({
    startDate: z.string().nullable(),
    endDate: z.string().nullable(),
    includeCurrentYearEarnings: z.boolean().optional()
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getFinancialStatementBalances(
        ctx.asCaller.supabase,
        ctx.company.groupId,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Multi-period financial statement balances: one column per bucket, powered by the accountTreeBalancePeriodSeries RPC (snapshot-based, single journal scan)
 *
 * @mcp read
 */
export const getFinancialStatementPeriodSeries = defineServiceFn({
  input: z.looseObject({
    buckets: z.array(
      z.looseObject({
        key: z.string(),
        start: z.string(),
        end: z.string(),
        fiscalYear: z.number(),
        quarter: z.number().nullable().optional(),
        isPartial: z.boolean()
      })
    ),
    includeCurrentYearEarnings: z.boolean().optional(),
    translate: z.looseObject({ targetCurrency: z.string() }).optional()
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getFinancialStatementPeriodSeries(
        ctx.asCaller.supabase,
        ctx.company.groupId,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get report pins
 *
 * @mcp read
 */
export const getReportPins = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "accounting" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getReportPins(
        ctx.asCaller.supabase,
        ctx.auditUserId,
        ctx.company.id
      )
    );
  }
});

/**
 * Upsert report pin
 *
 * @mcp
 */
export const upsertReportPin = defineServiceFn({
  input: z.looseObject({ reportKey: z.string(), pinned: z.boolean() }),
  permission: { create: "accounting", update: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertReportPin(
        ctx.asCaller.supabase,
        payload(ctx, input).withUser().forUpsert() as never
      )
    );
  }
});

/**
 * The leaf accounts inside a report's account scope — the universe the per-report account multi-select filters within
 *
 * @mcp read
 */
export const getAccountsInScope = defineServiceFn({
  input: z.looseObject({
    scope: z.union([
      z.looseObject({
        classes: z.array(
          z.enum(["Asset", "Liability", "Equity", "Revenue", "Expense"])
        )
      }),
      z.looseObject({
        types: z.array(
          z.enum([
            "Bank",
            "Cash",
            "Accounts Receivable",
            "Accounts Payable",
            "Inventory",
            "Fixed Asset",
            "Accumulated Depreciation",
            "Other Current Asset",
            "Other Asset",
            "Other Current Liability",
            "Long Term Liability",
            "Equity - No Close",
            "Equity - Close",
            "Retained Earnings",
            "Income",
            "Cost of Goods Sold",
            "Expense",
            "Other Income",
            "Other Expense",
            "Tax",
            "Investments"
          ])
        )
      }),
      z.looseObject({ source: z.literal("scrapAccounts") })
    ]),
    scrapAccountIds: z.array(z.string()).optional()
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getAccountsInScope(
        ctx.asCaller.supabase,
        ctx.company.groupId,
        payload(ctx, input.scope).build() as never,
        payload(ctx, input.scrapAccountIds).build() as never
      )
    );
  }
});

/**
 * Get dimension pivot
 *
 * @mcp read
 */
export const getDimensionPivot = defineServiceFn({
  input: z.looseObject({
    report: z.looseObject({
      key: z.enum([
        "revenue",
        "expenses",
        "assets",
        "inventory-change",
        "scrap"
      ]),
      accountScope: z.union([
        z.looseObject({
          classes: z.array(
            z.enum(["Asset", "Liability", "Equity", "Revenue", "Expense"])
          )
        }),
        z.looseObject({
          types: z.array(
            z.enum([
              "Bank",
              "Cash",
              "Accounts Receivable",
              "Accounts Payable",
              "Inventory",
              "Fixed Asset",
              "Accumulated Depreciation",
              "Other Current Asset",
              "Other Asset",
              "Other Current Liability",
              "Long Term Liability",
              "Equity - No Close",
              "Equity - Close",
              "Retained Earnings",
              "Income",
              "Cost of Goods Sold",
              "Expense",
              "Other Income",
              "Other Expense",
              "Tax",
              "Investments"
            ])
          )
        }),
        z.looseObject({ source: z.literal("scrapAccounts") })
      ]),
      defaultRows: z.array(z.string())
    }),
    scrapAccountIds: z.array(z.string()).optional(),
    startDate: z.string(),
    endDate: z.string(),
    periodEnds: z.array(z.string()).optional(),
    state: z.looseObject({
      rows: z.array(z.string().min(1)).max(2).default([]),
      columnAxis: z
        .union([
          z.looseObject({
            type: z.literal("period"),
            bucket: z.enum(["month", "quarter", "year"])
          }),
          z.looseObject({
            type: z.literal("dimension"),
            dimensionId: z.string().min(1)
          })
        ])
        .default({ type: "period", bucket: "month" }),
      measure: z.enum(["amount", "quantity", "count"]).default("amount"),
      percentOfTotal: z.boolean().default(false),
      sort: z
        .looseObject({
          key: z.string().min(1),
          direction: z.enum(["asc", "desc"])
        })
        .nullable()
        .default(null),
      filters: z
        .array(
          z.looseObject({
            dimensionId: z.string().min(1),
            valueIds: z.array(z.string()).min(1)
          })
        )
        .default([]),
      accountIds: z.array(z.string().min(1)).default([])
    })
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getDimensionPivot(
        ctx.asCaller.supabase,
        payload(ctx, input).withGroup().build() as never
      )
    );
  }
});

/**
 * Drill-through: the journal lines behind one pivot cell
 *
 * @mcp read
 */
export const getDimensionPivotLines = defineServiceFn({
  input: z.looseObject({
    report: z.looseObject({
      key: z.enum([
        "revenue",
        "expenses",
        "assets",
        "inventory-change",
        "scrap"
      ]),
      accountScope: z.union([
        z.looseObject({
          classes: z.array(
            z.enum(["Asset", "Liability", "Equity", "Revenue", "Expense"])
          )
        }),
        z.looseObject({
          types: z.array(
            z.enum([
              "Bank",
              "Cash",
              "Accounts Receivable",
              "Accounts Payable",
              "Inventory",
              "Fixed Asset",
              "Accumulated Depreciation",
              "Other Current Asset",
              "Other Asset",
              "Other Current Liability",
              "Long Term Liability",
              "Equity - No Close",
              "Equity - Close",
              "Retained Earnings",
              "Income",
              "Cost of Goods Sold",
              "Expense",
              "Other Income",
              "Other Expense",
              "Tax",
              "Investments"
            ])
          )
        }),
        z.looseObject({ source: z.literal("scrapAccounts") })
      ]),
      defaultRows: z.array(z.string())
    }),
    scrapAccountIds: z.array(z.string()).optional(),
    startDate: z.string(),
    endDate: z.string(),
    filters: z.array(
      z.looseObject({ dimensionId: z.string(), valueIds: z.array(z.string()) })
    ),
    rowDimension1: z.string().optional(),
    rowValue1: z.string().optional(),
    rowValue1IsNull: z.boolean().optional(),
    rowDimension2: z.string().optional(),
    rowValue2: z.string().optional(),
    rowValue2IsNull: z.boolean().optional(),
    columnDimension: z.string().optional(),
    columnValue: z.string().optional(),
    columnValueIsNull: z.boolean().optional(),
    columnPeriodStart: z.string().optional(),
    columnPeriodEnd: z.string().optional(),
    accountIds: z.array(z.string()).optional()
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getDimensionPivotLines(
        ctx.asCaller.supabase,
        payload(ctx, input).withGroup().build() as never
      )
    );
  }
});

/**
 * Get purchase line pivot
 *
 * @mcp read
 */
export const getPurchaseLinePivot = defineServiceFn({
  input: z.looseObject({
    startDate: z.string(),
    endDate: z.string(),
    periodEnds: z.array(z.string()).optional(),
    state: z.looseObject({
      rows: z.array(z.string().min(1)).max(2).default([]),
      columnAxis: z
        .union([
          z.looseObject({
            type: z.literal("period"),
            bucket: z.enum(["month", "quarter", "year"])
          }),
          z.looseObject({
            type: z.literal("dimension"),
            dimensionId: z.string().min(1)
          })
        ])
        .default({ type: "period", bucket: "month" }),
      measure: z.enum(["amount", "quantity", "count"]).default("amount"),
      percentOfTotal: z.boolean().default(false),
      sort: z
        .looseObject({
          key: z.string().min(1),
          direction: z.enum(["asc", "desc"])
        })
        .nullable()
        .default(null),
      filters: z
        .array(
          z.looseObject({
            dimensionId: z.string().min(1),
            valueIds: z.array(z.string()).min(1)
          })
        )
        .default([]),
      accountIds: z.array(z.string().min(1)).default([])
    })
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getPurchaseLinePivot(
        ctx.asCaller.supabase,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get purchase line pivot lines
 *
 * @mcp read
 */
export const getPurchaseLinePivotLines = defineServiceFn({
  input: z.looseObject({
    startDate: z.string(),
    endDate: z.string(),
    rowField1: z.string().optional(),
    rowValue1: z.string().optional(),
    rowField2: z.string().optional(),
    rowValue2: z.string().optional(),
    columnField: z.string().optional(),
    columnValue: z.string().optional(),
    columnPeriodStart: z.string().optional(),
    columnPeriodEnd: z.string().optional()
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getPurchaseLinePivotLines(
        ctx.asCaller.supabase,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get report views
 *
 * @mcp read
 */
export const getReportViews = defineServiceFn({
  input: z.looseObject({ reportKey: z.string().optional() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getReportViews(
        ctx.asCaller.supabase,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Create a report view
 *
 * @remarks
 * Upsert report view
 *
 * @mcp
 */
export const createReportView = defineServiceFn({
  input: z.looseObject({
    reportKey: z.string(),
    name: z.string(),
    visibility: z.enum(["Private", "Company"]),
    config: z.unknown()
  }),
  permission: { create: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertReportView(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a report view
 *
 * @remarks
 * Upsert report view
 *
 * @mcp
 */
export const updateReportView = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    reportKey: z.string(),
    name: z.string(),
    visibility: z.enum(["Private", "Company"]),
    config: z.unknown()
  }),
  permission: { update: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertReportView(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Delete report view
 *
 * @mcp destructive
 */
export const deleteReportView = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteReportView(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get companies in group
 *
 * @mcp read
 */
export const getCompaniesInGroup = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "accounting" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getCompaniesInGroup(
        ctx.asCaller.supabase,
        ctx.company.groupId
      )
    );
  }
});

/**
 * Delete account
 *
 * @mcp destructive
 */
export const deleteAccount = defineServiceFn({
  input: z.looseObject({ accountId: z.string() }),
  permission: { delete: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteAccount(
        ctx.asCaller.supabase,
        input.accountId as never
      )
    );
  }
});

/**
 * Delete payment term
 *
 * @mcp destructive
 */
export const deletePaymentTerm = defineServiceFn({
  input: z.looseObject({ paymentTermId: z.string() }),
  permission: { delete: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deletePaymentTerm(
        ctx.asCaller.supabase,
        input.paymentTermId as never
      )
    );
  }
});

/**
 * Get account
 *
 * @mcp read
 */
export const getAccount = defineServiceFn({
  input: z.looseObject({ accountId: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getAccount(ctx.asCaller.supabase, input.accountId as never)
    );
  }
});

/**
 * Get accounts list
 *
 * @mcp read
 */
export const getAccountsList = defineServiceFn({
  input: z.looseObject({
    isGroup: z.boolean().nullable().optional(),
    incomeBalance: z
      .enum(["Balance Sheet", "Income Statement"])
      .nullable()
      .optional(),
    classes: z
      .array(z.enum(["Asset", "Liability", "Equity", "Revenue", "Expense"]))
      .optional()
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getAccountsList(
        ctx.asCaller.supabase,
        ctx.company.groupId,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get group accounts
 *
 * @mcp read
 */
export const getGroupAccounts = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "accounting" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getGroupAccounts(ctx.asCaller.supabase, ctx.company.groupId)
    );
  }
});

/**
 * Get base currency
 *
 * @mcp read
 */
export const getBaseCurrency = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "accounting" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getBaseCurrency(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get chart of accounts
 *
 * @mcp read
 */
export const getChartOfAccounts = defineServiceFn({
  input: z.looseObject({
    incomeBalance: z.enum(["Income Statement", "Balance Sheet"]).nullable(),
    startDate: z.string().nullable(),
    endDate: z.string().nullable()
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getChartOfAccounts(
        ctx.asCaller.supabase,
        ctx.company.groupId,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get currency
 *
 * @mcp read
 */
export const getCurrency = defineServiceFn({
  input: z.looseObject({ currencyId: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getCurrency(
        ctx.asCaller.supabase,
        input.currencyId as never
      )
    );
  }
});

/**
 * Get currency by code
 *
 * @mcp read
 */
export const getCurrencyByCode = defineServiceFn({
  input: z.looseObject({ currencyCode: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getCurrencyByCode(
        ctx.asCaller.supabase,
        ctx.company.groupId,
        input.currencyCode as never
      )
    );
  }
});

/**
 * The one sanctioned answer to "how many units of `currencyCode` per 1 unit of THIS company's base currency, right now"
 *
 * @mcp read
 */
export const getExchangeRate = defineServiceFn({
  input: z.looseObject({ currencyCode: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getExchangeRate(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.currencyCode as never
      )
    );
  }
});

/**
 * Every active currency of the company's group, resolved for THIS company, with provenance: 'base' | 'override' | 'market' | 'missing'
 *
 * @mcp read
 */
export const getExchangeRates = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "accounting" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getExchangeRates(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get currencies
 *
 * @mcp read
 */
export const getCurrencies = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getCurrencies(
        ctx.asCaller.supabase,
        ctx.company.groupId,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * The full ISO currency list for pickers, carrying the company group's configured `decimalPlaces` where the currency has been set up
 *
 * @mcp read
 */
export const getCurrenciesList = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "accounting" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getCurrenciesList(
        ctx.asCaller.supabase,
        ctx.company.groupId
      )
    );
  }
});

/**
 * Get accounting periods
 *
 * @mcp read
 */
export const getAccountingPeriods = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "accounting" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getAccountingPeriods(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get accounting period deletability
 *
 * @mcp read
 */
export const getAccountingPeriodDeletability = defineServiceFn({
  input: z.looseObject({ periodId: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getAccountingPeriodDeletability(
        ctx.asCaller.supabase,
        input.periodId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Delete accounting period
 *
 * @mcp destructive
 */
export const deleteAccountingPeriod = defineServiceFn({
  input: z.looseObject({ periodId: z.string() }),
  permission: { delete: "accounting" },
  async run(ctx, input) {
    return await service.deleteAccountingPeriod(
      ctx.asCaller.supabase,
      payload(ctx, input).build() as never
    );
  }
});

/**
 * Get fiscal calendar committed
 *
 * @mcp read
 */
export const getFiscalCalendarCommitted = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "accounting" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getFiscalCalendarCommitted(
        ctx.asCaller.supabase,
        ctx.company.id
      )
    );
  }
});

/**
 * Create fiscal year periods
 *
 * @mcp
 */
export const createFiscalYearPeriods = defineServiceFn({
  input: z.looseObject({ fiscalYear: z.number() }),
  permission: { create: "accounting" },
  async run(ctx, input) {
    return await service.createFiscalYearPeriods(
      ctx.asCaller.supabase,
      payload(ctx, input).withUser().forUpsert() as never
    );
  }
});

/**
 * Idempotently instantiate the checklist for a period from active definitions, then overlay live readiness
 *
 * @mcp
 */
export const getPeriodCloseChecklist = defineServiceFn({
  input: z.looseObject({ periodId: z.string() }),
  permission: { update: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getPeriodCloseChecklist(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        payload(ctx, input).withGroup().withUser().build() as never
      )
    );
  }
});

/**
 * Get default accounts
 *
 * @mcp read
 */
export const getDefaultAccounts = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "accounting" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getDefaultAccounts(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * The GL account ids scrap postings offset to, for the scrap analytics report's account scope (accountScope.source === "scrapAccounts")
 *
 * @mcp read
 */
export const getScrapAccountIds = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "accounting" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getScrapAccountIds(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get fiscal year settings
 *
 * @mcp read
 */
export const getFiscalYearSettings = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "accounting" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getFiscalYearSettings(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get payment term
 *
 * @mcp read
 */
export const getPaymentTerm = defineServiceFn({
  input: z.looseObject({ paymentTermId: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getPaymentTerm(
        ctx.asCaller.supabase,
        input.paymentTermId as never
      )
    );
  }
});

/**
 * Get payment terms
 *
 * @mcp read
 */
export const getPaymentTerms = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getPaymentTerms(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get payment terms list
 *
 * @mcp read
 */
export const getPaymentTermsList = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "accounting" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getPaymentTermsList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Save both defaults sections atomically after validating the effective mapping
 *
 * @mcp
 */
export const updateDefaultAccounts = defineServiceFn({
  input: z.looseObject({
    rawMaterialsAccount: z.string().min(1),
    finishedGoodsAccount: z.string().min(1),
    goodsReceivedNotInvoicedAccount: z.string().min(1),
    workInProgressAccount: z.string().min(1),
    receivablesAccount: z.string().min(1),
    bankCashAccount: z.string().min(1),
    bankLocalCurrencyAccount: z.string().min(1),
    bankForeignCurrencyAccount: z.string().min(1),
    assetAquisitionCostAccount: z.string().min(1),
    assetAquisitionCostOnDisposalAccount: z.string().min(1),
    accumulatedDepreciationAccount: z.string().min(1),
    accumulatedDepreciationOnDisposalAccount: z.string().min(1),
    prepaymentAccount: z.string().min(1),
    supplierPrepaymentAccount: z.string().min(1),
    payablesAccount: z.string().min(1),
    employeeReimbursementsPayableAccount: z.string().optional(),
    salesTaxPayableAccount: z.string().min(1),
    purchaseTaxPayableAccount: z.string().min(1),
    reverseChargeSalesTaxPayableAccount: z.string().min(1),
    retainedEarningsAccount: z.string().min(1),
    currencyTranslationAccount: z.string().min(1),
    deferredTaxLiabilityAccountId: z.string().min(1),
    migrationClearingAccount: z.string().optional(),
    deferredRevenueAccount: z.string().optional(),
    contractAssetAccount: z.string().optional(),
    netInvestmentInLeasesAccount: z.string().optional(),
    rightOfUseAssetAccount: z.string().optional(),
    accumulatedRightOfUseAmortizationAccount: z.string().optional(),
    leaseLiabilityAccount: z.string().optional(),
    salesAccount: z.string().min(1),
    salesShippingRevenueAccount: z.string().min(1).optional(),
    salesDiscountAccount: z.string().min(1),
    costOfGoodsSoldAccount: z.string().min(1),
    purchaseVarianceAccount: z.string().min(1),
    inventoryAdjustmentVarianceAccount: z.string().min(1),
    scrapAccount: z.string().optional(),
    materialVarianceAccount: z.string().min(1),
    laborAndMachineVarianceAccount: z.string().min(1),
    overheadVarianceAccount: z.string().min(1),
    lotSizeVarianceAccount: z.string().min(1),
    subcontractingVarianceAccount: z.string().min(1),
    laborAbsorptionAccount: z.string().min(1),
    overheadAbsorptionAccount: z.string().optional(),
    indirectCostAccount: z.string().min(1),
    maintenanceAccount: z.string().min(1),
    assetDepreciationExpenseAccount: z.string().min(1),
    assetGainOnDisposalAccount: z.string().min(1),
    assetLossOnDisposalAccount: z.string().min(1),
    serviceChargeAccount: z.string().min(1),
    interestAccount: z.string().min(1),
    supplierPaymentDiscountAccount: z.string().min(1),
    customerPaymentDiscountAccount: z.string().min(1),
    customerWriteOffAccount: z.string().min(1),
    supplierWriteOffAccount: z.string().min(1),
    realizedExchangeGainAccount: z.string().min(1),
    realizedExchangeLossAccount: z.string().min(1),
    roundingAccount: z.string().min(1),
    deferredTaxExpenseAccountId: z.string().min(1),
    rentalIncomeAccount: z.string().optional(),
    leaseRevenueAccount: z.string().optional(),
    leaseInterestIncomeAccount: z.string().optional(),
    operatingLeaseExpenseAccount: z.string().optional(),
    variableLeaseExpenseAccount: z.string().optional(),
    rightOfUseAmortizationExpenseAccount: z.string().optional(),
    leaseInterestExpenseAccount: z.string().optional()
  }),
  permission: { update: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updateDefaultAccounts(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Update fiscal year settings
 *
 * @mcp
 */
export const updateFiscalYearSettings = defineServiceFn({
  input: z.looseObject({
    startMonth: z.enum([
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December"
    ]),
    taxStartMonth: z.enum([
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December"
    ])
  }),
  permission: { update: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updateFiscalYearSettings(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Create a account
 *
 * @remarks
 * Upsert account
 *
 * @mcp
 */
export const createAccount = defineServiceFn({
  input: z.looseObject({
    number: z.string().min(1).nullable().optional(),
    name: z.string().min(1),
    parentId: z.string().optional(),
    isGroup: z.boolean().optional(),
    accountType: z
      .enum([
        "Bank",
        "Cash",
        "Accounts Receivable",
        "Accounts Payable",
        "Inventory",
        "Fixed Asset",
        "Accumulated Depreciation",
        "Other Current Asset",
        "Other Asset",
        "Other Current Liability",
        "Long Term Liability",
        "Equity - No Close",
        "Equity - Close",
        "Retained Earnings",
        "Income",
        "Cost of Goods Sold",
        "Expense",
        "Other Income",
        "Other Expense",
        "Tax",
        "Investments"
      ])
      .optional(),
    incomeBalance: z.enum(["Balance Sheet", "Income Statement"]),
    class: z.enum(["Asset", "Liability", "Equity", "Revenue", "Expense"]),
    consolidatedRate: z.enum(["Average", "Current", "Historical"]),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertAccount(
        ctx.asCaller.supabase,
        payload(ctx, input).withoutCompany().withGroup().forCreate() as never
      )
    );
  }
});

/**
 * Update a account
 *
 * @remarks
 * Upsert account
 *
 * @mcp
 */
export const updateAccount = defineServiceFn({
  input: z
    .looseObject({
      number: z.string().min(1).nullable().optional(),
      name: z.string().min(1),
      parentId: z.string().optional(),
      isGroup: z.boolean().optional(),
      accountType: z
        .enum([
          "Bank",
          "Cash",
          "Accounts Receivable",
          "Accounts Payable",
          "Inventory",
          "Fixed Asset",
          "Accumulated Depreciation",
          "Other Current Asset",
          "Other Asset",
          "Other Current Liability",
          "Long Term Liability",
          "Equity - No Close",
          "Equity - Close",
          "Retained Earnings",
          "Income",
          "Cost of Goods Sold",
          "Expense",
          "Other Income",
          "Other Expense",
          "Tax",
          "Investments"
        ])
        .optional(),
      incomeBalance: z.enum(["Balance Sheet", "Income Statement"]),
      class: z.enum(["Asset", "Liability", "Equity", "Revenue", "Expense"]),
      consolidatedRate: z.enum(["Average", "Current", "Historical"]),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertAccount(
        ctx.asCaller.supabase,
        payload(ctx, input).withoutCompany().withGroup().forUpdate() as never
      )
    );
  }
});

/**
 * Create a payment term
 *
 * @remarks
 * Upsert payment term
 *
 * @mcp
 */
export const createPaymentTerm = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1),
    daysDue: z.number().min(0),
    daysDiscount: z.number().min(0),
    discountPercentage: z.number().min(0).max(100),
    calculationMethod: z.enum(["Net", "End of Month", "Day of Month"]),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertPaymentTerm(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a payment term
 *
 * @remarks
 * Upsert payment term
 *
 * @mcp
 */
export const updatePaymentTerm = defineServiceFn({
  input: z
    .looseObject({
      name: z.string().min(1),
      daysDue: z.number().min(0),
      daysDiscount: z.number().min(0),
      discountPercentage: z.number().min(0).max(100),
      calculationMethod: z.enum(["Net", "End of Month", "Day of Month"]),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertPaymentTerm(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Delete cost center
 *
 * @mcp destructive
 */
export const deleteCostCenter = defineServiceFn({
  input: z.looseObject({ costCenterId: z.string() }),
  permission: { delete: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteCostCenter(
        ctx.asCaller.supabase,
        input.costCenterId as never
      )
    );
  }
});

/**
 * Get cost center
 *
 * @mcp read
 */
export const getCostCenter = defineServiceFn({
  input: z.looseObject({ costCenterId: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getCostCenter(
        ctx.asCaller.supabase,
        input.costCenterId as never
      )
    );
  }
});

/**
 * Get cost centers list
 *
 * @mcp read
 */
export const getCostCentersList = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "accounting" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getCostCentersList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get cost centers tree
 *
 * @mcp read
 */
export const getCostCentersTree = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "accounting" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getCostCentersTree(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Create a cost center
 *
 * @remarks
 * Upsert cost center
 *
 * @mcp
 */
export const createCostCenter = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1),
    parentCostCenterId: z.string().optional(),
    ownerId: z.string().min(1),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertCostCenter(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a cost center
 *
 * @remarks
 * Upsert cost center
 *
 * @mcp
 */
export const updateCostCenter = defineServiceFn({
  input: z
    .looseObject({
      name: z.string().min(1),
      parentCostCenterId: z.string().optional(),
      ownerId: z.string().min(1),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertCostCenter(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Delete project
 *
 * @mcp destructive
 */
export const deleteProject = defineServiceFn({
  input: z.looseObject({ projectId: z.string() }),
  permission: { delete: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteProject(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.projectId as never,
        ctx.auditUserId
      )
    );
  }
});

/**
 * Get project
 *
 * @mcp read
 */
export const getProject = defineServiceFn({
  input: z.looseObject({ projectId: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getProject(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.projectId as never
      )
    );
  }
});

/**
 * Get projects
 *
 * @mcp read
 */
export const getProjects = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getProjects(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Create a project
 *
 * @remarks
 * Upsert project
 *
 * @mcp
 */
export const createProject = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1),
    description: z.string().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertProject(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a project
 *
 * @remarks
 * Upsert project
 *
 * @mcp
 */
export const updateProject = defineServiceFn({
  input: z
    .looseObject({
      name: z.string().min(1),
      description: z.string().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertProject(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Get dimensions
 *
 * @mcp read
 */
export const getDimensions = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getDimensions(
        ctx.asCaller.supabase,
        ctx.company.groupId,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get dimension
 *
 * @mcp read
 */
export const getDimension = defineServiceFn({
  input: z.looseObject({ dimensionId: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getDimension(
        ctx.asCaller.supabase,
        input.dimensionId as never
      )
    );
  }
});

/**
 * Create a dimension
 *
 * @remarks
 * Upsert dimension
 *
 * @mcp destructive
 */
export const createDimension = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1),
    entityType: z.enum([
      "CostCenter",
      "Custom",
      "Customer",
      "CustomerType",
      "Department",
      "Employee",
      "FixedAssetClass",
      "Item",
      "ItemPostingGroup",
      "Location",
      "Process",
      "Project",
      "ScrapReason",
      "Supplier",
      "SupplierType",
      "WorkCenter"
    ]),
    active: z.boolean().optional(),
    required: z.boolean().optional(),
    dimensionValues: z.array(z.string()).optional()
  }),
  permission: { create: "accounting" },
  async run(ctx, input) {
    const { dimensionValues, ...dimension } = input;
    return unwrap(
      ctx,
      await service.upsertDimension(
        ctx.asCaller.supabase,
        payload(ctx, dimension)
          .withoutCompany()
          .withGroup()
          .forCreate() as never,
        payload(ctx, dimensionValues)
          .withoutCompany()
          .withGroup()
          .forCreate() as never
      )
    );
  }
});

/**
 * Update a dimension
 *
 * @remarks
 * Upsert dimension
 *
 * @mcp destructive
 */
export const updateDimension = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1),
    entityType: z.enum([
      "CostCenter",
      "Custom",
      "Customer",
      "CustomerType",
      "Department",
      "Employee",
      "FixedAssetClass",
      "Item",
      "ItemPostingGroup",
      "Location",
      "Process",
      "Project",
      "ScrapReason",
      "Supplier",
      "SupplierType",
      "WorkCenter"
    ]),
    active: z.boolean().optional(),
    required: z.boolean().optional(),
    id: z.string(),
    dimensionValues: z.array(z.string()).optional()
  }),
  permission: { update: "accounting" },
  async run(ctx, input) {
    const { dimensionValues, ...dimension } = input;
    return unwrap(
      ctx,
      await service.upsertDimension(
        ctx.asCaller.supabase,
        payload(ctx, dimension)
          .withoutCompany()
          .withGroup()
          .forUpdate() as never,
        payload(ctx, dimensionValues)
          .withoutCompany()
          .withGroup()
          .forUpdate() as never
      )
    );
  }
});

/**
 * Delete dimension
 *
 * @mcp destructive
 */
export const deleteDimension = defineServiceFn({
  input: z.looseObject({ dimensionId: z.string() }),
  permission: { delete: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteDimension(
        ctx.asCaller.supabase,
        input.dimensionId as never
      )
    );
  }
});

/**
 * Get active dimensions with values
 *
 * @mcp read
 */
export const getActiveDimensionsWithValues = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "accounting" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getActiveDimensionsWithValues(
        ctx.asCaller.supabase,
        ctx.company.groupId,
        ctx.company.id
      )
    );
  }
});

/**
 * Get journal line dimensions
 *
 * @mcp read
 */
export const getJournalLineDimensions = defineServiceFn({
  input: z.looseObject({ journalLineIds: z.array(z.string()) }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getJournalLineDimensions(
        ctx.asCaller.supabase,
        payload(ctx, input.journalLineIds).build() as never
      )
    );
  }
});

/**
 * Save journal line dimensions
 *
 * @mcp destructive
 */
export const saveJournalLineDimensions = defineServiceFn({
  input: z.looseObject({
    journalLineId: z.string(),
    dimensions: z.array(
      z.looseObject({ dimensionId: z.string(), valueId: z.string() })
    )
  }),
  permission: { update: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.saveJournalLineDimensions(
        ctx.asCaller.supabase,
        input.journalLineId as never,
        ctx.company.id,
        payload(ctx, input.dimensions).build() as never
      )
    );
  }
});

/**
 * Translate company balances
 *
 * @mcp
 */
export const translateCompanyBalances = defineServiceFn({
  input: z.looseObject({
    targetCurrency: z.string(),
    periodEnd: z.string(),
    periodStart: z.string(),
    balances: z.array(
      z.looseObject({
        id: z.string(),
        balanceAtDate: z.number(),
        consolidatedRate: z.string().nullable(),
        isGroup: z.boolean().nullable(),
        class: z.string().nullable()
      })
    )
  }),
  permission: { update: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.translateCompanyBalances(
        ctx.asCaller.supabase,
        ctx.company.groupId,
        ctx.company.id,
        input.targetCurrency as never,
        input.periodEnd as never,
        input.periodStart as never,
        payload(ctx, input.balances).build() as never
      )
    );
  }
});

/**
 * Get intercompany transactions
 *
 * @mcp read
 */
export const getIntercompanyTransactions = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    status: z.string().nullable().optional()
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getIntercompanyTransactions(
        ctx.asCaller.supabase,
        ctx.company.groupId,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Create intercompany transaction
 *
 * @mcp
 */
export const createIntercompanyTransaction = defineServiceFn({
  input: z.looseObject({
    sourceCompanyId: z.string().min(1),
    targetCompanyId: z.string().min(1),
    amount: z.number().gt(0),
    currencyCode: z.string().min(1),
    description: z.string().min(1),
    debitAccountId: z.string().min(1),
    creditAccountId: z.string().min(1),
    postingDate: z.string().optional()
  }),
  permission: { create: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.createIntercompanyTransaction(
        ctx.asCaller.supabase,
        payload(ctx, input).withGroup().withUser().forUpsert() as never
      )
    );
  }
});

/**
 * Run intercompany matching
 *
 * @mcp
 */
export const runIntercompanyMatching = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { update: "accounting" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.runIntercompanyMatching(
        ctx.asCaller.supabase,
        ctx.company.groupId
      )
    );
  }
});

/**
 * Generate eliminations
 *
 * @mcp
 */
export const generateEliminations = defineServiceFn({
  input: z.looseObject({ regenerate: z.boolean().optional() }),
  permission: { create: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.generateEliminations(
        ctx.asCaller.supabase,
        ctx.company.groupId,
        ctx.auditUserId,
        input.regenerate as never
      )
    );
  }
});

/**
 * Market-rate history for the chart on the exchange-rates page
 *
 * @mcp read
 */
export const getExchangeRateHistory = defineServiceFn({
  input: z.looseObject({ currencyCode: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getExchangeRateHistory(
        ctx.asCaller.supabase,
        input.currencyCode as never
      )
    );
  }
});

/**
 * Get journal entries
 *
 * @mcp read
 */
export const getJournalEntries = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    status: z.string().nullable().optional()
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getJournalEntries(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get journal entry
 *
 * @mcp read
 */
export const getJournalEntry = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getJournalEntry(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Delete journal entry
 *
 * @mcp destructive
 */
export const deleteJournalEntry = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteJournalEntry(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Post journal entry
 *
 * @mcp
 */
export const postJournalEntry = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { update: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.postJournalEntry(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.auditUserId
      )
    );
  }
});

/**
 * Reverse journal entry
 *
 * @mcp
 */
export const reverseJournalEntry = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    data: z.looseObject({ journalEntryId: z.string().optional() })
  }),
  permission: { update: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.reverseJournalEntry(
        ctx.asCaller.supabase,
        input.id as never,
        payload(ctx, input.data).withUser().build() as never
      )
    );
  }
});

/**
 * Get fixed asset classes
 *
 * @mcp read
 */
export const getFixedAssetClasses = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getFixedAssetClasses(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get fixed asset class
 *
 * @mcp read
 */
export const getFixedAssetClass = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getFixedAssetClass(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get fixed asset classes list
 *
 * @mcp read
 */
export const getFixedAssetClassesList = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "accounting" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getFixedAssetClassesList(
        ctx.asCaller.supabase,
        ctx.company.id
      )
    );
  }
});

/**
 * Create a fixed asset class
 *
 * @remarks
 * Upsert fixed asset class
 *
 * @mcp
 */
export const createFixedAssetClass = defineServiceFn({
  input: z.looseObject({ data: z.unknown() }),
  permission: { create: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertFixedAssetClass(
        ctx.asCaller.supabase,
        payload(ctx, input.data).forCreate() as never
      )
    );
  }
});

/**
 * Update a fixed asset class
 *
 * @remarks
 * Upsert fixed asset class
 *
 * @mcp
 */
export const updateFixedAssetClass = defineServiceFn({
  input: z.looseObject({
    id: z.string()
  }),
  permission: { update: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertFixedAssetClass(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Delete fixed asset class
 *
 * @mcp destructive
 */
export const deleteFixedAssetClass = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteFixedAssetClass(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

/**
 * Get fixed assets
 *
 * @mcp read
 */
export const getFixedAssets = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    status: z
      .enum([
        "Draft",
        "Active",
        "Fully Depreciated",
        "Disposed",
        "Under Construction"
      ])
      .nullable()
      .optional()
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getFixedAssets(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get fixed asset
 *
 * @mcp read
 */
export const getFixedAsset = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getFixedAsset(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Insert fixed asset
 *
 * @mcp
 */
export const insertFixedAsset = defineServiceFn({
  input: z.looseObject({
    fixedAssetId: z.string().optional(),
    fixedAssetClassId: z.string(),
    name: z.string(),
    description: z.string().optional(),
    serialNumber: z.string().optional(),
    depreciationMethod: z.string(),
    usefulLifeMonths: z.number(),
    residualValuePercent: z.number(),
    assetLifetimeUsage: z.number().nullable().optional(),
    locationId: z.string().optional(),
    workCenterId: z.string().nullable().optional(),
    status: z.string().optional(),
    taxDepreciationMethod: z.string().nullable().optional(),
    taxUsefulLifeMonths: z.number().nullable().optional(),
    taxResidualValuePercent: z.number().nullable().optional(),
    macrsPropertyClass: z.string().nullable().optional(),
    macrsConvention: z.string().nullable().optional(),
    bonusDepreciationPercent: z.number().nullable().optional()
  }),
  permission: { create: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.insertFixedAsset(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpsert() as never
      )
    );
  }
});

/**
 * Update fixed asset
 *
 * @mcp
 */
export const updateFixedAsset = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    fixedAssetClassId: z.string().optional(),
    name: z.string().optional(),
    description: z.string().nullable().optional(),
    serialNumber: z.string().nullable().optional(),
    depreciationMethod: z
      .enum(["Straight Line", "Declining Balance", "Units of Production"])
      .optional(),
    usefulLifeMonths: z.number().optional(),
    residualValuePercent: z.number().optional(),
    assetLifetimeUsage: z.number().nullable().optional(),
    locationId: z.string().nullable().optional(),
    workCenterId: z.string().nullable().optional(),
    taxDepreciationMethod: z
      .enum(["Straight Line", "Declining Balance", "MACRS"])
      .nullable()
      .optional(),
    taxUsefulLifeMonths: z.number().nullable().optional(),
    taxResidualValuePercent: z.number().nullable().optional(),
    macrsPropertyClass: z
      .enum(["3", "5", "7", "10", "15", "20", "27.5", "39"])
      .nullable()
      .optional(),
    macrsConvention: z.enum(["Half-Year", "Mid-Quarter"]).nullable().optional(),
    bonusDepreciationPercent: z.number().nullable().optional()
  }),
  permission: { update: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updateFixedAsset(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Delete fixed asset
 *
 * @mcp destructive
 */
export const deleteFixedAsset = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteFixedAsset(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Delete depreciation run
 *
 * @mcp destructive
 */
export const deleteDepreciationRun = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteDepreciationRun(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

/**
 * Get depreciation runs
 *
 * @mcp read
 */
export const getDepreciationRuns = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getDepreciationRuns(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get depreciation run
 *
 * @mcp read
 */
export const getDepreciationRun = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getDepreciationRun(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get depreciation run lines
 *
 * @mcp read
 */
export const getDepreciationRunLines = defineServiceFn({
  input: z.looseObject({ depreciationRunId: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getDepreciationRunLines(
        ctx.asCaller.supabase,
        input.depreciationRunId as never
      )
    );
  }
});

/**
 * Get revenue recognition run
 *
 * @mcp read
 */
export const getRevenueRecognitionRun = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getRevenueRecognitionRun(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get revenue recognition run lines
 *
 * @mcp read
 */
export const getRevenueRecognitionRunLines = defineServiceFn({
  input: z.looseObject({ runId: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getRevenueRecognitionRunLines(
        ctx.asCaller.supabase,
        input.runId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * The documents around a depreciation or revenue recognition run that its own
 * row does not name: the accounting period its `periodEnd` falls in, and the
 * journal entries it posted.
 *
 * @mcp read
 */
export const getPeriodRunRelatedItems = defineServiceFn({
  input: z.looseObject({
    periodEnd: z.string(),
    journalIds: z.array(z.string())
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return await service.getPeriodRunRelatedItems(
      ctx.asCaller.supabase,
      ctx.company.id,
      input.periodEnd as never,
      payload(ctx, input.journalIds).build() as never
    );
  }
});

/**
 * Get deferred revenue waterfall
 *
 * @mcp read
 */
export const getDeferredRevenueWaterfall = defineServiceFn({
  input: z.looseObject({ asOf: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getDeferredRevenueWaterfall(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Time and dollar utilization of the rental fleet over `[from, to]` (inclusive `YYYY-MM-DD`)
 *
 * @mcp read
 */
export const getRentalUtilization = defineServiceFn({
  input: z.looseObject({
    from: z.string(),
    to: z.string(),
    fixedAssetClassId: z.string().nullable().optional()
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getRentalUtilization(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * The lessor's net investment in sales-type leases as of `asOf` (spec §4)
 *
 * @mcp read
 */
export const getLeaseNetInvestment = defineServiceFn({
  input: z.looseObject({ asOf: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getLeaseNetInvestment(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * The lessee's Lease Liabilities report (ASC 842-20-50) as of `asOf`.
 *
 * @remarks
 * The balances, maturity analysis and weighted averages as of `asOf`, and the
 * lease cost and cash paid for `[from, to]`. `from` defaults to the first day
 * of the fiscal year `asOf` falls in, `to` to `asOf`. Cost reads the lease
 * rows the lease run posted and the Lease lines of posted purchase invoices,
 * both dated in the range. The lease tables need purchasing view: without it
 * the report is empty.
 *
 * @mcp read
 */
export const getLeaseLiabilities = defineServiceFn({
  input: z.looseObject({
    asOf: z.string(),
    from: z.string().optional(),
    to: z.string().optional()
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getLeaseLiabilities(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get asset depreciation history
 *
 * @mcp read
 */
export const getAssetDepreciationHistory = defineServiceFn({
  input: z.looseObject({ fixedAssetId: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getAssetDepreciationHistory(
        ctx.asCaller.supabase,
        input.fixedAssetId as never
      )
    );
  }
});

/**
 * Get fixed asset disposal
 *
 * @mcp read
 */
export const getFixedAssetDisposal = defineServiceFn({
  input: z.looseObject({ fixedAssetId: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getFixedAssetDisposal(
        ctx.asCaller.supabase,
        input.fixedAssetId as never
      )
    );
  }
});

/**
 * Get fleet assets
 *
 * @mcp read
 */
export const getFleetAssets = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    fleetStatus: z.string().nullable().optional()
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getFleetAssets(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get fixed asset transfers
 *
 * @mcp read
 */
export const getFixedAssetTransfers = defineServiceFn({
  input: z.looseObject({ fixedAssetId: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getFixedAssetTransfers(
        ctx.asCaller.supabase,
        input.fixedAssetId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get fixed asset cip costs
 *
 * @mcp read
 */
export const getFixedAssetCipCosts = defineServiceFn({
  input: z.looseObject({ fixedAssetId: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getFixedAssetCipCosts(
        ctx.asCaller.supabase,
        input.fixedAssetId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * The capital tied up in a work center: every non-disposed asset assigned to
 * it, with its net book value and, for a straight-line asset, the depreciation
 * it carries each month.
 *
 * @mcp read
 */
export const getWorkCenterCapitalCost = defineServiceFn({
  input: z.looseObject({ workCenterId: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getWorkCenterCapitalCost(
        ctx.asCaller.supabase,
        input.workCenterId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Capitalize a unit, return an asset to inventory, attach a job to a CIP
 * asset, or capitalize a CIP asset.
 *
 * @remarks
 * Runs as the caller: the caller needs the transfer's permission, and
 * accounting update too when a capitalization enters its own cost.
 *
 * @mcp
 */
export const invokeAssetTransfer = defineServiceFn({
  input: service.postAssetTransferInput,
  permission: { update: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.invokeAssetTransfer(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        payload(ctx, input).withUser().build() as never
      )
    );
  }
});

/**
 * The tie-out grid: every persisted cell for the company, joined with account and period identity, newest period first
 *
 * @mcp read
 */
export const getAccountingSyncTieOut = defineServiceFn({
  input: z.looseObject({
    integration: z
      .union([z.string(), z.array(z.string())])
      .nullable()
      .optional(),
    accountingPeriodId: z.string().nullable().optional(),
    accountId: z
      .union([z.string(), z.array(z.string())])
      .nullable()
      .optional()
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getAccountingSyncTieOut(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * One tie-out cell and its drill-down: the posted journals dated in the cell's
 * period with a line on the cell's account, each with its latest sync
 * disposition for the cell's integration.
 *
 * @remarks
 * A reversal journal's disposition is read under the original journal's
 * `<id>:reversal` entity id. Returns the newest journals only, up to a fixed
 * limit.
 *
 * @mcp read
 */
export const getAccountingSyncTieOutCell = defineServiceFn({
  input: z.looseObject({ cellId: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getAccountingSyncTieOutCell(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.cellId as never
      )
    );
  }
});
