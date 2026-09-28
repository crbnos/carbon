import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { getNextSequence } from "@carbon/database/sequence";
import type { ReportPeriodBucket } from "@carbon/utils";
import { toStoredAmount } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCompanySettings } from "~/modules/settings";
import {
  type CommandResult,
  commandError,
  commandOk
} from "~/utils/command-result";
import {
  applyCtaToReportPeriodSeries,
  getAccountLedger,
  getAccountLedgerSummary,
  getBaseCurrencyDecimalPlaces,
  getConsolidatedBalances,
  getConsolidatedPeriodSeries,
  getDefaultAccounts,
  getOrCreateAccountingPeriod,
  insertDepreciationRun
} from "./accounting.service";
import {
  acquisitionLines,
  buildDepreciationLines,
  getNextPeriodEnd
} from "./accounting.utils";

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
        status: "Active",
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

export async function postDepreciationRunJournals(
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
        .where("companyId", "=", companyId)
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
        .where("companyId", "=", companyId)
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
      .where("companyId", "=", companyId)
      .execute();
  });
}

// ---------------------------------------------------------------------------
// Fixed-asset commands.
//
// Each one is the body of its ERP route action (register, dispose, post a
// depreciation run): the derivation of period, dimensions and class accounts,
// then the Kysely posting above. The routes reduce to parse + call + flash, and
// `accounting.mcp.server.ts` exposes the same commands as tools, so the two
// paths cannot drift. Errors carry the route's flash text (see
// `~/utils/command-result`).
// ---------------------------------------------------------------------------

type FixedAssetCommandContext = {
  companyId: string;
  companyGroupId: string;
  userId: string;
};

async function getActiveDimensionIds(
  client: SupabaseClient<Database>,
  companyGroupId: string
) {
  const dimensions = await client
    .from("dimension")
    .select("id, entityType")
    .eq("companyGroupId", companyGroupId)
    .eq("active", true);
  return {
    error: dimensions.error,
    locationDimensionId: (dimensions.data ?? []).find(
      (d) => d.entityType === "Location"
    )?.id,
    assetClassDimensionId: (dimensions.data ?? []).find(
      (d) => d.entityType === "FixedAssetClass"
    )?.id
  };
}

/**
 * Register a Draft fixed asset (Draft → Active). With accounting enabled it
 * posts the acquisition journal (`postAssetRegistration`) and flips the status
 * in one transaction; with accounting disabled it is a plain status flip that
 * matches only a Draft row. Body of `x+/fixed-asset+/$fixedAssetId.register`.
 */
export async function registerFixedAsset(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: FixedAssetCommandContext & {
    fixedAssetId: string;
    registration: {
      acquisitionCost: number;
      acquisitionDate: string;
      accumulatedDepreciation: number;
      depreciationStartDate: string;
    };
  }
): Promise<CommandResult<{ id: string; status: "Active" }>> {
  const { fixedAssetId, registration, companyId, companyGroupId, userId } =
    args;

  const companySettings = await getCompanySettings(client, companyId);
  if (companySettings.error) {
    return commandError(
      "Failed to load company settings",
      companySettings.error
    );
  }
  const accountingEnabled =
    (companySettings.data as { accountingEnabled?: boolean } | null)
      ?.accountingEnabled ?? false;

  // With accounting on, capitalize the asset with a real GL entry
  // (Dr asset / Cr owner equity) rather than a bare status flip, so no
  // capitalized asset exists without a journal.
  if (accountingEnabled) {
    const [asset, defaults, dimensions, accountingPeriod] = await Promise.all([
      client
        .from("fixedAsset")
        .select(
          "fixedAssetId, locationId, fixedAssetClassId, fixedAssetClass:fixedAssetClassId(assetAccountId, accumulatedDepreciationAccountId)"
        )
        .eq("id", fixedAssetId)
        .eq("companyId", companyId)
        .single(),
      getDefaultAccounts(client, companyId),
      getActiveDimensionIds(client, companyGroupId),
      getOrCreateAccountingPeriod(
        client,
        companyId,
        registration.acquisitionDate,
        "accounting"
      )
    ]);

    if (asset.error || !asset.data) {
      return commandError("Failed to get fixed asset", asset.error);
    }
    if (accountingPeriod.error || !accountingPeriod.data) {
      return commandError(
        "Failed to get accounting period",
        accountingPeriod.error
      );
    }
    if (dimensions.error) {
      return commandError("Failed to resolve dimensions", dimensions.error);
    }

    const assetClass = asset.data.fixedAssetClass as {
      assetAccountId: string;
      accumulatedDepreciationAccountId: string;
    } | null;
    const assetAccountId = assetClass?.assetAccountId;
    const accumulatedDepreciationAccountId =
      assetClass?.accumulatedDepreciationAccountId;
    const offsetAccountId = defaults.data?.retainedEarningsAccount;

    if (
      !assetAccountId ||
      !accumulatedDepreciationAccountId ||
      !offsetAccountId
    ) {
      return commandError(
        "Missing GL accounts for asset registration. Configure the asset class and default accounts.",
        defaults.error
      );
    }

    const { locationDimensionId, assetClassDimensionId } = dimensions;
    if (!locationDimensionId || !assetClassDimensionId) {
      return commandError("Missing dimensions required for asset registration");
    }

    try {
      await postAssetRegistration(db, {
        fixedAssetId,
        fixedAssetReadableId: asset.data.fixedAssetId,
        registration,
        locationId: asset.data.locationId,
        fixedAssetClassId: asset.data.fixedAssetClassId,
        assetAccountId,
        accumulatedDepreciationAccountId,
        offsetAccountId,
        accountingPeriodId: accountingPeriod.data,
        locationDimensionId,
        assetClassDimensionId,
        companyId,
        userId
      });
    } catch (err) {
      return commandError("Failed to register asset", err);
    }

    return commandOk({ id: fixedAssetId, status: "Active" as const });
  }

  // Accounting disabled — a plain status flip (no journal). Select the affected
  // row back so a concurrent update that already moved the asset out of Draft
  // (zero rows matched) is treated as a failure rather than a false success.
  const result = await client
    .from("fixedAsset")
    .update({
      ...registration,
      status: "Active",
      updatedBy: userId
    })
    .eq("id", fixedAssetId)
    .eq("companyId", companyId)
    .eq("status", "Draft")
    .select("id");

  if (result.error) {
    return commandError("Failed to register asset", result.error);
  }
  if (!result.data || result.data.length === 0) {
    return commandError("Only Draft assets can be registered");
  }

  return commandOk({ id: fixedAssetId, status: "Active" as const });
}

