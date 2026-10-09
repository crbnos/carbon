// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import { getCompanyTimeZone } from "@carbon/database";
import { ACTIVATION_CUTOVER_PARAM } from "@carbon/database/accounting-cutover";
import { CUTOVER_MAX_PERIODS_BACK } from "@carbon/database/accounting-cutover-reads";
import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";
import {
  journalPostingStatus,
  readAccountingCutoverDate
} from "@carbon/database/journal-posting-status";
import {
  buildDeferredTaxJournals,
  buildDepreciationJournals,
  buildDisposalJournal,
  buildRecognitionJournals,
  deferredTaxSettings,
  type RecognitionSources,
  type RunJournal
} from "@carbon/database/run-journals";
import { getNextSequence } from "@carbon/database/sequence";
import type { ReportPeriodBucket } from "@carbon/utils";
import { datetime, equals, formatDate, round } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sql } from "kysely";
import {
  ACCOUNTING_NOT_STARTED,
  applyCtaToReportPeriodSeries,
  getAccountLedger,
  getAccountLedgerSummary,
  getConsolidatedBalances,
  getConsolidatedPeriodSeries,
  getOrCreateAccountingPeriod
} from "./accounting.service";
import {
  type ActivationCutoverDates,
  acquisitionLines,
  activationCutoverDates,
  type DepreciationLine,
  depreciationRunLinesMatch,
  isFutureRunPeriod,
  monthEndOf,
  runPostingTargets
} from "./accounting.utils";

/**
 * The cutover date the enable wizard works against, with the earliest and the
 * latest date its date picker allows (`activationCutoverDates`), from the
 * company's current period.
 */
export async function getActivationCutover(
  client: SupabaseClient<Database>,
  companyId: string,
  request: Request
): Promise<ActivationCutoverDates> {
  const timeZone = await getCompanyTimeZone(client, companyId);
  return activationCutoverDates(
    new URL(request.url).searchParams.get(ACTIVATION_CUTOVER_PARAM),
    datetime.today(timeZone),
    CUTOVER_MAX_PERIODS_BACK
  );
}

/** The company's business day, `YYYY-MM-DD`. */
export async function getCompanyToday(
  client: SupabaseClient<Database>,
  companyId: string
): Promise<string> {
  return datetime.today(await getCompanyTimeZone(client, companyId)).toString();
}

/**
 * The refusal for a period run (revenue recognition, depreciation) that ends
 * after the company's current month, or null when the period may run. New,
 * Repeat and Post all ask, so a run for a month that has not started can
 * neither be created nor posted.
 */
export async function futureRunPeriodError(
  client: SupabaseClient<Database>,
  companyId: string,
  periodEnd: string
): Promise<string | null> {
  if (!isFutureRunPeriod(periodEnd, await getCompanyToday(client, companyId))) {
    return null;
  }
  return `${formatDate(periodEnd, { month: "long", year: "numeric" })} has not started yet. A run can cover the current month or an earlier one.`;
}

/** A Draft period run (revenue recognition, depreciation) no longer matches
 * what its period should post. Its message is meant for the user — the post
 * routes show it, where other posting failures get a generic toast. */
export class RunOutOfDateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunOutOfDateError";
  }
}

/** Resolve only the authorized group's root CTA configuration for reporting.
 * Operating-company balances continue to use the loader's RLS client.
 */
export async function applyCtaToReportPeriodSeriesForReport(
  request: Request,
  reportingCompanyId: string,
  args: Parameters<typeof applyCtaToReportPeriodSeries>[3]
) {
  const { client, companyGroupId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee",
    bypassRls: true
  });
  const root = await client
    .from("company")
    .select("id")
    .eq("id", reportingCompanyId)
    .eq("companyGroupId", companyGroupId)
    .is("parentCompanyId", null)
    .single();
  if (root.error || !root.data) {
    return {
      data: null,
      error: root.error ?? {
        message:
          "Reporting company must be the root of the authorized company group"
      }
    };
  }
  // Use the authenticated client returned above: API keys never gain service-role
  // privileges, even if their request also supplies the bypassRls option.
  return applyCtaToReportPeriodSeries(
    client,
    companyGroupId,
    root.data.id,
    args
  );
}

// Report loaders consolidate a group the user is authorized for, but the
// synthetic elimination entities are read via service role (no user is a member
// of them — see the consolidation service). These thin wrappers own that
// privileged-client decision in ONE server-only place so the loaders never
// thread a `getCarbonServiceRole()` argument through their call sites. The RLS
// `client` still reads every operating company; only elimination entities are
// read privileged.
export function getConsolidatedPeriodSeriesForReport(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  companyIds: string[],
  targetCurrency: string,
  args: { buckets: ReportPeriodBucket[]; includeCurrentYearEarnings?: boolean }
) {
  return getConsolidatedPeriodSeries(
    client,
    companyGroupId,
    companyIds,
    targetCurrency,
    args,
    getCarbonServiceRole()
  );
}

export function getConsolidatedBalancesForReport(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  companyIds: string[],
  targetCurrency: string,
  periodEnd: string,
  periodStart?: string
) {
  return getConsolidatedBalances(
    client,
    companyGroupId,
    companyIds,
    targetCurrency,
    periodEnd,
    periodStart,
    getCarbonServiceRole()
  );
}

// Consolidated account drill-down ("All Companies"). Reads via service role so
// the synthetic elimination entities' journal lines (invisible to the user's
// RLS session — no user is a member of them) appear in the ledger and the
// summary ties to the consolidated report. Scoped to the group's own companies
// so a service-role read cannot cross tenants.
export async function getConsolidatedAccountLedger(
  companyGroupId: string,
  args: {
    accountId: string;
    startDate: string | null;
    endDate: string | null;
    limit: number;
    offset: number;
  }
) {
  const serviceRole = getCarbonServiceRole();
  const { data: groupCompanies } = await serviceRole
    .from("company")
    .select("id")
    .eq("companyGroupId", companyGroupId)
    .eq("active", true);
  const companyIds = (groupCompanies ?? []).map((c) => c.id);

  const [ledger, summary] = await Promise.all([
    getAccountLedger(serviceRole, {
      accountId: args.accountId,
      companyId: null,
      companyIds,
      startDate: args.startDate,
      endDate: args.endDate,
      limit: args.limit,
      offset: args.offset
    }),
    getAccountLedgerSummary(serviceRole, companyGroupId, null, {
      accountId: args.accountId,
      startDate: args.startDate,
      endDate: args.endDate
    })
  ]);

  return { ledger, summary };
}

/**
 * Inserts a Posted run journal (`@carbon/database/run-journals`) with its
 * lines, and a dimension row for each line value whose dimension the company
 * has. A journal with no lines is still inserted, as the run posters always
 * have.
 */
