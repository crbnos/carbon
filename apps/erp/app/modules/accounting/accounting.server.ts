// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database, Json } from "@carbon/database";
import {
  fetchAllFromTable,
  fetchAllRecords,
  getCompanyTimeZone
} from "@carbon/database";
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
import {
  type RunType,
  runLabelSentence,
  runTypeFilter,
  runTypeOfScheduleRow
} from "@carbon/database/run-type";
import { getNextSequence } from "@carbon/database/sequence";
import { serverFns } from "@carbon/server-functions";
import { applyAccountImportInput } from "@carbon/server-functions/apply-account-import";
import { isDataLayerError } from "@carbon/server-functions/errors";
import type { ReportPeriodBucket } from "@carbon/utils";
import { datetime, equals, formatDate, round } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sql } from "kysely";
import { z } from "zod";
import {
  insertPurchaseOrder,
  upsertPurchaseOrderLine
} from "~/modules/purchasing/purchasing.service";
import {
  getOnRentLineForAsset,
  insertSalesOrder
} from "~/modules/sales/sales.service";
import {
  type CarbonError,
  defineServiceFn,
  type ErrorCategory,
  type ServiceContext
} from "~/modules/service-fn.server";
import { getUserDefaults } from "~/modules/users/users.server";
import {
  ACCOUNTING_NOT_STARTED,
  applyCtaToReportPeriodSeries,
  buildDepreciationRunLines,
  closePeriodWithChecklist,
  completeCloseTask,
  createDepreciationRun,
  deleteExchangeRateOverride,
  getAccountLedger,
  getAccountLedgerSummary,
  getConsolidatedBalances,
  getConsolidatedPeriodSeries,
  getDefaultAccounts,
  getExchangeRates,
  getFixedAsset,
  getOrCreateAccountingPeriod,
  insertDepreciationRun,
  lockAccountingPeriod,
  postJournalEntry,
  returnFixedAssetToService,
  saveJournalEntryWithLines,
  setFixedAssetOutOfService,
  skipCloseTask,
  unlockAccountingPeriod,
  upsertExchangeRateOverride
} from "./accounting.service";
import {
  type ActivationCutoverDates,
  acquisitionLines,
  activationCutoverDates,
  type DepreciationLine,
  depreciationRunLinesMatch,
  getNextPeriodEnd,
  getNextRevenueRecognitionPeriodEnd,
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

/**
 * Saves a currency's config and, when given, pins its exchange rate as a
 * company override — in ONE transaction, so a failed pin never leaves the
 * config saved behind a "failed to save" message. The route has already
 * checked `update: accounting`; the writes are scoped to the company group
 * (config) and the company (override). Returns null when the currency is not
 * in the group.
 */
export async function saveCurrencyWithRateOverride(
  db: Kysely<KyselyDatabase>,
  args: {
    currencyId: string;
    companyId: string;
    companyGroupId: string;
    userId: string;
    config: {
      decimalPlaces: number;
      historicalExchangeRate: number | null;
      customFields: Json;
    };
    overrideRate: number | null;
  }
): Promise<{ code: string } | null> {
  return db.transaction().execute(async (trx) => {
    const currency = await trx
      .updateTable("currency")
      .set({
        decimalPlaces: args.config.decimalPlaces,
        historicalExchangeRate: args.config.historicalExchangeRate,
        customFields: args.config.customFields,
        updatedBy: args.userId,
        updatedAt: datetime.timestamp()
      })
      .where("id", "=", args.currencyId)
      .where("companyGroupId", "=", args.companyGroupId)
      .returning("code")
      .executeTakeFirst();

    if (!currency) return null;

    if (args.overrideRate !== null) {
      // Update-in-place on conflict so re-pinning keeps the original creator.
      await trx
        .insertInto("exchangeRateOverride")
        .values({
          companyId: args.companyId,
          currencyCode: currency.code,
          rate: args.overrideRate,
          createdBy: args.userId
        })
        .onConflict((oc) =>
          oc.columns(["companyId", "currencyCode"]).doUpdateSet({
            rate: args.overrideRate as number,
            updatedBy: args.userId,
            updatedAt: datetime.timestamp()
          })
        )
        .execute();
    }

    return { code: currency.code };
  });
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
  /** Lessee lease rows only: the lease's supplier. */
  supplier?: string;
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
      .select(["id", "runId", "status", "periodEnd", "type"])
      .where("id", "=", runId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (run.status !== "Draft") {
      throw new Error(
        `${runLabelSentence(run.type)} ${run.runId} is already ${run.status}`
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
        "s.customerContractRevenueId",
        "s.leaseId",
        "s.leaseScheduleLineId"
      ])
      .where("l.runId", "=", runId)
      .where("l.companyId", "=", companyId)
      .execute();
    if (rows.length === 0) {
      throw new Error(
        `${runLabelSentence(run.type)} ${run.runId} has no lines`
      );
    }

    // A Draft is a snapshot of the schedule when it was proposed. Posting it
    // after a row it holds changed, or after another row fell due by its
    // period end, would recognize the wrong amount or leave that revenue to a
    // later period. Recalculating rebuilds it from the schedule as it is now.
    const unclaimed = await trx
      .selectFrom("revenueRecognitionSchedule")
      .select("id")
      .where("companyId", "=", companyId)
      .where(runTypeFilter(run.type))
      .where("status", "=", "Planned")
      .where("runLineId", "is", null)
      .where("scheduledDate", "<=", run.periodEnd)
      .executeTakeFirst();
    // Contract months are synthesized into schedule rows at proposal time, so
    // a month that fell due since (a contract confirmed later) has no row yet;
    // and a held contract row whose plan month an amendment replaced (its
    // `customerContractRevenueId` nulled) would recognize a stale amount.
    const unsynthesizedContractRevenue =
      run.type !== "Revenue Recognition"
        ? undefined
        : await trx
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
        `${runLabelSentence(run.type)} ${run.runId} is out of date with its schedule; recalculate it before posting`
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
    // Lessee lease rows reference the lease, with its supplier and location.
    const leaseIds = [
      ...new Set(
        rows.map((row) => row.leaseId).filter((id): id is string => Boolean(id))
      )
    ];
    const leases =
      leaseIds.length === 0
        ? []
        : await trx
            .selectFrom("lease")
            .select(["id", "supplierId", "locationId"])
            .where("id", "in", leaseIds)
            .where("companyId", "=", companyId)
            .execute();
    const leaseScheduleLineIds = rows
      .map((row) => row.leaseScheduleLineId)
      .filter((id): id is string => Boolean(id));
    const leaseAssets =
      leaseScheduleLineIds.length === 0
        ? []
        : await trx
            .selectFrom("leaseScheduleLine as sl")
            .innerJoin("leaseLine as l", (join) =>
              join
                .onRef("l.id", "=", "sl.leaseLineId")
                .onRef("l.companyId", "=", "sl.companyId")
            )
            .select(["sl.id", "sl.leaseLineId", "l.locationId"])
            .where("sl.id", "in", leaseScheduleLineIds)
            .where("sl.companyId", "=", companyId)
            .execute();

    const sources: RecognitionSources = {
      invoiceLines: invoiceLineById,
      rentalLines: rentalLineById,
      contractLines: contractLineById,
      leases: new Map(leases.map((lease) => [lease.id, lease])),
      leaseAssets: new Map(leaseAssets.map((asset) => [asset.id, asset]))
    };
    // Throws when an account has no class.
    const { journals, runJournal } = buildRecognitionJournals({
      runType: run.type,
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
      Project: dimensionIds.project,
      Supplier: dimensionIds.supplier
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
      // A lessee lease's month: its schedule line records the journal that
      // posted it.
      if (journal.lesseeScheduleLineIds.length > 0) {
        await trx
          .updateTable("leaseScheduleLine")
          .set({
            journalId: inserted.id,
            postedAt: now,
            updatedBy: userId,
            updatedAt: now
          })
          .where("id", "in", journal.lesseeScheduleLineIds)
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
): Promise<{ runId: string; deleted: boolean }> {
  const { runId, periods, companyId, userId } = args;
  const now = datetime.timestamp();

  return db.transaction().execute(async (trx) => {
    const run = await trx
      .selectFrom("revenueRecognitionRun")
      .select(["id", "runId", "status", "periodEnd", "type"])
      .where("id", "=", runId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (run.status !== "Posted") {
      throw new RunReversalError(
        `${runLabelSentence(run.type)} ${run.runId} is ${run.status}; only a posted run can be reversed`
      );
    }
    // The reversed run becomes the period's Draft, and a period holds one.
    const draft = await trx
      .selectFrom("revenueRecognitionRun")
      .select("runId")
      .where("companyId", "=", companyId)
      .where("type", "=", run.type)
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
        "s.customerContractRevenueId",
        "s.leaseScheduleLineId",
        "s.rentalAgreementLineId",
        "s.leaseId",
        "l.id as lineId"
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

    const lesseeScheduleLineIds = [
      ...new Set(
        rows
          .map((row) => row.leaseScheduleLineId)
          .filter((id): id is string => Boolean(id))
      )
    ];
    if (lesseeScheduleLineIds.length > 0) {
      await trx
        .updateTable("leaseScheduleLine")
        .set({
          journalId: null,
          postedAt: null,
          updatedBy: userId,
          updatedAt: now
        })
        .where("id", "in", lesseeScheduleLineIds)
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

    // A run posted before lease runs existed can hold rental rows. Those now
    // belong to the lease run: release them, so the next lease run claims
    // them. A run left holding nothing is deleted rather than kept as an
    // empty Draft.
    const otherFamily = rows.filter(
      (row) => runTypeOfScheduleRow(row) !== run.type
    );
    if (otherFamily.length > 0) {
      await trx
        .updateTable("revenueRecognitionSchedule")
        .set({ runLineId: null, updatedBy: userId })
        .where(
          "id",
          "in",
          otherFamily.map((row) => row.id)
        )
        .where("companyId", "=", companyId)
        .execute();
      await trx
        .deleteFrom("revenueRecognitionRunLine")
        .where(
          "id",
          "in",
          otherFamily.map((row) => row.lineId)
        )
        .where("companyId", "=", companyId)
        .execute();
    }
    if (otherFamily.length === rows.length) {
      await trx
        .deleteFrom("revenueRecognitionRun")
        .where("id", "=", runId)
        .where("companyId", "=", companyId)
        .execute();
      return { runId: run.runId, deleted: true };
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

    return { runId: run.runId, deleted: false };
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
      .select(["runId", "status", "type"])
      .where("id", "=", runId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (run.status !== "Draft") {
      throw new Error(
        `${runLabelSentence(run.type)} ${run.runId} is ${run.status}; reverse the run instead of deleting it`
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

// ── Operations ──────────────────────────────────────────────────────────────
// Each is a `defineServiceFn` listed in `index.server.ts`: the route, the API
// and MCP call the same one, and it holds every check the route made.

/** The server functions, run as the system for this call's company and user. */
function system(ctx: ServiceContext) {
  return serverFns.system({
    db: ctx.asSystem.pg,
    companyId: ctx.company.id,
    userId: ctx.auditUserId
  });
}

/** The server functions, run as this call's caller: their own permission
 *  check applies again. */
function asCaller(ctx: ServiceContext) {
  return serverFns.as({
    client: ctx.asCaller.supabase,
    db: ctx.asSystem.pg,
    companyId: ctx.company.id,
    userId: ctx.auditUserId
  });
}

/** A server function's refusal as this function's error: its status picks
 *  the category, and an empty message (a data-layer failure) is `fallback`. */
function fromServerFn(
  ctx: ServiceContext,
  error: { status: number; message: string },
  fallback: string
): CarbonError {
  const category: ErrorCategory =
    error.status === 400
      ? "validation"
      : error.status === 403
        ? "forbidden"
        : error.status === 404
          ? "notFound"
          : error.status === 409
            ? "conflict"
            : error.status < 500
              ? "rule"
              : "internal";
  return ctx.error(category, error.message || fallback, error);
}

/** A refusal a building block returned or threw ("Only open periods can be
 *  locked"): its own message, unless it came from the data layer. */
function refusal(
  ctx: ServiceContext,
  err: unknown,
  fallback: string
): CarbonError {
  const message = (err as { message?: unknown } | null)?.message;
  return typeof message === "string" && message !== "" && !isDataLayerError(err)
    ? ctx.error("rule", message, err)
    : ctx.error("internal", fallback, err);
}

const runTypes = ["Revenue Recognition", "Lease"] as const satisfies RunType[];

// ── Depreciation runs ───────────────────────────────────────────────────────

/** A Draft depreciation run for `periodEnd`, from what each asset should
 *  depreciate up to it. Shared by New Run and the period close. */
async function createDepreciationRunAt(ctx: ServiceContext, periodEnd: string) {
  // Never an empty run: with nothing to depreciate this refuses.
  const result = await createDepreciationRun(ctx.asCaller.supabase, {
    companyId: ctx.company.id,
    companyGroupId: ctx.company.groupId,
    periodEnd,
    userId: ctx.auditUserId
  });
  if (result.error) {
    return refusal(ctx, result.error, "Failed to create depreciation run");
  }
  return { id: result.data.id, readableId: result.data.depreciationRunId };
}

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

/** A Draft run of `type` for `periodEnd`, unless the month has not started or
 *  a Draft of the type already holds the period. Shared by New Run, Repeat
 *  and the period close. */
async function proposeRunAt(
  ctx: ServiceContext,
  periodEnd: string,
  type: RunType
) {
  const client = ctx.asCaller.supabase;
  const futureError = await futureRunPeriodError(
    client,
    ctx.company.id,
    periodEnd
  );
  if (futureError) return ctx.error("rule", futureError);

  // A period can have more than one run of a type (a second picks up rows
  // that fell due after the first posted), but only one Draft at a time.
  const existingDraft = await client
    .from("revenueRecognitionRun")
    .select("id, runId")
    .eq("periodEnd", periodEnd)
    .eq("companyId", ctx.company.id)
    .eq("type", type)
    .eq("status", "Draft")
    .maybeSingle();
  if (existingDraft.data) {
    return ctx.error(
      "conflict",
      `${existingDraft.data.runId} is already a draft for this period. Recalculate it instead.`
    );
  }

  // The proposal creates nothing when nothing is due.
  const proposal = await system(ctx).invoke("propose-revenue-recognition-run", {
    periodEnd,
    type
  });
  if (proposal.error) {
    return fromServerFn(ctx, proposal.error, "Failed to create the run");
  }
  if (!proposal.data) {
    return ctx.error("rule", "Nothing to post for this period");
  }
  return { id: proposal.data.id, readableId: proposal.data.runId, type };
}

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
 * Why an asset cannot be taken out of service now, or null. The page's loader
 * and the operation both ask: the form can be submitted long after it was
 * opened.
 */
export async function outOfServiceRefusal(
  caller: SupabaseClient<Database>,
  system: SupabaseClient<Database>,
  fixedAssetId: string,
  companyId: string
): Promise<{
  category: ErrorCategory;
  message: string;
  cause?: unknown;
} | null> {
  const asset = await getFixedAsset(caller, fixedAssetId, companyId);
  if (asset.error) {
    return {
      category: "notFound",
      message: "Failed to get fixed asset",
      cause: asset.error
    };
  }
  if (asset.data.outOfServiceSince) {
    return { category: "rule", message: "The asset is already out of service" };
  }
  if (asset.data.status === "Disposed") {
    return {
      category: "rule",
      message: "A disposed asset cannot be taken out of service"
    };
  }

  // A unit on rent goes to maintenance through the agreement's Return (with
  // "Take out of service"), never around it. Read with the service role,
  // scoped to the company and the asset: agreement lines need sales_view,
  // which an accountant may not hold, and under RLS that reads as "not on
  // rent". A failed read refuses rather than passes.
  const onRent = await getOnRentLineForAsset(system, fixedAssetId, companyId);
  if (onRent.error) {
    return {
      category: "internal",
      message: "Failed to check whether the asset is on rent",
      cause: onRent.error
    };
  }
  if (onRent.data) {
    const agreement = onRent.data.rentalAgreement;
    return {
      category: "rule",
      message: `The asset is on rent${agreement ? ` on ${agreement.rentalAgreementId}` : ""}; return it from the agreement and take it out of service there`
    };
  }
  return null;
}

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
