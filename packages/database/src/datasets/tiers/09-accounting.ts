import { previousMonthEnd, resolveDate } from "../dates.ts";
import { insertId, insertRow, maybeOne, nextSequence, rows } from "../sql.ts";
import type { Ctx } from "../types.ts";

export async function runTier9(ctx: Ctx): Promise<void> {
  const { client, companyId, companyGroupId } = ctx;
  const data = ctx.dataset.accounting;

  // account is scoped by companyGroupId, not companyId. The client bypasses RLS,
  // so an unscoped pick would post this company's lines to another tenant's account.
  const acctAR = await maybeOne<{ id: string }>(
    client,
    `SELECT id FROM account WHERE class = 'Asset' AND "companyGroupId" = $1 ORDER BY number LIMIT 1`,
    [companyGroupId]
  );
  const acctSales = await maybeOne<{ id: string }>(
    client,
    `SELECT id FROM account WHERE class = 'Revenue' AND "companyGroupId" = $1 ORDER BY number LIMIT 1`,
    [companyGroupId]
  );

  if (!acctAR || !acctSales) {
    ctx.log("no GL accounts found — skipping journal entry");
  } else {
    const accountIdByClass = { Asset: acctAR.id, Revenue: acctSales.id };
    for (const entry of data.journalEntries) {
      // journal is preserved across wipes — skip if already seeded
      const existing = await maybeOne<{ id: string }>(
        client,
        `SELECT id FROM journal WHERE "journalEntryId" = $1 AND "companyId" = $2`,
        [entry.journalEntryId, companyId]
      );
      if (existing) {
        ctx.log("journal entry — already exists, skipping");
        ctx.refs.documents[entry.ref] = existing.id;
      } else {
        ctx.log("journal entry — revenue recognition");
        const je = await insertId(ctx, "journal", {
          journalEntryId: entry.journalEntryId,
          description: entry.description,
          status: entry.status,
          postingDate: resolveDate(ctx.anchor, entry.postingOffset)
        });
        for (const line of entry.lines) {
          await insertId(ctx, "journalLine", {
            journalId: je,
            accountId: accountIdByClass[line.accountClass],
            description: line.description,
            amount: line.amount,
            quantity: line.quantity,
            journalLineReference: line.journalLineReference
          });
        }
        ctx.refs.documents[entry.ref] = je;
      }
    }
  }

  // ── Fixed assets ─────────────────────────────────────────────────────────
  // fixedAssetClass is in PRESERVED_TABLES — bootstrap seeds the three classes,
  // so look them up by name rather than inserting.
  const faClasses = await rows<{ id: string; name: string }>(
    client,
    `SELECT id, name FROM "fixedAssetClass" WHERE "companyId" = $1`,
    [companyId]
  );
  const faClassByName = new Map(faClasses.map((c) => [c.name, c.id]));
  const fallbackClassId = faClasses[0]?.id;

  const runLines: { fixedAssetId: string; amount: number }[] = [];

  for (const spec of data.fixedAssets) {
    const fixedAssetClassId =
      faClassByName.get(spec.className) ?? fallbackClassId;
    if (!fixedAssetClassId) {
      ctx.log(`fixed asset ${spec.name} — no fixedAssetClass, skipping`);
      continue;
    }
    ctx.log(`fixed asset ${spec.name} — ${spec.status}`);
    const fixedAssetId = await nextSequence(ctx, "fixedAsset");
    const fa = await insertId(ctx, "fixedAsset", {
      fixedAssetId,
      fixedAssetClassId,
      locationId: ctx.refs.locations[spec.location] ?? ctx.locationId,
      name: spec.name,
      description: spec.description,
      serialNumber: spec.serialNumber,
      status: spec.status,
      depreciationMethod: spec.depreciationMethod,
      usefulLifeMonths: spec.usefulLifeMonths,
      residualValuePercent: spec.residualValuePercent,
      acquisitionCost: spec.acquisitionCost,
      acquisitionDate:
        spec.acquisitionOffset === null
          ? null
          : resolveDate(ctx.anchor, spec.acquisitionOffset),
      depreciationStartDate:
        spec.depreciationStartOffset === null
          ? null
          : resolveDate(ctx.anchor, spec.depreciationStartOffset),
      accumulatedDepreciation: spec.accumulatedDepreciation
    });
    ctx.refs.documents[`fixedAsset:${spec.key}`] = fa;
    if (spec.depreciationCharge) {
      runLines.push({ fixedAssetId: fa, amount: spec.depreciationCharge });
    }
  }

  // ── Depreciation run: unposted, one line per Active asset ────────────────
  // Mirrors what accounting+/depreciation-runs.new.tsx builds. taxAmount stays
  // NULL because companySettings.assetTaxDepreciationEnabled is off, which is
  // also what buildDepreciationLines() produces in that case.
  if (runLines.length > 0) {
    ctx.log("depreciation run — Draft");
    const depreciationRunId = await nextSequence(ctx, "depreciationRun");
    const run = await insertId(ctx, "depreciationRun", {
      depreciationRunId,
      // One month behind the current period, so "New Depreciation Run" still
      // has a period left to create (getNextPeriodEnd rolls this forward).
      periodEnd: previousMonthEnd(ctx.anchor),
      status: "Draft"
    });
    for (const line of runLines) {
      await insertRow(ctx, "depreciationRunLine", {
        depreciationRunId: run,
        fixedAssetId: line.fixedAssetId,
        amount: line.amount
      });
    }
    ctx.refs.documents["depreciationRun:draft"] = run;
  }
}