async function insertPostedRunJournal(
  trx: KyselyTx,
  journal: RunJournal,
  posting: {
    accountingPeriodId: string;
    postingDate: string;
    dimensionIds: Partial<Record<DimensionEntityType, string | undefined>>;
    companyId: string;
    userId: string;
    now: string;
  }
): Promise<{ id: string; journalEntryId: string }> {
  const { accountingPeriodId, postingDate, dimensionIds, companyId, userId } =
    posting;
  const journalEntryId = await getNextSequence(trx, "journalEntry", companyId);
  const { id } = await trx
    .insertInto("journal")
    .values({
      journalEntryId,
      accountingPeriodId,
      companyId,
      description: journal.description,
      postingDate,
      sourceType: journal.sourceType,
      status: "Posted",
      postedAt: posting.now,
      postedBy: userId,
      createdBy: userId
    })
    .returning(["id"])
    .executeTakeFirstOrThrow();
  if (journal.lines.length === 0) return { id, journalEntryId };

  const lines = await trx
    .insertInto("journalLine")
    .values(
      journal.lines.map(({ dimensions: _, ...line }) => ({
        ...line,
        journalId: id,
        journalLineReference: crypto.randomUUID(),
        companyId
      }))
    )
    .returning(["id"])
    .execute();
  const dimensionRows = lines.flatMap((line, index) =>
    Object.entries(journal.lines[index]!.dimensions).flatMap(
      ([entityType, valueId]) => {
        const dimensionId = dimensionIds[entityType as DimensionEntityType];
        return dimensionId && valueId
          ? [{ journalLineId: line.id, dimensionId, valueId, companyId }]
          : [];
      }
    )
  );
  if (dimensionRows.length > 0) {
    await trx
      .insertInto("journalLineDimension")
      .values(dimensionRows)
      .execute();
  }
  return { id, journalEntryId };
}

export async function postDisposal(
  db: Kysely<KyselyDatabase>,
  args: {
    fixedAssetId: string;
    fixedAssetReadableId: string;
    disposalDate: string;
    disposalMethod: "Sale" | "Scrapping";
    acquisitionCost: number;
    accumulatedDepreciation: number;
    locationId: string | null;
    fixedAssetClassId: string;
    assetAccountId: string;
    accumulatedDepreciationAccountId: string;
    lossOnDisposalAccountId: string;
    accountingPeriodId: string;
    locationDimensionId: string | undefined;
    assetClassDimensionId: string | undefined;
    companyId: string;
    userId: string;
  }
) {
  const {
    fixedAssetId,
    fixedAssetReadableId,
    disposalDate,
    disposalMethod,
    acquisitionCost,
    accumulatedDepreciation,
    locationId,
    fixedAssetClassId,
    assetAccountId,
    accumulatedDepreciationAccountId,
    lossOnDisposalAccountId,
    accountingPeriodId,
    locationDimensionId,
    assetClassDimensionId,
    companyId,
    userId
  } = args;

  if (!(await readAccountingCutoverDate(db, companyId))) {
    throw new Error(ACCOUNTING_NOT_STARTED);
  }

  const journal = buildDisposalJournal({
    assetReadableId: fixedAssetReadableId,
    disposalMethod,
    disposalDate,
    acquisitionCost,
    accumulatedDepreciation,
    locationId,
    fixedAssetClassId,
    assetAccountId,
    accumulatedDepreciationAccountId,
    lossOnDisposalAccountId
  });
  const nbv = journal.netBookValue;
  const now = datetime.timestamp();

  return db.transaction().execute(async (trx) => {
    const { id: journalId } = await insertPostedRunJournal(trx, journal, {
      accountingPeriodId,
      postingDate: journal.postingDate,
      dimensionIds: {
        Location: locationDimensionId,
        FixedAssetClass: assetClassDimensionId
      },
      companyId,
      userId,
      now
    });

    await trx
      .insertInto("fixedAssetDisposal")
      .values({
        fixedAssetId,
        disposalMethod,
        disposalDate,
        saleProceeds: 0,
        netBookValueAtDisposal: nbv,
        gainLoss: -nbv,
        journalId,
        companyId,
        createdBy: userId
      })
      .execute();

    await trx
      .updateTable("fixedAsset")
      .set({
        status: "Disposed",
        disposalDate,
        disposalMethod,
        saleProceeds: 0,
        updatedBy: userId
      })
      .where("id", "=", fixedAssetId)
      .where("companyId", "=", companyId)
      .execute();
  });
}

/**
 * Registers a Draft asset: Active, or Under Construction for a
 * construction-in-progress class. It posts the acquisition journal first:
 * Provisional before the accounting cutover (no period), Posted after it, in
 * the acquisition date's period. The status is read once, in the transaction,
 * under the lock the enable takes, so no registration writes a Provisional
 * journal after the enable commits. One transaction, so no asset is
 * registered without its journal or its CIP cost row.
 */
export async function postAssetRegistration(
  db: Kysely<KyselyDatabase>,
  args: {
    fixedAssetId: string;
    fixedAssetReadableId: string;
    registration: {
      acquisitionCost: number;
      acquisitionDate: string;
      accumulatedDepreciation: number;
      depreciationStartDate: string;
    };
    posting: {
      locationId: string | null;
      fixedAssetClassId: string;
      assetAccountId: string;
      // Contra-asset account credited with any opening accumulated
      // depreciation when the asset is capitalized mid-life (from the class).
      accumulatedDepreciationAccountId: string;
      // Equity offset for a direct (non-purchase) registration — owner equity
      // / retained earnings. Brings the asset onto the books at NBV.
      offsetAccountId: string;
      locationDimensionId: string | undefined;
      assetClassDimensionId: string | undefined;
      /** The period of a Posted journal. Called only after the cutover. */
      resolveAccountingPeriodId: (postingDate: string) => Promise<string>;
    };
    // "Under Construction" for an asset registered into a construction-in-
    // progress class: it accumulates cost and is not depreciated until it is
    // capitalized into its in-service class.
    status?: "Active" | "Under Construction";
    companyId: string;
    userId: string;
  }
) {
  const {
    fixedAssetId,
    fixedAssetReadableId,
    registration,
    posting,
    status = "Active",
    companyId,
    userId
  } = args;
  const {
    locationId,
    fixedAssetClassId,
    assetAccountId,
    accumulatedDepreciationAccountId,
    offsetAccountId,
    locationDimensionId,
    assetClassDimensionId
  } = posting;

  const { acquisitionCost, acquisitionDate, accumulatedDepreciation } =
    registration;
  const now = datetime.timestamp();

  return db.transaction().execute(async (trx) => {
    const postingStatus = await journalPostingStatus(trx, companyId);
    let accountingPeriodId: string | null = null;
    if (postingStatus === "Posted") {
      // A Provisional journal counts nowhere, so only a Posted one needs the
      // dimensions.
      if (!locationDimensionId || !assetClassDimensionId) {
        throw new Error("Missing dimensions required for asset registration");
      }
      accountingPeriodId =
        await posting.resolveAccountingPeriodId(acquisitionDate);
    }

    // Post the acquisition journal FIRST, then flip the asset to Active — so a
    // capitalized asset can never exist without its GL entry (if the journal
    // fails the whole transaction rolls back and the asset stays Draft).
    //   Dr  assetAccountId                     acquisitionCost           (capitalize at gross cost)
    //       Cr  accumulatedDepreciationAccountId   accumulatedDepreciation   (opening contra, mid-life only)
    //       Cr  offsetAccountId                    nbv                       (owner equity)
    const journalEntryId = await getNextSequence(
      trx,
      "journalEntry",
      companyId
    );

    const journal = await trx
      .insertInto("journal")
      .values({
        journalEntryId,
        accountingPeriodId,
        companyId,
        description: `Asset Registration: ${fixedAssetReadableId}`,
        postingDate: acquisitionDate,
        sourceType: "Manual",
        status: postingStatus,
        postedAt: now,
        postedBy: userId,
        createdBy: userId
      })
      .returning(["id"])
      .executeTakeFirstOrThrow();

    const journalLineResults = await trx
      .insertInto("journalLine")
      .values(
        acquisitionLines(acquisitionCost, accumulatedDepreciation).map(
          (line) => ({
            journalId: journal.id,
            accountId:
              line.role === "asset"
                ? assetAccountId
                : line.role === "accumulatedDepreciation"
                  ? accumulatedDepreciationAccountId
                  : offsetAccountId,
            description: line.description,
            amount: line.amount,
            journalLineReference: crypto.randomUUID(),
            companyId
          })
        )
      )
      .returning(["id"])
      .execute();

    if (locationDimensionId && locationId) {
      await trx
        .insertInto("journalLineDimension")
        .values(
          journalLineResults.map((jl) => ({
            journalLineId: jl.id,
            dimensionId: locationDimensionId,
            valueId: locationId,
            companyId
          }))
        )
        .execute();
    }

    if (assetClassDimensionId && fixedAssetClassId) {
      await trx
        .insertInto("journalLineDimension")
        .values(
          journalLineResults.map((jl) => ({
            journalLineId: jl.id,
            dimensionId: assetClassDimensionId,
            valueId: fixedAssetClassId,
            companyId
          }))
        )
        .execute();
    }

    const updateResult = await trx
      .updateTable("fixedAsset")
      .set({
        status,
        acquisitionCost: registration.acquisitionCost,
        acquisitionDate: registration.acquisitionDate,
        accumulatedDepreciation: registration.accumulatedDepreciation,
        depreciationStartDate: registration.depreciationStartDate,
        updatedBy: userId
      })
      .where("id", "=", fixedAssetId)
      .where("status", "=", "Draft")
      .where("companyId", "=", companyId)
      .executeTakeFirst();

    if (!updateResult.numUpdatedRows) {
      // Lost the race (already registered/disposed) — roll back the journal.
      throw new Error("Asset is no longer in Draft status");
    }

    // An asset registered straight into a construction-in-progress class keeps
    // its registration cost as a CIP cost row, so capitalizing it into service
    // later sweeps that cost together with everything attached since
    // (post-asset-transfer sums the rows, not the asset's acquisitionCost).
    if (status === "Under Construction" && acquisitionCost > 0) {
      await trx
        .insertInto("fixedAssetCipCost")
        .values({
          fixedAssetId,
          sourceType: "Manual",
          amount: acquisitionCost,
          costDate: acquisitionDate,
          journalId: journal.id,
          companyId,
          createdBy: userId
        })
        .execute();
    }
  });
}

