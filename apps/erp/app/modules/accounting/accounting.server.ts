// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineServiceFn } from "@carbon/api/service-fn.server";
import type { Database } from "@carbon/database";
import { fetchAllFromTable, fetchAllRecords } from "@carbon/database";
import type { RunType } from "@carbon/database/run-type";
import { applyAccountImportInput } from "@carbon/server-functions/apply-account-import";
import { round } from "@carbon/utils";
import { z } from "zod";
import {
  insertPurchaseOrder,
  upsertPurchaseOrderLine
} from "~/modules/purchasing/purchasing.service";
import { insertSalesOrder } from "~/modules/sales/sales.service";
import { getUserDefaults } from "~/modules/users/users.service";
import {
  asCaller,
  buildDepreciationRunLines,
  closePeriodWithChecklist,
  completeCloseTask,
  createDepreciationRunAt,
  deleteExchangeRateOverride,
  deleteRevenueRecognitionRun,
  fromServerFn,
  futureRunPeriodError,
  getCompanyToday,
  getDefaultAccounts,
  getExchangeRates,
  getFixedAsset,
  getOrCreateAccountingPeriod,
  insertDepreciationRun,
  lockAccountingPeriod,
  outOfServiceRefusal,
  postAssetRegistration,
  postDepreciationRun,
  postDisposal,
  postJournalEntry,
  postRevenueRecognitionRun,
  proposeRunAt,
  RunOutOfDateError,
  RunReversalError,
  refusal,
  replaceDepreciationRunLines,
  resolveReversalPeriods,
  resolveRunPostingPeriods,
  returnFixedAssetToService,
  reverseDepreciationRun,
  reverseRevenueRecognitionRun,
  saveCurrencyWithRateOverride,
  saveJournalEntryWithLines,
  setFixedAssetOutOfService,
  skipCloseTask,
  system,
  unlockAccountingPeriod,
  upsertExchangeRateOverride
} from "./accounting.service";
import {
  depreciationRunLinesMatch,
  getNextPeriodEnd,
  getNextRevenueRecognitionPeriodEnd,
  monthEndOf
} from "./accounting.utils";

