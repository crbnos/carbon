import { insertId, insertRow, maybeOne, nextSequence, rows } from "../sql.ts";
import type { Ctx } from "../types.ts";

// Every fixed asset status the UI branches on, so the docs screenshots aren't
// dead ends: Draft is the ONLY status /x/fixed-asset/:id/register accepts
// (the loader redirects away otherwise), and the Sell modal requires Active or
// Fully Depreciated.
type FixedAssetSpec = {
  key: string;
  className: string;
  location: "Plant" | "HQ";
  name: string;
  description: string;
  serialNumber: string;
  status: "Draft" | "Active" | "Fully Depreciated";
  depreciationMethod: "Straight Line" | "Declining Balance";
  usefulLifeMonths: number;
  // Whole percent — the app reads residual as cost * (percent / 100).
  residualValuePercent: number;
  acquisitionCost: number;
  acquisitionDate: string | null;
  depreciationStartDate: string | null;
  accumulatedDepreciation: number;
  // The straight-line charge buildDepreciationLines() computes for
  // DEPRECIATION_PERIOD_END with no prior posted run:
  // (cost - residual) / usefulLifeMonths * months since depreciationStartDate.
  // Omit to leave the asset out of the seeded run.
  depreciationCharge?: number;
};

// One month behind the current period, so "New Depreciation Run" still has a
// period left to create (getNextPeriodEnd rolls this forward to 2026-08-31).
const DEPRECIATION_PERIOD_END = "2026-07-31";

const FIXED_ASSETS: FixedAssetSpec[] = [
  {
    key: "hvac",
    className: "Buildings",
    location: "Plant",
    name: "Clean Room HVAC System",
    description: "ISO Class 7 clean room air handling and filtration plant",
    serialNumber: "HVAC-CR7-88421",
    status: "Active",
    depreciationMethod: "Straight Line",
    usefulLifeMonths: 120,
    residualValuePercent: 5,
    acquisitionCost: 85000,
    acquisitionDate: "2024-01-15",
    depreciationStartDate: "2024-02-15",
    accumulatedDepreciation: 0,
    // 80,750 / 120 = 672.92 per month x 30 months (2024-02-15 → 2026-07-31)
    depreciationCharge: 20187.5
  },
  {
    key: "cmm",
    className: "Machinery & Equipment",
    location: "Plant",
    name: "Coordinate Measuring Machine",
    description: "Bridge-type CMM used for first article inspection",
    serialNumber: "CMM-BR12-00317",
    status: "Active",
    depreciationMethod: "Straight Line",
    usefulLifeMonths: 120,
    residualValuePercent: 5,
    acquisitionCost: 240000,
    acquisitionDate: "2025-03-10",
    depreciationStartDate: "2025-04-15",
    accumulatedDepreciation: 0,
    // 228,000 / 120 = 1,900 per month x 16 months (2025-04-15 → 2026-07-31)
    depreciationCharge: 30400
  },
  {
    key: "cnc",
    className: "Machinery & Equipment",
    location: "Plant",
    name: "5-Axis CNC Machining Center",
    description: "Awaiting registration — acquisition cost booked on register",
    serialNumber: "CNC-5X-72094",
    status: "Draft",
    depreciationMethod: "Straight Line",
    usefulLifeMonths: 120,
    residualValuePercent: 5,
    // A Draft asset has not been capitalized yet: the register drawer is what
    // supplies cost, acquisition date and depreciation start date.
    acquisitionCost: 0,
    acquisitionDate: null,
    depreciationStartDate: null,
    accumulatedDepreciation: 0
  },
  {
    key: "van",
    className: "Vehicles",
    location: "HQ",
    name: "Delivery Van",
    description: "Cargo van for local supplier pickups",
    serialNumber: "VIN-1FTBW2CM7KKA10293",
    status: "Fully Depreciated",
    depreciationMethod: "Straight Line",
    usefulLifeMonths: 60,
    residualValuePercent: 0,
    acquisitionCost: 48000,
    acquisitionDate: "2019-06-14",
    depreciationStartDate: "2019-07-15",
    accumulatedDepreciation: 48000
  }
];

export async function runTier9(ctx: Ctx): Promise<void> {
  const { client, companyId } = ctx;

  // Grab any GL account to post against — just need something that exists
  const acctAR = await maybeOne<{ id: string }>(
    client,
    `SELECT id FROM account WHERE class = 'Asset' LIMIT 1`,
    []
  );
  const acctSales = await maybeOne<{ id: string }>(
    client,
    `SELECT id FROM account WHERE class = 'Revenue' LIMIT 1`,
    []
  );

  if (!acctAR || !acctSales) {
    ctx.log("no GL accounts found — skipping journal entry");
  } else {
    // journal is preserved across wipes — skip if already seeded
    const existing = await maybeOne<{ id: string }>(
      client,
      `SELECT id FROM journal WHERE "journalEntryId" = $1 AND "companyId" = $2`,
      ["JE-SEED-001", companyId]
    );
    if (existing) {
      ctx.log("journal entry — already exists, skipping");
      ctx.refs.documents["journal:revenue"] = existing.id;
    } else {
      ctx.log("journal entry — revenue recognition");
      const je = await insertId(ctx, "journal", {
        journalEntryId: "JE-SEED-001",
        description: "Revenue recognition — ORBSEC partial delivery",
        status: "Draft",
        postingDate: "2025-11-30"
      });
      await insertId(ctx, "journalLine", {
        journalId: je,
        accountId: acctAR.id,
        description: "ORBSEC contract milestone",
        amount: 1800000,
        quantity: 1,
        journalLineReference: "JE-SEED-001"
      });
      await insertId(ctx, "journalLine", {
        journalId: je,
        accountId: acctSales.id,
        description: "ORBSEC contract milestone",
        amount: -1800000,
        quantity: 1,
        journalLineReference: "JE-SEED-001"
      });
      ctx.refs.documents["journal:revenue"] = je;
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

  for (const spec of FIXED_ASSETS) {
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
      acquisitionDate: spec.acquisitionDate,
      depreciationStartDate: spec.depreciationStartDate,
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
      periodEnd: DEPRECIATION_PERIOD_END,
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