/**
 * Replaces a Draft depreciation run's lines with `lines`, keeping the run's id
 * and number. A run left with nothing to depreciate is deleted. Returns
 * whether the lines changed, so the route can say "already up to date".
 */
export async function replaceDepreciationRunLines(
  db: Kysely<KyselyDatabase>,
  args: {
    depreciationRunId: string;
    lines: DepreciationLine[];
    companyId: string;
    userId: string;
  }
): Promise<{ changed: boolean; deleted: boolean }> {
  const { depreciationRunId, lines, companyId, userId } = args;

  return db.transaction().execute(async (trx) => {
    const run = await trx
      .selectFrom("depreciationRun")
      .select(["depreciationRunId", "status", "periodEnd"])
      .where("id", "=", depreciationRunId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (run.status !== "Draft") {
      throw new Error(
        `Depreciation run ${run.depreciationRunId} is ${run.status}; only a draft can be recalculated`
      );
    }

    const before = await trx
      .selectFrom("depreciationRunLine")
      .select(["fixedAssetId", "periodEnd", "amount", "taxAmount"])
      .where("depreciationRunId", "=", depreciationRunId)
      .where("companyId", "=", companyId)
      .execute();
    // A line from before per-month lines has no periodEnd: it is the run's.
    const changed = !depreciationRunLinesMatch(
      before.map((line) => ({
        ...line,
        periodEnd: line.periodEnd ?? run.periodEnd
      })),
      lines
    );

    if (lines.length === 0) {
      await trx
        .deleteFrom("depreciationRun")
        .where("id", "=", depreciationRunId)
        .where("companyId", "=", companyId)
        .execute();
      return { changed, deleted: true };
    }
    if (!changed) return { changed, deleted: false };

    await trx
      .deleteFrom("depreciationRunLine")
      .where("depreciationRunId", "=", depreciationRunId)
      .where("companyId", "=", companyId)
      .execute();
    await trx
      .insertInto("depreciationRunLine")
      .values(
        lines.map((line) => ({
          depreciationRunId,
          periodEnd: line.periodEnd,
          fixedAssetId: line.fixedAssetId,
          amount: line.amount,
          taxAmount: line.taxAmount,
          companyId
        }))
      )
      .execute();
    await trx
      .updateTable("depreciationRun")
      .set({ updatedBy: userId })
      .where("id", "=", depreciationRunId)
      .where("companyId", "=", companyId)
      .execute();

    return { changed, deleted: false };
  });
}

/**
 * The period and posting date for each month a run covers: the month's own
 * end, in its own period, so a catch-up run posts each month where it
 * belongs — or the run's `periodEnd` when the month's period is Closed. Runs
 * post as an "accounting" source, so a Locked period still accepts them.
 */
export async function resolveRunPostingPeriods(
  client: SupabaseClient<Database>,
  args: { companyId: string; monthEnds: string[]; runPeriodEnd: string }
): Promise<
  | { data: RunPostingPeriods; error: null }
  | { data: null; error: { message: string } }
> {
  const { companyId, runPeriodEnd } = args;
  const months = [...new Set(args.monthEnds)].sort();
  if (months.length === 0) return { data: new Map(), error: null };

  const existing = await client
    .from("accountingPeriod")
    .select("startDate, endDate, closeStatus, closedAt")
    .eq("companyId", companyId)
    .lte("startDate", runPeriodEnd)
    .gte("endDate", months[0]);
  if (existing.error) return { data: null, error: existing.error };

  const closedMonths = new Set(
    months.filter((month) =>
      existing.data.some(
        (period) =>
          period.startDate <= month &&
          period.endDate >= month &&
          (period.closeStatus === "Closed" || period.closedAt !== null)
      )
    )
  );
  const targets = runPostingTargets({ months, runPeriodEnd, closedMonths });

  // One call per distinct target month (it creates a missing period), never
  // one per line.
  const byTarget = new Map<
    string,
    { accountingPeriodId: string; postingDate: string }
  >();
  for (const target of new Set(targets.values())) {
    const period = await getOrCreateAccountingPeriod(
      client,
      companyId,
      target,
      "accounting"
    );
    if (period.error || !period.data) {
      return {
        data: null,
        error: period.error ?? {
          message: `No accounting period for ${target}`
        }
      };
    }
    byTarget.set(target, {
      accountingPeriodId: period.data,
      postingDate: target
    });
  }

  return {
    data: new Map(
      months.map((month) => [month, byTarget.get(targets.get(month)!)!])
    ),
    error: null
  };
}

/** Each month a run covers → the period and posting date its journals use. */
export type RunPostingPeriods = Map<
  string,
  { accountingPeriodId: string; postingDate: string }
>;

export async function postDepreciationRun(
  db: Kysely<KyselyDatabase>,
  args: {
    depreciationRunId: string;
    depreciationRunReadableId: string;
    periods: RunPostingPeriods;
    /** The lines the route checked against the assets. Posting refuses when
     *  the run holds any other lines by the time it is locked. */
    lineIds: string[];
    locationDimensionId: string | undefined;
    assetClassDimensionId: string | undefined;
    taxEnabled: boolean;
    taxRate: number | null;
    dtlAccountId: string | null;
    dtExpenseAccountId: string | null;
    companyId: string;
    userId: string;
  }
) {
  const {
    depreciationRunId,
    depreciationRunReadableId,
    periods,
    lineIds,
    locationDimensionId,
    assetClassDimensionId,
    taxEnabled,
    taxRate,
    dtlAccountId,
    dtExpenseAccountId,
    companyId,
    userId
  } = args;

  if (!(await readAccountingCutoverDate(db, companyId))) {
    throw new Error(ACCOUNTING_NOT_STARTED);
  }
  const now = datetime.timestamp();

  const periodOf = (monthEnd: string) => {
    const period = periods.get(monthEnd);
    if (!period) {
      throw new Error(`No accounting period resolved for ${monthEnd}`);
    }
    return period;
  };

  return db.transaction().execute(async (trx) => {
    // Lock the run first: two posts of one Draft must not both get through.
    const run = await trx
      .selectFrom("depreciationRun")
      .select(["depreciationRunId", "status", "periodEnd"])
      .where("id", "=", depreciationRunId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (run.status !== "Draft") {
      throw new RunOutOfDateError(
        `Depreciation run ${run.depreciationRunId} is already ${run.status}`
      );
    }

    // The lines and the assets as they are now, not as the route read them.
    const runLines = await trx
      .selectFrom("depreciationRunLine as l")
      .innerJoin("fixedAsset as a", (join) =>
        join
          .onRef("a.id", "=", "l.fixedAssetId")
          .on("a.companyId", "=", companyId)
      )
      .innerJoin("fixedAssetClass as c", (join) =>
        join
          .onRef("c.id", "=", "a.fixedAssetClassId")
          .on("c.companyId", "=", companyId)
      )
      .select([
        "l.id",
        "l.fixedAssetId",
        sql<string | null>`l."periodEnd"::text`.as("periodEnd"),
        "l.amount",
        "l.taxAmount",
        "a.fixedAssetId as assetReadableId",
        "a.locationId",
        "a.fixedAssetClassId",
        "c.depreciationExpenseAccountId",
        "c.accumulatedDepreciationAccountId"
      ])
      .where("l.depreciationRunId", "=", depreciationRunId)
      .where("l.companyId", "=", companyId)
      .execute();

    const expected = new Set(lineIds);
    if (
      runLines.length !== expected.size ||
      runLines.some((line) => !expected.has(line.id))
    ) {
      throw new RunOutOfDateError(
        `Depreciation run ${run.depreciationRunId} changed while it was being posted; review it and post again`
      );
    }

    const assetIds = [...new Set(runLines.map((line) => line.fixedAssetId))];
    const assets =
      assetIds.length === 0
        ? []
        : await trx
            .selectFrom("fixedAsset")
            .select([
              "id",
              "fixedAssetId",
              "status",
              "acquisitionCost",
              "accumulatedDepreciation",
              "residualValuePercent"
            ])
            .where("id", "in", assetIds)
            .where("companyId", "=", companyId)
            .forUpdate()
            .execute();
    const assetById = new Map(assets.map((asset) => [asset.id, asset]));
    const notDepreciable = assets.find(
      (asset) =>
        asset.status !== "Active" && asset.status !== "Fully Depreciated"
    );
    if (notDepreciable) {
      throw new RunOutOfDateError(
        `${notDepreciable.fixedAssetId} is ${notDepreciable.status}; recalculate depreciation run ${run.depreciationRunId} before posting`
      );
    }

    // A line from before per-month lines has no periodEnd: it is the run's.
    const lines = runLines.map((line) => ({
      ...line,
      monthEnd: line.periodEnd ?? run.periodEnd,
      amount: Number(line.amount),
      taxAmount: Number(line.taxAmount ?? 0)
    }));
    const dimensionIds = {
      Location: locationDimensionId,
      FixedAssetClass: assetClassDimensionId
    };

    for (const journal of buildDepreciationJournals(lines)) {
      const { id } = await insertPostedRunJournal(trx, journal, {
        ...periodOf(journal.monthEnd),
        dimensionIds,
        companyId,
        userId,
        now
      });
      await trx
        .updateTable("depreciationRunLine")
        .set({ journalId: id })
        .where("id", "=", journal.lineId)
        .where("companyId", "=", companyId)
        .execute();
    }

    // One update per asset with every month's amount. Each line used to add
    // its own amount to the same starting value, so with several months of
    // one asset only the last month reached accumulatedDepreciation.
    const byAsset = new Map<string, { amount: number; taxAmount: number }>();
    for (const line of lines) {
      const sums = byAsset.get(line.fixedAssetId) ?? {
        amount: 0,
        taxAmount: 0
      };
      sums.amount += line.amount;
      sums.taxAmount += line.taxAmount;
      byAsset.set(line.fixedAssetId, sums);
    }

    for (const [fixedAssetId, sums] of byAsset) {
      const asset = assetById.get(fixedAssetId)!;
      // Round at persist: a catch-up run adds many months, and float sums
      // stored 20187.59999999999 for 30 months of 672.92. The increment is
      // written in SQL against the row locked above.
      const amount = round(sums.amount);
      const taxAmount = round(sums.taxAmount);
      const newAccumulated = round(
        Number(asset.accumulatedDepreciation) + amount
      );
      const cost = Number(asset.acquisitionCost);
      const residualValue = cost * (Number(asset.residualValuePercent) / 100);
      const nbv = cost - newAccumulated;

      await trx
        .updateTable("fixedAsset")
        .set({
          accumulatedDepreciation: sql<number>`"accumulatedDepreciation" + ${amount}`,
          ...(nbv <= residualValue + 0.01
            ? { status: "Fully Depreciated" as const }
            : {}),
          ...(taxEnabled && taxAmount > 0
            ? {
                accumulatedTaxDepreciation: sql<number>`COALESCE("accumulatedTaxDepreciation", 0) + ${taxAmount}`
              }
            : {}),
          updatedBy: userId
        })
        .where("id", "=", fixedAssetId)
        .where("companyId", "=", companyId)
        .execute();
    }

    // Deferred tax journal entry, one per month, linked to that month's
    // lines so Reverse Run can find it.
    const deferredTax = buildDeferredTaxJournals({
      runReadableId: depreciationRunReadableId,
      lines,
      settings: deferredTaxSettings({
        enabled: taxEnabled,
        taxRate,
        dtlAccountId,
        dtExpenseAccountId
      })
    });
    for (const journal of deferredTax) {
      const { id } = await insertPostedRunJournal(trx, journal, {
        ...periodOf(journal.monthEnd),
        dimensionIds,
        companyId,
        userId,
        now
      });
      await trx
        .updateTable("depreciationRunLine")
        .set({ deferredTaxJournalId: id })
        .where("id", "in", journal.lineIds)
        .where("companyId", "=", companyId)
        .execute();
    }

    await trx
      .updateTable("depreciationRun")
      .set({
        status: "Posted",
        postedAt: now,
        postedBy: userId
      })
      .where("id", "=", depreciationRunId)
      .where("companyId", "=", companyId)
      .execute();
  });
}

// ── Revenue recognition runs ─────────────────────────────────────────────────
// Spec: `.ai/specs/implemented/2026-09-22-revenue-recognition-rentals-and-contracts.md` Part I §1. Proposals are
// built by the `propose-revenue-recognition-run` server function (shared with the Inngest job);
// posting and deletion are human actions and live here, beside the
// depreciation-run posters they mirror.

export type RevenueRecognitionDimensionIds = {
  customer?: string;
  item?: string;
  location?: string;
  /** Contract rows only: the contract line's project, else the contract's. */
  project?: string;
};

type AccountClass = NonNullable<Database["public"]["Enums"]["glAccountClass"]>;
type DimensionEntityType = Database["public"]["Enums"]["dimensionEntityType"];

/**
 * Posts a Draft revenue recognition run as one journal per month its rows
 * fall in (`sourceType` 'Revenue Recognition'), each in that month's period —
 * the run's own when the month is Closed: two lines per schedule row, each
 * row's own debit/credit accounts, signed by account class. Stamps each row
 * with its month's journal, the run with the journal of its own period, and
 * flips both to Posted, all in one transaction. The route resolves the
 * periods (`resolveRunPostingPeriods`, `source: "accounting"`, so a Locked
 * period accepts them) and the dimension ids before calling.
 */
export async function postRevenueRecognitionRun(
  db: Kysely<KyselyDatabase>,
  args: {
    runId: string;
    companyId: string;
    userId: string;
    /** Each month the run's rows fall in → its period and posting date
     *  (`resolveRunPostingPeriods`). */
    periods: RunPostingPeriods;
    dimensionIds: RevenueRecognitionDimensionIds;
  }
) {
  const { runId, companyId, userId, periods, dimensionIds } = args;
  if (!(await readAccountingCutoverDate(db, companyId))) {
    throw new Error(ACCOUNTING_NOT_STARTED);
  }
  const now = datetime.timestamp();

  return db.transaction().execute(async (trx) => {
    const run = await trx
      .selectFrom("revenueRecognitionRun")
      .select(["id", "runId", "status", "periodEnd"])
      .where("id", "=", runId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (run.status !== "Draft") {
      throw new Error(
        `Revenue recognition run ${run.runId} is already ${run.status}`
      );
    }

    const rows = await trx
      .selectFrom("revenueRecognitionRunLine as l")
      .innerJoin("revenueRecognitionSchedule as s", (join) =>
        join
          .onRef("s.id", "=", "l.scheduleId")
          .on("s.companyId", "=", companyId)
      )
      .select([
        "l.amount",
        "s.amount as scheduleAmount",
        "s.status as scheduleStatus",
        "s.id as scheduleId",
        sql<string>`s."scheduledDate"::text`.as("scheduledDate"),
        "s.type",
        "s.debitAccountId",
        "s.creditAccountId",
        "s.salesInvoiceLineId",
        "s.rentalAgreementLineId",
        "s.rentalLeaseScheduleLineId",
        "s.customerContractLineId",
        "s.customerContractRevenueId"
      ])
      .where("l.runId", "=", runId)
      .where("l.companyId", "=", companyId)
      .execute();
    if (rows.length === 0) {
      throw new Error(`Revenue recognition run ${run.runId} has no lines`);
    }

    // A Draft is a snapshot of the schedule when it was proposed. Posting it
    // after a row it holds changed, or after another row fell due by its
    // period end, would recognize the wrong amount or leave that revenue to a
    // later period. Recalculating rebuilds it from the schedule as it is now.
    const unclaimed = await trx
      .selectFrom("revenueRecognitionSchedule")
      .select("id")
      .where("companyId", "=", companyId)
      .where("status", "=", "Planned")
      .where("runLineId", "is", null)
      .where("scheduledDate", "<=", run.periodEnd)
      .executeTakeFirst();
    // Contract months are synthesized into schedule rows at proposal time, so
    // a month that fell due since (a contract confirmed later) has no row yet;
    // and a held contract row whose plan month an amendment replaced (its
    // `customerContractRevenueId` nulled) would recognize a stale amount.
    const unsynthesizedContractRevenue = await trx
      .selectFrom("customerContractRevenue as r")
      .innerJoin("customerContract as c", (join) =>
        join
          .onRef("c.id", "=", "r.customerContractId")
          .onRef("c.companyId", "=", "r.companyId")
      )
      .select("r.id")
      .where("r.companyId", "=", companyId)
      .where("r.status", "=", "Planned")
      .where("r.periodStart", "<=", run.periodEnd)
      .where("r.amount", "<>", 0)
      .where("c.status", "<>", "Draft")
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom("revenueRecognitionSchedule as s")
              .select("s.id")
              .whereRef("s.customerContractRevenueId", "=", "r.id")
              .where("s.companyId", "=", companyId)
          )
        )
      )
      .executeTakeFirst();
    const drifted = rows.some(
      (row) =>
        row.scheduleStatus !== "Planned" ||
        !equals(Number(row.amount), Number(row.scheduleAmount)) ||
        (row.customerContractLineId && !row.customerContractRevenueId)
    );
    if (unclaimed || unsynthesizedContractRevenue || drifted) {
      throw new RunOutOfDateError(
        `Revenue recognition run ${run.runId} is out of date with the revenue schedule; recalculate it before posting`
      );
    }

    // `account` is group-scoped (no companyId); the ids came from rows already
    // scoped to this company.
    const accountIds = [
      ...new Set(
        rows.flatMap((row) => [row.debitAccountId, row.creditAccountId])
      )
    ];
    const accounts = await trx
      .selectFrom("account")
      .select(["id", "class"])
      .where("id", "in", accountIds)
      .execute();
    const classById = new Map<string, AccountClass>();
    for (const account of accounts) {
      if (account.class) classById.set(account.id, account.class);
    }

    // Deferral rows point at the invoice line that funded them; the journal
    // line references the invoice and carries its customer/item/location.
    const invoiceLineIds = [
      ...new Set(
        rows
          .map((row) => row.salesInvoiceLineId)
          .filter((id): id is string => Boolean(id))
      )
    ];
    const invoiceLines =
      invoiceLineIds.length === 0
        ? []
        : await trx
            .selectFrom("salesInvoiceLine as sil")
            .innerJoin("salesInvoice as si", (join) =>
              join
                .onRef("si.id", "=", "sil.invoiceId")
                .on("si.companyId", "=", companyId)
            )
            .select([
              "sil.id",
              "sil.invoiceId",
              "sil.itemId",
              "sil.locationId",
              "si.customerId"
            ])
            .where("sil.id", "in", invoiceLineIds)
            .where("sil.companyId", "=", companyId)
            .execute();
    const invoiceLineById = new Map(
      invoiceLines.map((line) => [line.id, line])
    );

    // Accrual (and later Interest) rows point at a rental agreement line; the
    // journal line references the agreement and carries its customer, the
    // line's item and the agreement's location.
    const rentalLineIds = [
      ...new Set(
        rows
          .filter((row) => !row.salesInvoiceLineId)
          .map((row) => row.rentalAgreementLineId)
          .filter((id): id is string => Boolean(id))
      )
    ];
    const rentalLines =
      rentalLineIds.length === 0
        ? []
        : await trx
            .selectFrom("rentalAgreementLine as ral")
            .innerJoin("rentalAgreement as ra", (join) =>
              join
                .onRef("ra.id", "=", "ral.rentalAgreementId")
                .on("ra.companyId", "=", companyId)
            )
            .select([
              "ral.id",
              "ral.itemId",
              "ra.id as rentalAgreementId",
              "ra.customerId",
              "ra.locationId"
            ])
            .where("ral.id", "in", rentalLineIds)
            .where("ral.companyId", "=", companyId)
            .execute();
    const rentalLineById = new Map(rentalLines.map((line) => [line.id, line]));

    // Contract rows (synthesized from the contract's revenue plan) point at a
    // contract line; the journal line references the contract and carries its
    // customer, the line's item and the line's (else the contract's) project.
    const contractLineIds = [
      ...new Set(
        rows
          .map((row) => row.customerContractLineId)
          .filter((id): id is string => Boolean(id))
      )
    ];
    const contractLines =
      contractLineIds.length === 0
        ? []
        : await trx
            .selectFrom("customerContractLine as ccl")
            .innerJoin("customerContract as cc", (join) =>
              join
                .onRef("cc.id", "=", "ccl.customerContractId")
                .on("cc.companyId", "=", companyId)
            )
            .select([
              "ccl.id",
              "ccl.itemId",
              "cc.id as customerContractId",
              "cc.customerId",
              sql<string | null>`COALESCE(ccl."projectId", cc."projectId")`.as(
                "projectId"
              )
            ])
            .where("ccl.id", "in", contractLineIds)
            .where("ccl.companyId", "=", companyId)
            .execute();
    const contractLineById = new Map(
      contractLines.map((line) => [line.id, line])
    );

    // One journal per month: a row posts in the period of the month it was
    // scheduled for (the run's own period when that month is Closed), so a
    // catch-up run puts each month's revenue where it was earned.
    const periodOfMonth = (monthEnd: string) => {
      const period = periods.get(monthEnd);
      if (!period) {
        throw new Error(`No accounting period resolved for ${monthEnd}`);
      }
      return period;
    };
    const periodIdByDate = new Map<string, string>();
    const scheduleRows = rows.map((row) => {
      const period = periodOfMonth(monthEndOf(row.scheduledDate));
      periodIdByDate.set(period.postingDate, period.accountingPeriodId);
      return { ...row, postingDate: period.postingDate };
    });
    const sources: RecognitionSources = {
      invoiceLines: invoiceLineById,
      rentalLines: rentalLineById,
      contractLines: contractLineById
    };
    // Throws when an account has no class.
    const { journals, runJournal } = buildRecognitionJournals({
      runReadableId: run.runId,
      runPeriodEnd: run.periodEnd,
      rows: scheduleRows,
      sources,
      classById
    });
    const recognitionDimensionIds = {
      Customer: dimensionIds.customer,
      Item: dimensionIds.item,
      Location: dimensionIds.location,
      Project: dimensionIds.project
    };

    const written = new Map<
      (typeof journals)[number],
      { id: string; journalEntryId: string }
    >();
    for (const journal of journals) {
      const inserted = await insertPostedRunJournal(trx, journal, {
        accountingPeriodId: periodIdByDate.get(journal.postingDate)!,
        postingDate: journal.postingDate,
        dimensionIds: recognitionDimensionIds,
        companyId,
        userId,
        now
      });
      written.set(journal, inserted);

      await trx
        .updateTable("revenueRecognitionSchedule")
        .set({ journalId: inserted.id, status: "Posted", updatedBy: userId })
        .where("id", "in", journal.scheduleIds)
        .where("companyId", "=", companyId)
        .execute();
      // Each contract row's Recognition ledger entry records the journal
      // that posted it.
      if (journal.contractScheduleIds.length > 0) {
        await trx
          .updateTable("customerContractLedgerEntry")
          .set({ journalId: inserted.id })
          .where(
            "revenueRecognitionScheduleId",
            "in",
            journal.contractScheduleIds
          )
          .where("companyId", "=", companyId)
          .execute();
      }
      // An Interest row posts one period of a sales-type lease's effective
      // interest schedule; the schedule line records the journal that posted
      // it, which is how the net investment report tells posted principal
      // from future principal.
      if (journal.leaseScheduleLineIds.length > 0) {
        await trx
          .updateTable("rentalLeaseScheduleLine")
          .set({
            journalId: inserted.id,
            postedAt: now,
            updatedBy: userId,
            updatedAt: now
          })
          .where("id", "in", journal.leaseScheduleLineIds)
          .where("companyId", "=", companyId)
          .execute();
      }
    }

    // A contract month is recognized once its schedule rows post.
    const recognizedRevenueIds = [
      ...new Set(
        rows
          .map((row) => row.customerContractRevenueId)
          .filter((id): id is string => Boolean(id))
      )
    ];
    if (recognizedRevenueIds.length > 0) {
      await trx
        .updateTable("customerContractRevenue")
        .set({ status: "Recognized", updatedBy: userId, updatedAt: now })
        .where("id", "in", recognizedRevenueIds)
        .where("companyId", "=", companyId)
        .execute();
    }

    // The run names the journal of its own period, else its latest month's;
    // every journal is reachable from the schedule rows it posted. The run
    // has rows, so it has a journal.
    const runJournalRow = written.get(runJournal!)!;

    await trx
      .updateTable("revenueRecognitionRun")
      .set({
        journalId: runJournalRow.id,
        status: "Posted",
        postedAt: now,
        postedBy: userId,
        updatedBy: userId
      })
      .where("id", "=", runId)
      .where("companyId", "=", companyId)
      .execute();

    return {
      journalId: runJournalRow.id,
      journalEntryId: runJournalRow.journalEntryId
    };
  });
}