// Report loaders consolidate a group the user is authorized for, but the
// synthetic elimination entities are read via service role (no user is a member
// of them — see the consolidation service). These thin wrappers own that
// privileged-client decision in ONE server-only place so the loaders never
// thread a `getCarbonServiceRole()` argument through their call sites. The RLS
// `client` still reads every operating company; only elimination entities are
// read privileged.
// Consolidated account drill-down ("All Companies"). Reads via service role so
// the synthetic elimination entities' journal lines (invisible to the user's
// RLS session — no user is a member of them) appear in the ledger and the
// summary ties to the consolidated report. Scoped to the group's own companies
// so a service-role read cannot cross tenants.
// ── Revenue recognition runs ─────────────────────────────────────────────────
// Spec: `.ai/specs/implemented/2026-09-22-revenue-recognition-rentals-and-contracts.md` Part I §1. Proposals are
// built by the `propose-revenue-recognition-run` server function (shared with the Inngest job);
// posting and deletion are human actions and live here, beside the
// depreciation-run posters they mirror.
// ── Operations ──────────────────────────────────────────────────────────────
// Each is a `defineServiceFn` listed in `index.server.ts`: the route, the API
// and MCP call the same one, and it holds every check the route made.
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
export const depreciationRunCreate = defineServiceFn({
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

    const futureError = await futureRunPeriodError(
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

    return createDepreciationRunAt(ctx, periodEnd);
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
export const depreciationRunPost = defineServiceFn({
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

    const futureError = await futureRunPeriodError(
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
    const proposal = await buildDepreciationRunLines(client, {
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
    const periods = await resolveRunPostingPeriods(client, {
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
      await postDepreciationRun(ctx.asSystem.pg, {
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
      return err instanceof RunOutOfDateError
        ? ctx.error("conflict", err.message, err)
        : ctx.error("internal", "Failed to post depreciation run", err);
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
export const depreciationRunRecalculate = defineServiceFn({
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

    const proposal = await buildDepreciationRunLines(client, {
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
      const result = await replaceDepreciationRunLines(ctx.asSystem.pg, {
        depreciationRunId,
        lines: proposal.data.lines,
        companyId,
        userId: ctx.auditUserId
      });
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
export const depreciationRunRepeat = defineServiceFn({
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
    const proposal = await buildDepreciationRunLines(client, {
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

    const created = await insertDepreciationRun(client, {
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
export const depreciationRunReverse = defineServiceFn({
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
    const periods = await resolveReversalPeriods(client, {
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
      const reversed = await reverseDepreciationRun(ctx.asSystem.pg, {
        depreciationRunId,
        periods: periods.data,
        companyId,
        userId: ctx.auditUserId
      });
      return { id: depreciationRunId, readableId: reversed.depreciationRunId };
    } catch (err) {
      return err instanceof RunReversalError
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
export const revenueRecognitionRunCreate = defineServiceFn({
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
      return proposeRunAt(ctx, monthEndOf(periodEnd), type);
    }

    const client = ctx.asCaller.supabase;
    const lastRun = await client
      .from("revenueRecognitionRun")
      .select("periodEnd")
      .eq("companyId", ctx.company.id)
      .eq("type", type)
      .order("periodEnd", { ascending: false })
      .limit(1);
    return proposeRunAt(
      ctx,
      getNextRevenueRecognitionPeriodEnd(
        lastRun.data?.[0]?.periodEnd ?? null,
        await getCompanyToday(client, ctx.company.id)
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
export const revenueRecognitionRunPost = defineServiceFn({
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

    const futureError = await futureRunPeriodError(
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

    const periods = await resolveRunPostingPeriods(client, {
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
      await postRevenueRecognitionRun(ctx.asSystem.pg, {
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
      return err instanceof RunOutOfDateError
        ? ctx.error("conflict", err.message, err)
        : ctx.error("internal", "Failed to post revenue recognition run", err);
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
export const revenueRecognitionRunRepeat = defineServiceFn({
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
    return proposeRunAt(
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
export const revenueRecognitionRunReverse = defineServiceFn({
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
    const periods = await resolveReversalPeriods(client, {
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
      const reversed = await reverseRevenueRecognitionRun(ctx.asSystem.pg, {
        runId,
        periods: periods.data,
        companyId,
        userId: ctx.auditUserId
      });
      return {
        id: runId,
        readableId: reversed.runId,
        deleted: reversed.deleted
      };
    } catch (err) {
      return err instanceof RunReversalError
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
export const revenueRecognitionRunRecalculate = defineServiceFn({
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

    const result = await asCaller(ctx).invoke(
      "recalculate-revenue-recognition-run",
      { runId }
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
export const revenueRecognitionRunDelete = defineServiceFn({
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
      await deleteRevenueRecognitionRun(ctx.asSystem.pg, {
        runId,
        companyId: ctx.company.id,
        userId: ctx.auditUserId
      });
    } catch (err) {
      return refusal(ctx, err, "Failed to delete the run");
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
export const periodLock = defineServiceFn({
  input: z.object({ periodId: z.string() }),
  permission: { update: "accounting" },
  async run(ctx, { periodId }) {
    const result = await lockAccountingPeriod(ctx.asCaller.supabase, {
      periodId,
      companyId: ctx.company.id,
      userId: ctx.auditUserId
    });
    if (result.error)
      return refusal(ctx, result.error, "Failed to lock period");
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
export const periodUnlock = defineServiceFn({
  input: z.object({ periodId: z.string() }),
  permission: { update: "accounting" },
  async run(ctx, { periodId }) {
    const result = await unlockAccountingPeriod(ctx.asCaller.supabase, {
      periodId,
      companyId: ctx.company.id,
      userId: ctx.auditUserId
    });
    if (result.error) {
      return refusal(ctx, result.error, "Failed to unlock period");
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
export const periodClose = defineServiceFn({
  input: z.object({ periodId: z.string() }),
  permission: { update: "accounting" },
  async run(ctx, { periodId }) {
    const result = await closePeriodWithChecklist(
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
      return refusal(ctx, result.error, "Failed to close period");
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
export const periodCreateRun = defineServiceFn({
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
      const created = await proposeRunAt(ctx, periodEnd, run);
      return created instanceof Error ? created : { ...created, run };
    }

    const futureError = await futureRunPeriodError(
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
        `${existingDraft.data.depreciationRunId} is already a draft for this period. Recalculate it instead.`
      );
    }

    const created = await createDepreciationRunAt(ctx, periodEnd);
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
    const result = await completeCloseTask(ctx.asCaller.supabase, {
      taskId,
      notes,
      companyId: ctx.company.id,
      userId: ctx.auditUserId
    });
    if (result.error) {
      return refusal(ctx, result.error, "Failed to complete task");
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
    const result = await skipCloseTask(ctx.asCaller.supabase, {
      taskId,
      skippedReason,
      companyId: ctx.company.id,
      userId: ctx.auditUserId
    });
    if (result.error) return refusal(ctx, result.error, "Failed to skip task");
    return { taskId, status: "Skipped" as const };
  }
});

// ── Journal entries ─────────────────────────────────────────────────────────

/**
 * Create an empty Draft manual journal entry.
 *
 * @remarks
 * Takes the next journal entry number. Add its lines and post it with
 * `journalEntry.save`.
 *
 * @mcp
 */
export const journalEntryCreate = defineServiceFn({
  input: z.object({}),
  permission: { create: "accounting" },
  async run(ctx) {
    const created = await system(ctx).invoke("create", {
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
export const journalEntrySave = defineServiceFn({
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

    const saved = await saveJournalEntryWithLines(ctx.asCaller.supabase, {
      journalEntryId,
      postingDate,
      description,
      updatedBy: ctx.auditUserId,
      lines,
      companyId: ctx.company.id,
      companyGroupId: ctx.company.groupId
    });
    if (saved.error) {
      return refusal(ctx, saved.error, "Failed to save journal entry");
    }

    if (post) {
      const posted = await postJournalEntry(
        ctx.asCaller.supabase,
        journalEntryId,
        ctx.auditUserId
      );
      if (posted.error) {
        return refusal(ctx, posted.error, "Failed to post journal entry");
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
export const fixedAssetTakeOutOfService = defineServiceFn({
  input: z.object({
    fixedAssetId: z.string(),
    reason: z.string().trim().min(1, { message: "Reason is required" })
  }),
  permission: { update: "accounting" },
  async run(ctx, { fixedAssetId, reason }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const refused = await outOfServiceRefusal(
      client,
      ctx.asSystem.supabase,
      fixedAssetId,
      companyId
    );
    if (refused) {
      return ctx.error(refused.category, refused.message, refused.cause);
    }

    const result = await setFixedAssetOutOfService(client, {
      id: fixedAssetId,
      companyId,
      reason,
      since: await getCompanyToday(client, companyId),
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
export const fixedAssetReturnToService = defineServiceFn({
  input: z.object({ fixedAssetId: z.string() }),
  permission: { update: "accounting" },
  async run(ctx, { fixedAssetId }) {
    const result = await returnFixedAssetToService(ctx.asCaller.supabase, {
      id: fixedAssetId,
      companyId: ctx.company.id,
      updatedBy: ctx.auditUserId
    });
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
export const fixedAssetPurchase = defineServiceFn({
  input: z.object({ fixedAssetId: z.string(), supplierId: z.string() }),
  permission: { create: "purchasing" },
  async run(ctx, { fixedAssetId, supplierId }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;

    const [asset, defaults] = await Promise.all([
      getFixedAsset(client, fixedAssetId, companyId),
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
      return ctx.error(
        "internal",
        "Failed to add the asset to the purchase order",
        line.error
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
export const fixedAssetSell = defineServiceFn({
  input: z.object({ fixedAssetId: z.string(), customerId: z.string() }),
  permission: { create: "sales" },
  async run(ctx, { fixedAssetId, customerId }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;

    const [asset, defaults] = await Promise.all([
      getFixedAsset(client, fixedAssetId, companyId),
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
      return ctx.error(
        "internal",
        "Failed to add the asset to the sales order",
        line.error
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
 * instead (`fixedAsset.sell`). Refused before the company's accounting
 * cutover.
 *
 * @mcp destructive
 */
export const fixedAssetDispose = defineServiceFn({
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

    const period = await getOrCreateAccountingPeriod(
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
      await postDisposal(ctx.asSystem.pg, {
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
      return ctx.error("internal", "Failed to post asset disposal", err);
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
export const fixedAssetRegister = defineServiceFn({
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
      getDefaultAccounts(client, companyId),
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
      await postAssetRegistration(ctx.asSystem.pg, {
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
            const period = await getOrCreateAccountingPeriod(
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
      return refusal(ctx, err, "Failed to register asset");
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
export const exchangeRateOverride = defineServiceFn({
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

    const result = await upsertExchangeRateOverride(client, {
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
export const exchangeRateReset = defineServiceFn({
  input: z.object({
    currencyCode: z.string().min(1, { message: "Currency code is required" })
  }),
  permission: { update: "accounting" },
  async run(ctx, { currencyCode }) {
    const result = await deleteExchangeRateOverride(
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
export const currencyUpdate = defineServiceFn({
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
      const current = await getExchangeRates(ctx.asCaller.supabase, companyId);
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
      const saved = await saveCurrencyWithRateOverride(ctx.asSystem.pg, {
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
      });
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
export const accountMove = defineServiceFn({
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
      const parentOf = new Map(accounts.data.map((a) => [a.id, a.parentId]));
      const parent = accounts.data.find((a) => a.id === parentId);
      if (!parent?.isGroup) {
        return ctx.error("rule", "Choose a group account to move it under");
      }
      // Walk up from the new parent: meeting the account means a cycle.
      for (
        let id: string | null = parentId;
        id;
        id = parentOf.get(id) ?? null
      ) {
        if (id === accountId) {
          return ctx.error(
            "rule",
            "An account cannot move under itself or one of its own accounts"
          );
        }
      }
      update = {
        ...update,
        class: parent.class ?? undefined,
        incomeBalance: parent.incomeBalance ?? undefined
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
 * and while the plan has an unresolved row.
 *
 * @mcp destructive
 */
export const chartOfAccountsImport = defineServiceFn({
  input: applyAccountImportInput,
  permission: { update: "accounting" },
  async run(ctx, input) {
    const result = await asCaller(ctx).invoke("apply-account-import", input);
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
 * Superseded, journals legacy documents, and records the cutover.
 *
 * @mcp destructive
 */
export const cutoverEnable = defineServiceFn({
  input: z.object({ cutoverDate: z.string(), confirmation: z.string() }),
  permission: { update: "accounting" },
  async run(ctx, input) {
    const result = await asCaller(ctx).invoke("activate-accounting", input);
    if (result.error) {
      return fromServerFn(ctx, result.error, "Failed to enable accounting");
    }
    return { cutoverDate: input.cutoverDate };
  }
});