/**
 * Scrap an Active or Fully Depreciated fixed asset (→ Disposed): posts the
 * disposal journal, writes the `fixedAssetDisposal` row and flips the status in
 * one transaction (`postDisposal`, method "Scrapping"). Body of
 * `x+/fixed-asset+/$fixedAssetId.dispose`, including the status rule its loader
 * enforces before the form opens.
 */
export async function disposeFixedAsset(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: FixedAssetCommandContext & {
    fixedAssetId: string;
    disposalDate: string;
  }
): Promise<CommandResult<{ id: string; status: "Disposed" }>> {
  const { fixedAssetId, disposalDate, companyId, companyGroupId, userId } =
    args;
  const disposalMethod = "Scrapping";

  const [asset, dimensions] = await Promise.all([
    client
      .from("fixedAsset")
      .select("*, fixedAssetClass:fixedAssetClassId(*)")
      .eq("id", fixedAssetId)
      .eq("companyId", companyId)
      .single(),
    getActiveDimensionIds(client, companyGroupId)
  ]);

  if (asset.error) {
    return commandError("Failed to get asset", asset.error);
  }

  if (
    asset.data.status !== "Active" &&
    asset.data.status !== "Fully Depreciated"
  ) {
    return commandError(
      "Only Active or Fully Depreciated assets can be disposed"
    );
  }

  const assetClass = asset.data.fixedAssetClass as {
    assetAccountId: string;
    accumulatedDepreciationAccountId: string;
    lossOnDisposalAccountId: string;
  };

  const accountingPeriod = await getOrCreateAccountingPeriod(
    client,
    companyId,
    disposalDate,
    "accounting"
  );
  if (accountingPeriod.error) {
    return commandError(
      "Failed to get accounting period",
      accountingPeriod.error
    );
  }

  try {
    await postDisposal(db, {
      fixedAssetId,
      fixedAssetReadableId: asset.data.fixedAssetId,
      disposalDate,
      disposalMethod,
      acquisitionCost: Number(asset.data.acquisitionCost),
      accumulatedDepreciation: Number(asset.data.accumulatedDepreciation),
      locationId: asset.data.locationId,
      fixedAssetClassId: asset.data.fixedAssetClassId,
      assetAccountId: assetClass.assetAccountId,
      accumulatedDepreciationAccountId:
        assetClass.accumulatedDepreciationAccountId,
      lossOnDisposalAccountId: assetClass.lossOnDisposalAccountId,
      accountingPeriodId: accountingPeriod.data!,
      locationDimensionId: dimensions.locationDimensionId,
      assetClassDimensionId: dimensions.assetClassDimensionId,
      companyId,
      userId
    });
  } catch (err) {
    return commandError("Failed to post asset disposal", err);
  }

  return commandOk({ id: fixedAssetId, status: "Disposed" as const });
}