/** A Posted period run cannot be reversed; the message is meant for the user
 *  (the reverse routes show it, where other failures get a generic toast). */
export class RunReversalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunReversalError";
  }
}

/**
 * Where each journal of a run is reversed: on its own posting date when that
 * period is not Closed, else on the company's today. Keyed by the original
 * posting date.
 */
export async function resolveReversalPeriods(
  client: SupabaseClient<Database>,
  args: { companyId: string; postingDates: string[] }
): Promise<
  | { data: RunPostingPeriods; error: null }
  | { data: null; error: { message: string } }
> {
  const { companyId } = args;
  const dates = [...new Set(args.postingDates)].sort();
  if (dates.length === 0) return { data: new Map(), error: null };

  const [existing, companyToday] = await Promise.all([
    client
      .from("accountingPeriod")
      .select("startDate, endDate, closeStatus, closedAt")
      .eq("companyId", companyId)
      .lte("startDate", dates[dates.length - 1])
      .gte("endDate", dates[0]),
    getCompanyToday(client, companyId)
  ]);
  if (existing.error) return { data: null, error: existing.error };

  const targetOf = new Map(
    dates.map((date) => {
      const closed = existing.data.some(
        (period) =>
          period.startDate <= date &&
          period.endDate >= date &&
          (period.closeStatus === "Closed" || period.closedAt !== null)
      );
      return [date, closed ? companyToday : date] as const;
    })
  );

  // One call per distinct target date, never one per journal line.
  const byTarget = new Map<
    string,
    { accountingPeriodId: string; postingDate: string }
  >();
  for (const target of new Set(targetOf.values())) {
    const period = await getOrCreateAccountingPeriod(
      client,
      companyId,
      target,
      "accounting"
    );
    if (period.error || !period.data) {
      return {
        data: null,
        error: period.error ?? {
          message: `No accounting period for ${target}`
        }
      };
    }
    byTarget.set(target, {
      accountingPeriodId: period.data,
      postingDate: target
    });
  }

  return {
    data: new Map(
      dates.map((date) => [date, byTarget.get(targetOf.get(date)!)!])
    ),
    error: null
  };
}

