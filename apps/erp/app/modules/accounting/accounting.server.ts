import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";
import { toStoredAmount } from "@carbon/utils";
import { interpolateSequenceDate } from "~/utils/string";

async function getNextSequence(
  trx: KyselyTx,
  tableName: string,
  companyId: string
) {
  const sequence = await trx
    .selectFrom("sequence")
    .selectAll()
    .where("table", "=", tableName)
    .where("companyId", "=", companyId)
    .executeTakeFirstOrThrow();

  const { prefix, suffix, next, size, step } = sequence;
  if (!Number.isInteger(next)) throw new Error("Next is not an integer");
  if (!Number.isInteger(step)) throw new Error("Step is not an integer");
  if (!Number.isInteger(size)) throw new Error("Size is not an integer");

  const nextValue = next! + step!;
  const nextSequence = nextValue.toString().padStart(size!, "0");
  const derivedPrefix = interpolateSequenceDate(prefix);
  const derivedSuffix = interpolateSequenceDate(suffix);

  await trx
    .updateTable("sequence")
    .set({ next: nextValue, updatedBy: "system" })
    .where("table", "=", tableName)
    .where("companyId", "=", companyId)
    .execute();

  return `${derivedPrefix}${nextSequence}${derivedSuffix}`;
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
    writeOffAccountId: string;
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
    writeOffAccountId,
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
      journalLines.push({
        journalId: journal.id,
        accountId: writeOffAccountId,
        description: "Write-off remaining book value",
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
      .execute();
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
