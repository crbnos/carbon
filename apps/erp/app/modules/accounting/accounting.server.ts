import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { getNextSequence } from "@carbon/database/sequence";
import type { ReportPeriodBucket } from "@carbon/utils";
import { datetime, toStoredAmount } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyCtaToReportPeriodSeries,
  getAccountLedger,
  getAccountLedgerSummary,
  getConsolidatedBalances,
  getConsolidatedPeriodSeries
} from "./accounting.service";
import { acquisitionLines } from "./accounting.utils";

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

  const nbv = acquisitionCost - accumulatedDepreciation;
  const now = new Date().toISOString();

  return db.transaction().execute(async (trx) => {
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
        description: `Asset Disposal: ${fixedAssetReadableId} (${disposalMethod})`,
        postingDate: disposalDate,
        sourceType: "Asset Disposal",
        status: "Posted",
        postedAt: now,
        postedBy: userId,
        createdBy: userId
      })
      .returning(["id"])
      .executeTakeFirstOrThrow();

    const journalLines: Array<{
      journalId: string;
      accountId: string;
      description: string;
      amount: number;
      journalLineReference: string;
      companyId: string;
    }> = [];

    if (accumulatedDepreciation > 0) {
      journalLines.push({
        journalId: journal.id,
        accountId: accumulatedDepreciationAccountId,
        description: "Clear accumulated depreciation",
        amount: toStoredAmount(accumulatedDepreciation, 0, "Asset"),
        journalLineReference: crypto.randomUUID(),
        companyId
      });
    }

    if (nbv > 0) {
      // Scrap has no proceeds, so the entire net book value is a loss booked to
      // the dedicated Loss on Disposal account (not comingled with the write-off
      // account). gainLoss = 0 − nbv = −nbv → a full debit (loss).
      journalLines.push({
        journalId: journal.id,
        accountId: lossOnDisposalAccountId,
        description: "Loss on disposal (scrap)",
        amount: toStoredAmount(nbv, 0, "Expense"),
        journalLineReference: crypto.randomUUID(),
        companyId
      });
    }

    journalLines.push({
      journalId: journal.id,
      accountId: assetAccountId,
      description: "Remove asset at cost",
      amount: toStoredAmount(0, acquisitionCost, "Asset"),
      journalLineReference: crypto.randomUUID(),
      companyId
    });

    const journalLineResults = await trx
      .insertInto("journalLine")
      .values(journalLines)
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

    await trx
      .insertInto("fixedAssetDisposal")
      .values({
        fixedAssetId,
        disposalMethod,
        disposalDate,
        saleProceeds: 0,
        netBookValueAtDisposal: nbv,
        gainLoss: -nbv,
        journalId: journal.id,
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
    locationId: string | null;
    fixedAssetClassId: string;
    assetAccountId: string;
    // Contra-asset account credited with any opening accumulated depreciation
    // when the asset is capitalized mid-life (from the asset class).
    accumulatedDepreciationAccountId: string;
    // Equity offset for a direct (non-purchase) registration — owner equity /
    // retained earnings. Brings the asset onto the books at NBV.
    offsetAccountId: string;
    accountingPeriodId: string;
    locationDimensionId: string | undefined;
    assetClassDimensionId: string | undefined;
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
    locationId,
    fixedAssetClassId,
    assetAccountId,
    accumulatedDepreciationAccountId,
    offsetAccountId,
    accountingPeriodId,
    locationDimensionId,
    assetClassDimensionId,
    status = "Active",
    companyId,
    userId
  } = args;

  const { acquisitionCost, acquisitionDate, accumulatedDepreciation } =
    registration;
  const now = new Date().toISOString();

  return db.transaction().execute(async (trx) => {
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
        status: "Posted",
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

type DepreciationRunLine = {
  id: string;
  fixedAssetId: string;
  amount: number;
  taxAmount: number;
  asset: {
    fixedAssetId: string;
    locationId: string | null;
    fixedAssetClassId: string;
    acquisitionCost: number;
    accumulatedDepreciation: number;
    accumulatedTaxDepreciation: number;
    residualValuePercent: number;
    depreciationExpenseAccountId: string;
    accumulatedDepreciationAccountId: string;
  };
};

export async function postDepreciationRun(
  db: Kysely<KyselyDatabase>,
  args: {
    depreciationRunId: string;
    depreciationRunReadableId: string;
    postingDate: string;
    accountingPeriodId: string;
    lines: DepreciationRunLine[];
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
    postingDate,
    accountingPeriodId,
    lines,
    locationDimensionId,
    assetClassDimensionId,
    taxEnabled,
    taxRate,
    dtlAccountId,
    dtExpenseAccountId,
    companyId,
    userId
  } = args;

  const now = new Date().toISOString();

  return db.transaction().execute(async (trx) => {
    for (const line of lines) {
      const { asset } = line;
      const amount = Number(line.amount);

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
          description: `Depreciation: ${asset.fixedAssetId}`,
          postingDate,
          sourceType: "Asset Depreciation",
          status: "Posted",
          postedAt: now,
          postedBy: userId,
          createdBy: userId
        })
        .returning(["id"])
        .executeTakeFirstOrThrow();

      const journalLineResults = await trx
        .insertInto("journalLine")
        .values([
          {
            journalId: journal.id,
            accountId: asset.depreciationExpenseAccountId,
            description: "Depreciation Expense",
            amount: toStoredAmount(amount, 0, "Expense"),
            journalLineReference: crypto.randomUUID(),
            companyId
          },
          {
            journalId: journal.id,
            accountId: asset.accumulatedDepreciationAccountId,
            description: "Accumulated Depreciation",
            amount: toStoredAmount(0, amount, "Asset"),
            journalLineReference: crypto.randomUUID(),
            companyId
          }
        ])
        .returning(["id"])
        .execute();

      if (locationDimensionId && asset.locationId) {
        await trx
          .insertInto("journalLineDimension")
          .values(
            journalLineResults.map((jl) => ({
              journalLineId: jl.id,
              dimensionId: locationDimensionId,
              valueId: asset.locationId!,
              companyId
            }))
          )
          .execute();
      }

      if (assetClassDimensionId && asset.fixedAssetClassId) {
        await trx
          .insertInto("journalLineDimension")
          .values(
            journalLineResults.map((jl) => ({
              journalLineId: jl.id,
              dimensionId: assetClassDimensionId,
              valueId: asset.fixedAssetClassId,
              companyId
            }))
          )
          .execute();
      }

      await trx
        .updateTable("depreciationRunLine")
        .set({ journalId: journal.id })
        .where("id", "=", line.id)
        .execute();

      const newAccumulated = Number(asset.accumulatedDepreciation) + amount;
      const cost = Number(asset.acquisitionCost);
      const residualValue = cost * (Number(asset.residualValuePercent) / 100);
      const nbv = cost - newAccumulated;

      const assetUpdate: Record<string, any> = {
        accumulatedDepreciation: newAccumulated,
        updatedBy: userId
      };

      if (nbv <= residualValue + 0.01) {
        assetUpdate.status = "Fully Depreciated";
      }

      if (taxEnabled) {
        const taxAmount = Number(line.taxAmount ?? 0);
        if (taxAmount > 0) {
          const currentTax = Number(asset.accumulatedTaxDepreciation ?? 0);
          assetUpdate.accumulatedTaxDepreciation = currentTax + taxAmount;
        }
      }

      await trx
        .updateTable("fixedAsset")
        .set(assetUpdate)
        .where("id", "=", line.fixedAssetId)
        .execute();
    }

    // Deferred tax liability journal entry
    if (taxEnabled && taxRate && dtlAccountId && dtExpenseAccountId) {
      const diffByGroup = new Map<
        string,
        { locationId: string | null; fixedAssetClassId: string; diff: number }
      >();

      for (const line of lines) {
        const bookAmount = Number(line.amount);
        const taxAmt = Number(line.taxAmount ?? bookAmount);
        const diff = taxAmt - bookAmount;
        const locId = line.asset.locationId ?? null;
        const classId = line.asset.fixedAssetClassId;
        const key = `${locId ?? ""}|${classId}`;
        const existing = diffByGroup.get(key);
        if (existing) {
          existing.diff += diff;
        } else {
          diffByGroup.set(key, {
            locationId: locId,
            fixedAssetClassId: classId,
            diff
          });
        }
      }

      const totalTemporaryDifference = [...diffByGroup.values()].reduce(
        (sum, g) => sum + g.diff,
        0
      );
      const dtlAmount = Math.abs(totalTemporaryDifference * (taxRate / 100));

      if (dtlAmount > 0.01) {
        const dtlEntryId = await getNextSequence(
          trx,
          "journalEntry",
          companyId
        );

        const dtlJournal = await trx
          .insertInto("journal")
          .values({
            journalEntryId: dtlEntryId,
            accountingPeriodId,
            companyId,
            description: `Deferred Tax: Depreciation ${depreciationRunReadableId}`,
            postingDate,
            sourceType: "Asset Depreciation",
            status: "Posted",
            postedAt: now,
            postedBy: userId,
            createdBy: userId
          })
          .returning(["id"])
          .executeTakeFirstOrThrow();

        const isLiability = totalTemporaryDifference > 0;

        const significantEntries = [...diffByGroup.values()].filter(
          (g) => Math.abs(g.diff * (taxRate / 100)) > 0.01
        );

        const dtlLineValues = significantEntries.flatMap((g) => {
          const locAmount = Math.abs(g.diff * (taxRate / 100));
          return [
            {
              journalId: dtlJournal.id,
              accountId: isLiability ? dtExpenseAccountId : dtlAccountId,
              description: isLiability
                ? "Deferred Tax Expense"
                : "Deferred Tax Liability",
              amount: toStoredAmount(
                locAmount,
                0,
                isLiability ? "Expense" : "Liability"
              ),
              journalLineReference: crypto.randomUUID(),
              companyId
            },
            {
              journalId: dtlJournal.id,
              accountId: isLiability ? dtlAccountId : dtExpenseAccountId,
              description: isLiability
                ? "Deferred Tax Liability"
                : "Deferred Tax Benefit",
              amount: toStoredAmount(
                0,
                locAmount,
                isLiability ? "Liability" : "Expense"
              ),
              journalLineReference: crypto.randomUUID(),
              companyId
            }
          ];
        });

        if (dtlLineValues.length > 0) {
          const dtlLineResults = await trx
            .insertInto("journalLine")
            .values(dtlLineValues)
            .returning(["id"])
            .execute();

          const dimensionValues: Array<{
            journalLineId: string;
            dimensionId: string;
            valueId: string;
            companyId: string;
          }> = [];

          for (let i = 0; i < significantEntries.length; i++) {
            const g = significantEntries[i];
            const debitLineId = dtlLineResults[i * 2].id;
            const creditLineId = dtlLineResults[i * 2 + 1].id;

            if (locationDimensionId && g.locationId) {
              dimensionValues.push(
                {
                  journalLineId: debitLineId,
                  dimensionId: locationDimensionId,
                  valueId: g.locationId,
                  companyId
                },
                {
                  journalLineId: creditLineId,
                  dimensionId: locationDimensionId,
                  valueId: g.locationId,
                  companyId
                }
              );
            }

            if (assetClassDimensionId && g.fixedAssetClassId) {
              dimensionValues.push(
                {
                  journalLineId: debitLineId,
                  dimensionId: assetClassDimensionId,
                  valueId: g.fixedAssetClassId,
                  companyId
                },
                {
                  journalLineId: creditLineId,
                  dimensionId: assetClassDimensionId,
                  valueId: g.fixedAssetClassId,
                  companyId
                }
              );
            }
          }

          if (dimensionValues.length > 0) {
            await trx
              .insertInto("journalLineDimension")
              .values(dimensionValues)
              .execute();
          }
        }
      }
    }

    await trx
      .updateTable("depreciationRun")
      .set({
        status: "Posted",
        postedAt: now,
        postedBy: userId
      })
      .where("id", "=", depreciationRunId)
      .execute();
  });
}

// ── Revenue recognition runs ─────────────────────────────────────────────────
// Spec: .ai/specs/2026-09-22-revenue-recognition-and-rentals.md §1. Proposals are
// built by @carbon/database/revenue-recognition (shared with the Inngest job);
// posting and deletion are human actions and live here, beside the
// depreciation-run posters they mirror.

export type RevenueRecognitionDimensionIds = {
  customer?: string;
  item?: string;
  location?: string;
};

type RevenueScheduleType = Database["public"]["Enums"]["revenueScheduleType"];
type AccountClass = NonNullable<Database["public"]["Enums"]["glAccountClass"]>;

const REVENUE_LINE_DESCRIPTIONS: Record<
  RevenueScheduleType,
  { debit: string; credit: string }
> = {
  Deferral: {
    debit: "Deferred revenue released",
    credit: "Revenue recognized"
  },
  Accrual: { debit: "Unbilled rent accrued", credit: "Rental income accrued" },
  Interest: {
    debit: "Net investment interest",
    credit: "Lease interest income"
  }
};

/**
 * Posts a Draft revenue recognition run as ONE journal (`sourceType`
 * 'Revenue Recognition'): two lines per schedule row, each row's own
 * debit/credit accounts, signed by account class. Stamps `journalId` on the
 * rows and the run and flips both to Posted, all in one transaction. The route
 * resolves the accounting period (`source: "accounting"`, so a Locked period
 * accepts it) and the dimension ids before calling.
 */
export async function postRevenueRecognitionRun(
  db: Kysely<KyselyDatabase>,
  args: {
    runId: string;
    companyId: string;
    userId: string;
    accountingPeriodId: string;
    postingDate: string;
    dimensionIds: RevenueRecognitionDimensionIds;
  }
) {
  const {
    runId,
    companyId,
    userId,
    accountingPeriodId,
    postingDate,
    dimensionIds
  } = args;
  const now = datetime.timestamp();

  return db.transaction().execute(async (trx) => {
    const run = await trx
      .selectFrom("revenueRecognitionRun")
      .select(["id", "runId", "status"])
      .where("id", "=", runId)
      .where("companyId", "=", companyId)
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
        "s.id as scheduleId",
        "s.type",
        "s.debitAccountId",
        "s.creditAccountId",
        "s.salesInvoiceLineId",
        "s.rentalAgreementLineId",
        "s.rentalLeaseScheduleLineId"
      ])
      .where("l.runId", "=", runId)
      .where("l.companyId", "=", companyId)
      .execute();
    if (rows.length === 0) {
      throw new Error(`Revenue recognition run ${run.runId} has no lines`);
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
    for (const id of accountIds) {
      if (!classById.has(id)) {
        throw new Error(`Account ${id} on the revenue schedule has no class`);
      }
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
        description: `Revenue Recognition ${run.runId}`,
        postingDate,
        sourceType: "Revenue Recognition",
        status: "Posted",
        postedAt: now,
        postedBy: userId,
        createdBy: userId
      })
      .returning(["id"])
      .executeTakeFirstOrThrow();

    for (const row of rows) {
      const amount = Number(row.amount);
      const descriptions = REVENUE_LINE_DESCRIPTIONS[row.type];
      const invoiceSource = row.salesInvoiceLineId
        ? invoiceLineById.get(row.salesInvoiceLineId)
        : undefined;
      const rentalSource =
        !invoiceSource && row.rentalAgreementLineId
          ? rentalLineById.get(row.rentalAgreementLineId)
          : undefined;
      const source = invoiceSource ?? rentalSource;
      const document = invoiceSource
        ? {
            documentType: "Invoice" as const,
            documentId: invoiceSource.invoiceId
          }
        : rentalSource
          ? {
              documentType: "Rental Agreement" as const,
              documentId: rentalSource.rentalAgreementId
            }
          : {};

      if (amount !== 0) {
        // A negative row (a credit memo's deferral) reverses the legs: the
        // stored amount is signed by account class, so the debit leg of a
        // negative row is a credit of its magnitude and vice versa.
        const magnitude = Math.abs(amount);
        const debitClass = classById.get(row.debitAccountId)!;
        const creditClass = classById.get(row.creditAccountId)!;
        const debitAmount =
          amount > 0
            ? toStoredAmount(magnitude, 0, debitClass)
            : toStoredAmount(0, magnitude, debitClass);
        const creditAmount =
          amount > 0
            ? toStoredAmount(0, magnitude, creditClass)
            : toStoredAmount(magnitude, 0, creditClass);

        const journalLines = await trx
          .insertInto("journalLine")
          .values([
            {
              journalId: journal.id,
              accountId: row.debitAccountId,
              description: descriptions.debit,
              amount: debitAmount,
              journalLineReference: crypto.randomUUID(),
              companyId,
              ...document
            },
            {
              journalId: journal.id,
              accountId: row.creditAccountId,
              description: descriptions.credit,
              amount: creditAmount,
              journalLineReference: crypto.randomUUID(),
              companyId,
              ...document
            }
          ])
          .returning(["id"])
          .execute();

        const dimensionValues: Array<{ dimensionId: string; valueId: string }> =
          [];
        if (dimensionIds.customer && source?.customerId) {
          dimensionValues.push({
            dimensionId: dimensionIds.customer,
            valueId: source.customerId
          });
        }
        if (dimensionIds.item && source?.itemId) {
          dimensionValues.push({
            dimensionId: dimensionIds.item,
            valueId: source.itemId
          });
        }
        if (dimensionIds.location && source?.locationId) {
          dimensionValues.push({
            dimensionId: dimensionIds.location,
            valueId: source.locationId
          });
        }
        if (dimensionValues.length > 0) {
          await trx
            .insertInto("journalLineDimension")
            .values(
              journalLines.flatMap((line) =>
                dimensionValues.map((dimension) => ({
                  journalLineId: line.id,
                  dimensionId: dimension.dimensionId,
                  valueId: dimension.valueId,
                  companyId
                }))
              )
            )
            .execute();
        }
      }

      await trx
        .updateTable("revenueRecognitionSchedule")
        .set({ journalId: journal.id, status: "Posted", updatedBy: userId })
        .where("id", "=", row.scheduleId)
        .where("companyId", "=", companyId)
        .execute();
    }

    // An Interest row posts one period of a sales-type lease's effective
    // interest schedule; the schedule line records the journal that posted it,
    // which is how the net investment report tells posted principal from
    // future principal.
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
          journalId: journal.id,
          postedAt: now,
          updatedBy: userId,
          updatedAt: now
        })
        .where("id", "in", leaseScheduleLineIds)
        .where("companyId", "=", companyId)
        .execute();
    }

    await trx
      .updateTable("revenueRecognitionRun")
      .set({
        journalId: journal.id,
        status: "Posted",
        postedAt: now,
        postedBy: userId,
        updatedBy: userId
      })
      .where("id", "=", runId)
      .where("companyId", "=", companyId)
      .execute();

    return { journalId: journal.id, journalEntryId };
  });
}

/** Deletes a Draft run and releases its claimed schedule rows (`runLineId`
 * back to null) so a later proposal can claim them again. Posted runs are
 * immutable — reverse the journal instead. */
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
      .executeTakeFirstOrThrow();
    if (run.status !== "Draft") {
      throw new Error(
        `Revenue recognition run ${run.runId} is ${run.status}; reverse its journal instead of deleting it`
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