/**
 * Reverses posted journals the way `reverseJournalEntry` does — a Posted
 * entry with every line negated, the original marked Reversed — but keeps
 * each line's document and dimensions, and dates each reversal by `periods`
 * (keyed by the original's posting date). Shared by Reverse Run for revenue
 * recognition and depreciation, inside the caller's transaction.
 */
export async function reverseRunJournals(
  trx: KyselyTx,
  args: {
    journalIds: string[];
    periods: RunPostingPeriods;
    companyId: string;
    userId: string;
  }
): Promise<void> {
  const { journalIds, periods, companyId, userId } = args;
  if (journalIds.length === 0) return;
  const now = datetime.timestamp();

  const [journals, lines] = await Promise.all([
    trx
      .selectFrom("journal")
      .select([
        "id",
        "journalEntryId",
        "status",
        "sourceType",
        sql<string>`"postingDate"::text`.as("postingDate")
      ])
      .where("id", "in", journalIds)
      .where("companyId", "=", companyId)
      .orderBy("postingDate")
      .orderBy("journalEntryId")
      .forUpdate()
      .execute(),
    trx
      .selectFrom("journalLine")
      .select([
        "id",
        "journalId",
        "accountId",
        "description",
        "amount",
        "documentType",
        "documentId"
      ])
      .where("journalId", "in", journalIds)
      .where("companyId", "=", companyId)
      .orderBy("id")
      .execute()
  ]);
  const notPosted = journals.find((journal) => journal.status !== "Posted");
  if (notPosted) {
    throw new RunReversalError(
      `Journal ${notPosted.journalEntryId} is ${notPosted.status}, so the run cannot be reversed`
    );
  }

  const dimensions =
    lines.length === 0
      ? []
      : await trx
          .selectFrom("journalLineDimension")
          .select(["journalLineId", "dimensionId", "valueId"])
          .where(
            "journalLineId",
            "in",
            lines.map((line) => line.id)
          )
          .where("companyId", "=", companyId)
          .execute();

  const reversedLineId = new Map<string, string>();
  for (const journal of journals) {
    const period = periods.get(journal.postingDate);
    if (!period) {
      throw new Error(`No reversal period resolved for ${journal.postingDate}`);
    }
    const journalEntryId = await getNextSequence(
      trx,
      "journalEntry",
      companyId
    );
    const reversal = await trx
      .insertInto("journal")
      .values({
        journalEntryId,
        accountingPeriodId: period.accountingPeriodId,
        companyId,
        description: `Reversal of ${journal.journalEntryId}`,
        postingDate: period.postingDate,
        sourceType: journal.sourceType,
        reversalOfId: journal.id,
        status: "Posted",
        postedAt: now,
        postedBy: userId,
        createdBy: userId
      })
      .returning(["id"])
      .executeTakeFirstOrThrow();

    const journalLines = lines.filter((line) => line.journalId === journal.id);
    if (journalLines.length > 0) {
      // RETURNING follows the VALUES order, so each new line pairs with its
      // original.
      const inserted = await trx
        .insertInto("journalLine")
        .values(
          journalLines.map((line) => ({
            journalId: reversal.id,
            accountId: line.accountId,
            description: line.description,
            amount: -Number(line.amount),
            documentType: line.documentType,
            documentId: line.documentId,
            journalLineReference: crypto.randomUUID(),
            companyId
          }))
        )
        .returning(["id"])
        .execute();
      journalLines.forEach((line, index) => {
        reversedLineId.set(line.id, inserted[index]!.id);
      });
    }

    await trx
      .updateTable("journal")
      .set({ status: "Reversed", reversedById: reversal.id, updatedBy: userId })
      .where("id", "=", journal.id)
      .where("companyId", "=", companyId)
      .execute();
  }

  if (dimensions.length > 0) {
    await trx
      .insertInto("journalLineDimension")
      .values(
        dimensions.map((dimension) => ({
          journalLineId: reversedLineId.get(dimension.journalLineId)!,
          dimensionId: dimension.dimensionId,
          valueId: dimension.valueId,
          companyId
        }))
      )
      .execute();
  }
}

