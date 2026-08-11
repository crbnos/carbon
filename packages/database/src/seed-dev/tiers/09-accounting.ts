import { insertId, maybeOne, nextSequence } from "../sql.ts";
import type { Ctx } from "../types.ts";

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

  // ── Fixed asset: clean room HVAC ─────────────────────────────────────────
  ctx.log("fixed asset — clean room HVAC");
  const faClass = await maybeOne<{ id: string }>(
    client,
    `SELECT id FROM "fixedAssetClass" WHERE "companyId" = $1 LIMIT 1`,
    [companyId]
  );
  if (faClass) {
    const faId = await nextSequence(ctx, "fixedAsset");
    const fa = await insertId(ctx, "fixedAsset", {
      fixedAssetId: faId,
      fixedAssetClassId: faClass.id,
      name: "Clean Room HVAC System",
      status: "Active",
      depreciationMethod: "Straight Line",
      usefulLifeMonths: 120,
      residualValuePercent: 0.05,
      acquisitionCost: 85000,
      acquisitionDate: "2024-01-15"
    });
    ctx.refs.documents["fixedAsset:hvac"] = fa;
  }
}