/**
 * Post a Draft depreciation run (→ Posted): one depreciation journal per line,
 * the asset's accumulated depreciation advanced (Fully Depreciated at
 * residual), and the deferred-tax entry when tax depreciation is enabled — all
 * in one transaction (`postDepreciationRunJournals`). Body of
 * `x+/depreciation-run+/$depreciationRunId.post`.
 */
export async function postDepreciationRun(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: FixedAssetCommandContext & { depreciationRunId: string }
): Promise<CommandResult<{ id: string; status: "Posted" }>> {
  const { depreciationRunId, companyId, companyGroupId, userId } = args;

  const run = await client
    .from("depreciationRun")
    .select("*")
    .eq("id", depreciationRunId)
    .eq("companyId", companyId)
    .single();

  if (run.error || run.data.status !== "Draft") {
    return commandError("Run is not in Draft status", run.error);
  }

  const [companySettingsResult, accountDefaultsResult] = await Promise.all([
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

  const taxSettings = companySettingsResult.data as {
    assetTaxDepreciationEnabled?: boolean | null;
    assetTaxRate?: number | null;
  } | null;
  const taxEnabled = taxSettings?.assetTaxDepreciationEnabled ?? false;
  const taxRate = taxSettings?.assetTaxRate
    ? Number(taxSettings.assetTaxRate)
    : null;
  const taxAccounts = accountDefaultsResult.data as {
    deferredTaxLiabilityAccountId?: string | null;
    deferredTaxExpenseAccountId?: string | null;
  } | null;
  const dtlAccountId = taxAccounts?.deferredTaxLiabilityAccountId ?? null;
  const dtExpenseAccountId = taxAccounts?.deferredTaxExpenseAccountId ?? null;

  const [linesResult, dimensions] = await Promise.all([
    client
      .from("depreciationRunLine")
      .select(
        "id, fixedAssetId, amount, taxAmount, fixedAsset:fixedAssetId(id, fixedAssetId, locationId, fixedAssetClassId, acquisitionCost, accumulatedDepreciation, accumulatedTaxDepreciation, residualValuePercent, usefulLifeMonths, fixedAssetClass:fixedAssetClassId(depreciationExpenseAccountId, accumulatedDepreciationAccountId))"
      )
      .eq("depreciationRunId", depreciationRunId),
    getActiveDimensionIds(client, companyGroupId)
  ]);

  if (linesResult.error) {
    return commandError("Failed to fetch run lines", linesResult.error);
  }

  const postingDate = run.data.periodEnd;

  const accountingPeriod = await getOrCreateAccountingPeriod(
    client,
    companyId,
    postingDate,
    "accounting"
  );
  if (accountingPeriod.error) {
    return commandError(
      "Failed to get accounting period",
      accountingPeriod.error
    );
  }

  type RunLineAsset = {
    fixedAssetId: string;
    locationId: string | null;
    fixedAssetClassId: string;
    acquisitionCost: number;
    accumulatedDepreciation: number;
    accumulatedTaxDepreciation: number | null;
    residualValuePercent: number;
    fixedAssetClass: {
      depreciationExpenseAccountId: string | null;
      accumulatedDepreciationAccountId: string | null;
    } | null;
  } | null;

  // Validate all lines have required account configuration
  for (const line of linesResult.data) {
    const asset = line.fixedAsset as unknown as RunLineAsset;
    const assetClass = asset?.fixedAssetClass;
    if (
      !assetClass?.depreciationExpenseAccountId ||
      !assetClass?.accumulatedDepreciationAccountId
    ) {
      return commandError(
        `Asset ${asset?.fixedAssetId ?? line.fixedAssetId} is missing depreciation account configuration`
      );
    }
  }

  const lines = linesResult.data.map((line) => {
    const asset = line.fixedAsset as unknown as NonNullable<RunLineAsset>;
    const assetClass = asset.fixedAssetClass!;
    return {
      id: line.id,
      fixedAssetId: line.fixedAssetId,
      amount: Number(line.amount),
      taxAmount: Number(line.taxAmount ?? 0),
      asset: {
        fixedAssetId: asset.fixedAssetId,
        locationId: asset.locationId,
        fixedAssetClassId: asset.fixedAssetClassId,
        acquisitionCost: Number(asset.acquisitionCost),
        accumulatedDepreciation: Number(asset.accumulatedDepreciation),
        accumulatedTaxDepreciation: Number(
          asset.accumulatedTaxDepreciation ?? 0
        ),
        residualValuePercent: Number(asset.residualValuePercent),
        depreciationExpenseAccountId: assetClass.depreciationExpenseAccountId!,
        accumulatedDepreciationAccountId:
          assetClass.accumulatedDepreciationAccountId!
      }
    };
  });

  try {
    await postDepreciationRunJournals(db, {
      depreciationRunId,
      depreciationRunReadableId: run.data.depreciationRunId,
      postingDate,
      accountingPeriodId: accountingPeriod.data!,
      lines,
      locationDimensionId: dimensions.locationDimensionId,
      assetClassDimensionId: dimensions.assetClassDimensionId,
      taxEnabled,
      taxRate,
      dtlAccountId,
      dtExpenseAccountId,
      companyId,
      userId
    });
  } catch (err) {
    return commandError("Failed to post depreciation run", err);
  }

  return commandOk({ id: depreciationRunId, status: "Posted" as const });
}

/**
 * Create the next period's Draft depreciation run: the period after the latest
 * run (posted or draft), refused when a run already exists for it, with one
 * line per Active asset computed by `buildDepreciationLines` against the last
 * POSTED run and the period's usage logs. Body of
 * `x+/accounting+/depreciation-runs.new`. Client writes only (RLS-bound).
 */
export async function createDepreciationRun(
  client: SupabaseClient<Database>,
  args: FixedAssetCommandContext
): Promise<CommandResult<{ id: string; depreciationRunId: string }>> {
  const { companyId, companyGroupId, userId } = args;

  // Find the last run (posted or draft) to determine the next period
  const lastRun = await client
    .from("depreciationRun")
    .select("periodEnd, status")
    .eq("companyId", companyId)
    .order("periodEnd", { ascending: false })
    .limit(1);

  const lastPeriodEnd =
    lastRun.data && lastRun.data.length > 0 ? lastRun.data[0].periodEnd : null;

  const periodEnd = getNextPeriodEnd(lastPeriodEnd);

  // Check for existing run at this period
  const existing = await client
    .from("depreciationRun")
    .select("id")
    .eq("periodEnd", periodEnd)
    .eq("companyId", companyId);

  if (existing.data && existing.data.length > 0) {
    return commandError("A depreciation run already exists for this period");
  }

  const companySettings = await client
    .from("companySettings")
    .select("assetTaxDepreciationEnabled")
    .eq("id", companyId)
    .single();

  const taxEnabled =
    (
      companySettings.data as {
        assetTaxDepreciationEnabled?: boolean | null;
      } | null
    )?.assetTaxDepreciationEnabled ?? false;

  const assets = await client
    .from("fixedAsset")
    .select("*")
    .eq("companyId", companyId)
    .eq("status", "Active");

  if (assets.error) {
    return commandError("Failed to fetch assets", assets.error);
  }

  // For depreciation calculation, use last *posted* run
  const lastPostedRun = await client
    .from("depreciationRun")
    .select("periodEnd")
    .eq("companyId", companyId)
    .eq("status", "Posted")
    .order("periodEnd", { ascending: false })
    .limit(1);

  const lastPostedPeriodEnd =
    lastPostedRun.data && lastPostedRun.data.length > 0
      ? lastPostedRun.data[0].periodEnd
      : null;

  const usageLogs = await client
    .from("fixedAssetUsageLog")
    .select("fixedAssetId, unitsProduced")
    .eq("periodEnd", periodEnd);

  const usageMap = new Map(
    (usageLogs.data ?? []).map((u) => [u.fixedAssetId, u])
  );

  const lines = buildDepreciationLines(
    (assets.data ?? []).map((a) => ({
      ...a,
      accumulatedTaxDepreciation: Number(a.accumulatedTaxDepreciation ?? 0),
      taxDepreciationMethod: a.taxDepreciationMethod ?? null,
      taxUsefulLifeMonths: a.taxUsefulLifeMonths ?? null,
      taxResidualValuePercent: a.taxResidualValuePercent ?? null,
      macrsPropertyClass: a.macrsPropertyClass ?? null,
      macrsConvention: a.macrsConvention ?? null,
      bonusDepreciationPercent: a.bonusDepreciationPercent ?? null
    })),
    periodEnd,
    lastPostedPeriodEnd,
    taxEnabled,
    usageMap,
    await getBaseCurrencyDecimalPlaces(client, companyId, companyGroupId)
  );

  const result = await insertDepreciationRun(client, {
    periodEnd,
    lines,
    companyId,
    createdBy: userId
  });

  if (result.error || !result.data) {
    return commandError("Failed to create depreciation run", result.error);
  }

  return commandOk(result.data);
}