/**
 * Reverse Run for revenue recognition (NetSuite ARM's void: the plan lines
 * become recognizable again). Reverses every journal the run posted, puts
 * its schedule rows back to Planned — still held by the run — clears what
 * posting stamped (lease schedule lines, contract ledger entries, contract
 * revenue months) and returns the run to Draft, so it can be recalculated,
 * posted again or deleted.
 */
export async function reverseRevenueRecognitionRun(
  db: Kysely<KyselyDatabase>,
  args: {
    runId: string;
    periods: RunPostingPeriods;
    companyId: string;
    userId: string;
  }
): Promise<{ runId: string }> {
  const { runId, periods, companyId, userId } = args;
  const now = datetime.timestamp();

  return db.transaction().execute(async (trx) => {
    const run = await trx
      .selectFrom("revenueRecognitionRun")
      .select(["id", "runId", "status", "periodEnd"])
      .where("id", "=", runId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (run.status !== "Posted") {
      throw new RunReversalError(
        `Revenue recognition run ${run.runId} is ${run.status}; only a posted run can be reversed`
      );
    }
    // The reversed run becomes the period's Draft, and a period holds one.
    const draft = await trx
      .selectFrom("revenueRecognitionRun")
      .select("runId")
      .where("companyId", "=", companyId)
      .where("periodEnd", "=", run.periodEnd)
      .where("status", "=", "Draft")
      .executeTakeFirst();
    if (draft) {
      throw new RunReversalError(
        `${draft.runId} is a draft for this period. Post or delete it before reversing ${run.runId}.`
      );
    }

    const rows = await trx
      .selectFrom("revenueRecognitionRunLine as l")
      .innerJoin("revenueRecognitionSchedule as s", (join) =>
        join
          .onRef("s.id", "=", "l.scheduleId")
          .on("s.companyId", "=", companyId)
      )
      .select([
        "s.id",
        "s.journalId",
        "s.rentalLeaseScheduleLineId",
        "s.customerContractRevenueId"
      ])
      .where("l.runId", "=", runId)
      .where("l.companyId", "=", companyId)
      .execute();
    const journalIds = [
      ...new Set(
        rows
          .map((row) => row.journalId)
          .filter((id): id is string => Boolean(id))
      )
    ];

    await reverseRunJournals(trx, { journalIds, periods, companyId, userId });

    const scheduleIds = rows.map((row) => row.id);
    if (scheduleIds.length > 0) {
      await trx
        .updateTable("revenueRecognitionSchedule")
        .set({ status: "Planned", journalId: null, updatedBy: userId })
        .where("id", "in", scheduleIds)
        .where("companyId", "=", companyId)
        .execute();
      await trx
        .updateTable("customerContractLedgerEntry")
        .set({ journalId: null })
        .where("revenueRecognitionScheduleId", "in", scheduleIds)
        .where("companyId", "=", companyId)
        .execute();
    }

    const leaseScheduleLineIds = [
      ...new Set(
        rows
          .map((row) => row.rentalLeaseScheduleLineId)
          .filter((id): id is string => Boolean(id))
      )
    ];
    if (leaseScheduleLineIds.length > 0) {
      await trx
        .updateTable("rentalLeaseScheduleLine")
        .set({
          journalId: null,
          postedAt: null,
          updatedBy: userId,
          updatedAt: now
        })
        .where("id", "in", leaseScheduleLineIds)
        .where("companyId", "=", companyId)
        .execute();
    }

    const contractRevenueIds = [
      ...new Set(
        rows
          .map((row) => row.customerContractRevenueId)
          .filter((id): id is string => Boolean(id))
      )
    ];
    if (contractRevenueIds.length > 0) {
      await trx
        .updateTable("customerContractRevenue")
        .set({ status: "Planned", updatedBy: userId, updatedAt: now })
        .where("id", "in", contractRevenueIds)
        .where("companyId", "=", companyId)
        .execute();
    }

    await trx
      .updateTable("revenueRecognitionRun")
      .set({
        status: "Draft",
        journalId: null,
        postedAt: null,
        postedBy: null,
        updatedBy: userId,
        updatedAt: now
      })
      .where("id", "=", runId)
      .where("companyId", "=", companyId)
      .execute();

    return { runId: run.runId };
  });
}

/**
 * Reverse Run for depreciation. Reverses every journal the run posted (each
 * month's, and each month's deferred tax), takes the run's amounts back off
 * each asset's accumulated book and tax depreciation, returns a Fully
 * Depreciated asset that is above its residual value to Active, and returns
 * the run to Draft. Only the latest posted run can be reversed: a later run
 * was calculated from the accumulated depreciation this one wrote.
 */
export async function reverseDepreciationRun(
  db: Kysely<KyselyDatabase>,
  args: {
    depreciationRunId: string;
    periods: RunPostingPeriods;
    companyId: string;
    userId: string;
  }
): Promise<{ depreciationRunId: string }> {
  const { depreciationRunId, periods, companyId, userId } = args;

  return db.transaction().execute(async (trx) => {
    const run = await trx
      .selectFrom("depreciationRun")
      .select(["depreciationRunId", "status", "periodEnd"])
      .where("id", "=", depreciationRunId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (run.status !== "Posted") {
      throw new RunReversalError(
        `Depreciation run ${run.depreciationRunId} is ${run.status}; only a posted run can be reversed`
      );
    }

    const later = await trx
      .selectFrom("depreciationRun")
      .select("depreciationRunId")
      .where("companyId", "=", companyId)
      .where("status", "=", "Posted")
      .where("periodEnd", ">", run.periodEnd)
      .orderBy("periodEnd")
      .executeTakeFirst();
    if (later) {
      throw new RunReversalError(
        `${later.depreciationRunId} is posted for a later period and builds on this run. Reverse it first.`
      );
    }

    const lines = await trx
      .selectFrom("depreciationRunLine as l")
      .innerJoin("fixedAsset as a", (join) =>
        join
          .onRef("a.id", "=", "l.fixedAssetId")
          .on("a.companyId", "=", companyId)
      )
      .select([
        "l.fixedAssetId",
        "l.amount",
        "l.taxAmount",
        "l.journalId",
        "l.deferredTaxJournalId",
        "a.fixedAssetId as assetReadableId",
        "a.status",
        "a.acquisitionCost",
        "a.accumulatedDepreciation",
        "a.accumulatedTaxDepreciation",
        "a.residualValuePercent"
      ])
      .where("l.depreciationRunId", "=", depreciationRunId)
      .where("l.companyId", "=", companyId)
      .execute();

    const disposed = lines.find((line) => line.status === "Disposed");
    if (disposed) {
      throw new RunReversalError(
        `${disposed.assetReadableId} was disposed after this run. Reverse the disposal first.`
      );
    }

    const journalIds = [
      ...new Set(
        lines
          .flatMap((line) => [line.journalId, line.deferredTaxJournalId])
          .filter((id): id is string => Boolean(id))
      )
    ];
    await reverseRunJournals(trx, { journalIds, periods, companyId, userId });

    // One update per asset with every month's amount, as posting wrote it.
    // Tax depreciation is taken back when the run carried it, not when the
    // setting is on today: a line has a taxAmount exactly when tax
    // depreciation was enabled as the run posted (Post refuses a run whose
    // lines no longer match the setting), and posting added it then.
    const byAsset = new Map<
      string,
      {
        line: (typeof lines)[number];
        amount: number;
        taxAmount: number;
        hasTax: boolean;
      }
    >();
    for (const line of lines) {
      const sums = byAsset.get(line.fixedAssetId) ?? {
        line,
        amount: 0,
        taxAmount: 0,
        hasTax: false
      };
      sums.amount += Number(line.amount);
      sums.taxAmount += Number(line.taxAmount ?? 0);
      sums.hasTax ||= line.taxAmount !== null;
      byAsset.set(line.fixedAssetId, sums);
    }
    for (const [fixedAssetId, { line, amount, taxAmount, hasTax }] of byAsset) {
      const accumulated = round(Number(line.accumulatedDepreciation) - amount);
      const cost = Number(line.acquisitionCost);
      const residualValue = cost * (Number(line.residualValuePercent) / 100);
      const assetUpdate: Record<string, unknown> = {
        accumulatedDepreciation: accumulated,
        updatedBy: userId
      };
      if (hasTax && taxAmount > 0) {
        assetUpdate.accumulatedTaxDepreciation = round(
          Number(line.accumulatedTaxDepreciation ?? 0) - taxAmount
        );
      }
      // Posting marks an asset Fully Depreciated at its residual value.
      if (
        line.status === "Fully Depreciated" &&
        cost - accumulated > residualValue + 0.01
      ) {
        assetUpdate.status = "Active";
      }
      await trx
        .updateTable("fixedAsset")
        .set(assetUpdate)
        .where("id", "=", fixedAssetId)
        .where("companyId", "=", companyId)
        .execute();
    }

    await trx
      .updateTable("depreciationRunLine")
      .set({ journalId: null, deferredTaxJournalId: null })
      .where("depreciationRunId", "=", depreciationRunId)
      .where("companyId", "=", companyId)
      .execute();

    await trx
      .updateTable("depreciationRun")
      .set({
        status: "Draft",
        postedAt: null,
        postedBy: null,
        updatedBy: userId
      })
      .where("id", "=", depreciationRunId)
      .where("companyId", "=", companyId)
      .execute();

    return { depreciationRunId: run.depreciationRunId };
  });
}

/** Deletes a Draft run and releases its claimed schedule rows (`runLineId`
 * back to null) so a later proposal can claim them again. A Posted run is
 * never deleted: Reverse Run (`reverseRevenueRecognitionRun`) returns it to
 * Draft first. */
export async function deleteRevenueRecognitionRun(
  db: Kysely<KyselyDatabase>,
  args: { runId: string; companyId: string; userId: string }
) {
  const { runId, companyId, userId } = args;

  return db.transaction().execute(async (trx) => {
    const run = await trx
      .selectFrom("revenueRecognitionRun")
      .select(["runId", "status"])
      .where("id", "=", runId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (run.status !== "Draft") {
      throw new Error(
        `Revenue recognition run ${run.runId} is ${run.status}; reverse the run instead of deleting it`
      );
    }

    const lineIds = (
      await trx
        .selectFrom("revenueRecognitionRunLine")
        .select("id")
        .where("runId", "=", runId)
        .where("companyId", "=", companyId)
        .execute()
    ).map((line) => line.id);

    if (lineIds.length > 0) {
      await trx
        .updateTable("revenueRecognitionSchedule")
        .set({ runLineId: null, updatedBy: userId })
        .where("runLineId", "in", lineIds)
        .where("companyId", "=", companyId)
        .execute();
      await trx
        .deleteFrom("revenueRecognitionRunLine")
        .where("runId", "=", runId)
        .where("companyId", "=", companyId)
        .execute();
    }

    await trx
      .deleteFrom("revenueRecognitionRun")
      .where("id", "=", runId)
      .where("companyId", "=", companyId)
      .execute();
  });
}
