/**
 * Change Orders seed script for Carbon
 *
 * Populates rich, re-runnable test data for the Change Orders (ECO) feature:
 * a bike-manufacturer catalog (parts, make methods with BOM + BOP), downstream
 * documents (open PO, in-progress job, sales order), an NCR, and seven change
 * orders spanning every stage of the flow (Draft → Start → Engineering
 * Complete → Implementation → Done).
 *
 * The change-content follows the v2 model: each CO selects affected items first
 * (changeOrderAffectedItem, with a per-item `changeType`), and each item's edits
 * live on a REAL CO-owned Draft `makeMethod` (`makeMethod.changeOrderId` set),
 * NOT in staging tables. Three change types are exercised:
 *   - Version  → a new Draft method version on the SAME item (copied from the
 *                Active method, then edited). ECO-000001 is the worked example: it
 *                swaps bracket PRT-001186.A → PRT-001186.B across four assemblies
 *                (delete the bracketA BOM line on the draft + add bracketB) and
 *                declares one manual changeOrderSupersession (bracketA → bracketB).
 *   - Revision → a new inactive revision item (active:false, changeOrderId set)
 *                with the method copied into its Draft (ECO-000004, SA-0065).
 *   - New Part → a new inactive part number (new readableId) with the method
 *                copied into its Draft (ECO-000004, derived from GA-0044).
 *
 * The pg connection needs SUPABASE_DB_URL, which lives in the repo-root
 * `.env.local` (not `.env`). Both are loaded below.
 *
 * Usage:
 *   set -a; . ./.env.local; set +a
 *   pnpm --filter @carbon/database seed:change-orders -- --company <companyId>
 *   pnpm --filter @carbon/database seed:change-orders -- --email <email>
 *
 * Idempotency: at the start of the transaction the script deletes its own prior
 * seed for the company (by the exact readableIds / names it owns), so re-running
 * is clean and never touches unrelated data.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import * as dotenv from "dotenv";
import type { PoolClient } from "pg";
import { getPostgresConnectionPool } from "./client.ts";

// ---------------------------------------------------------------------------
// Environment — SUPABASE_DB_URL is in the repo-root .env.local (not .env).
// ---------------------------------------------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// src/ -> packages/database/ -> packages/ -> repo root
const repoRoot = path.resolve(__dirname, "..", "..", "..");
dotenv.config();
for (const envPath of [
  path.join(repoRoot, ".env"),
  path.join(repoRoot, ".env.local")
]) {
  if (existsSync(envPath)) {
    dotenv.config({ path: envPath, override: true });
  }
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    company: { type: "string", short: "c" },
    email: { type: "string", short: "e" }
  },
  strict: true
});

// ---------------------------------------------------------------------------
// Constants — the exact identifiers this script owns (used for delete-first).
// ---------------------------------------------------------------------------
const RICH = (text: string) =>
  JSON.stringify({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }]
  });

// Purchased (Buy) parts — PRT-001186 appears twice (rev 0 = ".A", rev B = ".B").
const PURCHASED_PARTS = [
  { readableId: "PRT-001186", revision: "0", name: "Rear Dropout Bracket" },
  { readableId: "PRT-001186", revision: "B", name: "Rear Dropout Bracket v2" },
  { readableId: "FST-100", revision: "0", name: "M5 Bolt" },
  { readableId: "FST-101", revision: "0", name: "Alignment Dowel" },
  { readableId: "FST-102", revision: "0", name: "Locking Washer" },
  { readableId: "BRG-200", revision: "0", name: "Sealed Bearing" },
  { readableId: "CBL-300", revision: "0", name: "Cable Housing" }
] as const;

// Make parts — each gets an Active makeMethod with a BOM + BOP.
const MAKE_PARTS = [
  { readableId: "GA-0020", name: "Pedal4 Sync3 Stage 2" },
  { readableId: "GA-0022", name: "Pedal4 Sync3 Stage 3" },
  { readableId: "GA-0044", name: "Pedal4 Sync3 Stage 2 Alt" },
  { readableId: "SA-0065", name: "Pedal2 Sync3" },
  { readableId: "VEH0000001", name: "Pedal4 Sync3" },
  { readableId: "VEH000006", name: "Pedal2 Sync2" }
] as const;

// New-Part readableIds this seed mints (v2 New Part change type). Deterministic
// so delete-first cleanup can find them. (Revision new items reuse a seeded
// readableId with a bumped revision, so they're cleaned by the item delete.)
const NEW_PART_IDS = ["PRT-CO-NP1"];

const ALL_SEEDED_ITEM_IDS = [
  ...PURCHASED_PARTS.map((p) => p.readableId),
  ...MAKE_PARTS.map((p) => p.readableId),
  ...NEW_PART_IDS
];

const PROCESS_NAMES = ["Machining", "Welding", "Assembly", "Inspection"];
const WORK_CENTER_NAMES = [
  "CNC Mill",
  "Weld Cell",
  "Assembly Line 1",
  "QC Bench"
];
const SUPPLIER_NAMES = ["FastenerCo", "BracketWorks"];
const CUSTOMER_NAMES = ["VeloRetail", "CityBikes"];

const PO_ID = "PO-CO-001";
const JOB_ID = "J-CO-001";
const SO_ID = "SO-CO-001";
const NCR_ID = "NCR-CO-001";
const CHANGE_ORDER_IDS = [
  "ECO-000001",
  "ECO-000002",
  "ECO-000003",
  "ECO-000004",
  "ECO-000005",
  "ECO-000006",
  "ECO-000007"
];

// ---------------------------------------------------------------------------
// Company / context resolution
// ---------------------------------------------------------------------------
async function resolveContext(client: PoolClient) {
  let companyId = values.company;

  if (!companyId && values.email) {
    const res = await client.query(
      `SELECT utc."companyId"
       FROM "userToCompany" utc
       JOIN "user" u ON u.id = utc."userId"
       WHERE u.email = $1
       LIMIT 1`,
      [values.email]
    );
    if (res.rows.length === 0) {
      throw new Error(`No company found for email ${values.email}`);
    }
    companyId = res.rows[0].companyId;
  }

  if (!companyId) {
    // Fall back to the single non-system company if exactly one exists.
    const res = await client.query(
      `SELECT id FROM company WHERE id NOT IN ('system')`
    );
    if (res.rows.length === 1) {
      companyId = res.rows[0].id;
    } else {
      throw new Error(
        `Could not resolve company: pass --company <id> or --email <email> ` +
          `(found ${res.rows.length} companies).`
      );
    }
  }

  const companyRes = await client.query(
    `SELECT id, name FROM company WHERE id = $1`,
    [companyId]
  );
  if (companyRes.rows.length === 0) {
    throw new Error(`Company ${companyId} not found`);
  }
  const companyName = companyRes.rows[0].name as string;

  const userRes = await client.query(
    `SELECT "userId" FROM "userToCompany" WHERE "companyId" = $1 AND role = 'employee' LIMIT 1`,
    [companyId]
  );
  if (userRes.rows.length === 0) {
    throw new Error(`No employee user found for company ${companyId}`);
  }
  const userId = userRes.rows[0].userId as string;

  const locRes = await client.query(
    `SELECT id FROM location WHERE "companyId" = $1 LIMIT 1`,
    [companyId]
  );
  if (locRes.rows.length === 0) {
    throw new Error(`No location found for company ${companyId}`);
  }
  const locationId = locRes.rows[0].id as string;

  const nctRes = await client.query(
    `SELECT id FROM "nonConformanceType" WHERE "companyId" = $1 LIMIT 1`,
    [companyId]
  );
  if (nctRes.rows.length === 0) {
    throw new Error(`No nonConformanceType found for company ${companyId}`);
  }
  const nonConformanceTypeId = nctRes.rows[0].id as string;

  // Ensure UoM 'EA' exists (it should for any seeded company).
  const uomRes = await client.query(
    `SELECT code FROM "unitOfMeasure" WHERE "companyId" = $1 AND code = 'EA'`,
    [companyId]
  );
  if (uomRes.rows.length === 0) {
    throw new Error(`UoM 'EA' not found for company ${companyId}`);
  }

  return {
    companyId: companyId as string,
    companyName,
    userId,
    locationId,
    nonConformanceTypeId
  };
}

// Strict lookup: records are keyed by ids we just inserted, so a miss is a seed
// bug, not a runtime "maybe". Returns a definite value (satisfies
// noUncheckedIndexedAccess) and throws with the offending key otherwise.
function need<T>(rec: Record<string, T>, key: string): T {
  const v = rec[key];
  if (v === undefined) throw new Error(`Seed: missing "${key}"`);
  return v;
}

// ---------------------------------------------------------------------------
// Idempotency — delete this script's prior seed in FK-safe order.
// ---------------------------------------------------------------------------
async function deletePriorSeed(client: PoolClient, companyId: string) {
  // 0. v2: CO-owned drafts are SET NULL (not cascaded) when the CO is deleted, so
  //    remove them WHILE the COs still exist. Delete CO-created items (Revision /
  //    New Part, item.changeOrderId set) first — cascades their makeMethods — then
  //    the Version draft methods (changeOrderId set) on existing items.
  const coSubquery = `SELECT id FROM "changeOrder" WHERE "companyId" = $1 AND "changeOrderId" = ANY($2)`;
  await client.query(
    `DELETE FROM item WHERE "companyId" = $1 AND "changeOrderId" IN (${coSubquery})`,
    [companyId, CHANGE_ORDER_IDS]
  );
  await client.query(
    `DELETE FROM "makeMethod" WHERE "changeOrderId" IN (${coSubquery})`,
    [companyId, CHANGE_ORDER_IDS]
  );

  // 1. Change orders (children cascade via ON DELETE CASCADE).
  await client.query(
    `DELETE FROM "changeOrder" WHERE "companyId" = $1 AND "changeOrderId" = ANY($2)`,
    [companyId, CHANGE_ORDER_IDS]
  );

  // 2. Seeded documents referencing items (must go before items).
  await client.query(
    `DELETE FROM "purchaseOrder" WHERE "companyId" = $1 AND "purchaseOrderId" = $2`,
    [companyId, PO_ID]
  );
  await client.query(
    `DELETE FROM job WHERE "companyId" = $1 AND "jobId" = $2`,
    [companyId, JOB_ID]
  );
  await client.query(
    `DELETE FROM "salesOrder" WHERE "companyId" = $1 AND "salesOrderId" = $2`,
    [companyId, SO_ID]
  );

  // 3. Method rows for the seeded items' make methods, then the items.
  //    methodMaterial + methodOperation cascade off makeMethod, and makeMethod
  //    cascades off item — but delete children explicitly for robustness in
  //    case cascade rules differ.
  await client.query(
    `DELETE FROM "methodMaterial" mm
     USING "makeMethod" mk, item i
     WHERE mm."makeMethodId" = mk.id AND mk."itemId" = i.id
       AND i."companyId" = $1 AND i."readableId" = ANY($2)`,
    [companyId, ALL_SEEDED_ITEM_IDS]
  );
  await client.query(
    `DELETE FROM "methodOperation" mo
     USING "makeMethod" mk, item i
     WHERE mo."makeMethodId" = mk.id AND mk."itemId" = i.id
       AND i."companyId" = $1 AND i."readableId" = ANY($2)`,
    [companyId, ALL_SEEDED_ITEM_IDS]
  );
  // 3b. Any remaining methodMaterial referencing a seeded item as a COMPONENT
  //     (itemId), regardless of which method owns it — otherwise the item delete
  //     below violates methodMaterial_itemId_fkey.
  await client.query(
    `DELETE FROM "methodMaterial" mm
     USING item i
     WHERE mm."itemId" = i.id
       AND i."companyId" = $1 AND i."readableId" = ANY($2)`,
    [companyId, ALL_SEEDED_ITEM_IDS]
  );

  // 4. The seeded items (makeMethod + itemCost cascade off item). The `part`
  //    extension row is positional (part.id = readableId), not FK-cascaded —
  //    delete it explicitly.
  await client.query(
    `DELETE FROM item WHERE "companyId" = $1 AND "readableId" = ANY($2)`,
    [companyId, ALL_SEEDED_ITEM_IDS]
  );
  await client.query(
    `DELETE FROM part WHERE "companyId" = $1 AND id = ANY($2)`,
    [companyId, ALL_SEEDED_ITEM_IDS]
  );

  // 5. The seeded NCR.
  await client.query(
    `DELETE FROM "nonConformance" WHERE "companyId" = $1 AND "nonConformanceId" = $2`,
    [companyId, NCR_ID]
  );

  // 6. Seeded suppliers/customers/processes/work centers (by exact name).
  await client.query(
    `DELETE FROM supplier WHERE "companyId" = $1 AND name = ANY($2)`,
    [companyId, SUPPLIER_NAMES]
  );
  await client.query(
    `DELETE FROM customer WHERE "companyId" = $1 AND name = ANY($2)`,
    [companyId, CUSTOMER_NAMES]
  );
  await client.query(
    `DELETE FROM "workCenter" WHERE "companyId" = $1 AND name = ANY($2)`,
    [companyId, WORK_CENTER_NAMES]
  );
  await client.query(
    `DELETE FROM process WHERE "companyId" = $1 AND name = ANY($2)`,
    [companyId, PROCESS_NAMES]
  );
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
type Ctx = {
  client: PoolClient;
  companyId: string;
  userId: string;
  locationId: string;
};

async function createPurchasedItem(
  ctx: Ctx,
  def: { readableId: string; revision: string; name: string }
): Promise<string> {
  const { client, companyId, userId } = ctx;
  const res = await client.query(
    `INSERT INTO item (
      "readableId", revision, name, type, "replenishmentSystem",
      "defaultMethodType", "itemTrackingType", "unitOfMeasureCode",
      active, "companyId", "createdBy"
    ) VALUES ($1, $2, $3, 'Part', 'Buy', 'Purchase to Order', 'Inventory', 'EA', true, $4, $5)
    RETURNING id`,
    [def.readableId, def.revision, def.name, companyId, userId]
  );
  const itemId = res.rows[0].id as string;
  // NB: the item-insert interceptor already creates the itemCost / itemReplenishment
  // / makeMethod rows — do NOT insert itemCost here or the `parts` view fans out
  // (it joins itemCost, so a duplicate row doubles every part in the list).
  // The `part` extension row is what the Parts list/view joins on (part.id =
  // item.readableId, per revision). ON CONFLICT: multiple revisions share one
  // part row.
  await client.query(
    `INSERT INTO part (id, "companyId", "createdBy") VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [def.readableId, companyId, userId]
  );
  return itemId;
}

async function createMakeItem(
  ctx: Ctx,
  def: { readableId: string; name: string }
): Promise<{ itemId: string; makeMethodId: string }> {
  const { client, companyId, userId } = ctx;
  const res = await client.query(
    `INSERT INTO item (
      "readableId", name, type, "replenishmentSystem",
      "defaultMethodType", "itemTrackingType", "unitOfMeasureCode",
      active, "companyId", "createdBy"
    ) VALUES ($1, $2, 'Part', 'Make', 'Make to Order', 'Inventory', 'EA', true, $3, $4)
    RETURNING id`,
    [def.readableId, def.name, companyId, userId]
  );
  const itemId = res.rows[0].id as string;
  // itemCost is auto-created by the item-insert interceptor — do NOT duplicate
  // it (the `parts` view joins itemCost and would fan out). See createPurchasedItem.
  // `part` extension row (see createPurchasedItem) — required for the Parts view.
  await client.query(
    `INSERT INTO part (id, "companyId", "createdBy") VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [def.readableId, companyId, userId]
  );
  // The item insert auto-creates a Draft makeMethod via a DB interceptor.
  const mmRes = await client.query(
    `SELECT id FROM "makeMethod" WHERE "itemId" = $1 ORDER BY version LIMIT 1`,
    [itemId]
  );
  if (mmRes.rows.length === 0) {
    throw new Error(`No auto-created makeMethod for item ${def.readableId}`);
  }
  const makeMethodId = mmRes.rows[0].id as string;
  await client.query(
    `UPDATE "makeMethod" SET status = 'Active', "updatedBy" = $2 WHERE id = $1`,
    [makeMethodId, userId]
  );
  return { itemId, makeMethodId };
}

async function addBomLine(
  ctx: Ctx,
  makeMethodId: string,
  componentItemId: string,
  quantity: number,
  order: number
) {
  const { client, companyId, userId } = ctx;
  await client.query(
    `INSERT INTO "methodMaterial" (
      "makeMethodId", "methodType", "itemType", "itemId", quantity,
      "unitOfMeasureCode", "companyId", "createdBy", "order",
      "scrapQuantity", kit, "storageUnitIds", "sourcingType"
    ) VALUES ($1, 'Pull from Inventory', 'Part', $2, $3, 'EA', $4, $5, $6, 0, false, '{}', 'Specified')`,
    [makeMethodId, componentItemId, quantity, companyId, userId, order]
  );
}

async function addBopOperation(
  ctx: Ctx,
  makeMethodId: string,
  processId: string,
  workCenterId: string | null,
  description: string,
  order: number
) {
  const { client, companyId, userId } = ctx;
  await client.query(
    `INSERT INTO "methodOperation" (
      "makeMethodId", description, "companyId", "createdBy",
      "processId", "workCenterId", "order"
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      makeMethodId,
      description,
      companyId,
      userId,
      processId,
      workCenterId,
      order
    ]
  );
}

// ---------------------------------------------------------------------------
// Change-order builders
// ---------------------------------------------------------------------------
type ChangeOrderInput = {
  changeOrderId: string;
  name: string;
  status: string;
  changeOrderTypeId: string;
  assignee: string | null;
  reasonForChange?: string;
  description?: string;
  nonConformanceId?: string | null;
};

async function createChangeOrder(
  ctx: Ctx,
  input: ChangeOrderInput
): Promise<string> {
  const { client, companyId, userId } = ctx;
  const res = await client.query(
    `INSERT INTO "changeOrder" (
      "changeOrderId", name, "openDate", "createdBy", status, "companyId",
      type, "changeOrderTypeId", assignee,
      "reasonForChange", "description", "nonConformanceId"
    ) VALUES ($1, $2, $3, $4, $5, $6, 'Engineering', $7, $8, $9, $10, $11)
    RETURNING id`,
    [
      input.changeOrderId,
      input.name,
      "2026-07-09",
      userId,
      input.status,
      companyId,
      input.changeOrderTypeId,
      input.assignee,
      RICH(input.reasonForChange ?? "Reason for change to be documented."),
      RICH(input.description ?? "Description of change to be documented."),
      input.nonConformanceId ?? null
    ]
  );
  return res.rows[0].id as string;
}

// ---------------------------------------------------------------------------
// v2 change-content builders — CO-owned Draft make methods (no staging tables).
//
// Mirrors createChangeOrderDraftMethod (changeOrder.service.ts):
//   Version  → new Draft method version on the SAME item, copying the Active
//              method's BOM + BOP rows; changeOrderId stamped.
//   Revision → new inactive revision item (same readableId, bumped revision);
//              New Part → new inactive item with a new readableId. Both copy the
//              source method into the new item's (trigger-created) Draft method.
// The user then edits the Draft's real methodMaterial rows (delete/add lines).
// ---------------------------------------------------------------------------

// Copy an Active method's BOM + BOP rows onto a target Draft make method.
async function copyMethodRows(
  ctx: Ctx,
  sourceMakeMethodId: string,
  targetMakeMethodId: string
) {
  const { client } = ctx;
  await client.query(
    `INSERT INTO "methodMaterial" (
      "makeMethodId", "methodType", "itemType", "itemId", quantity,
      "unitOfMeasureCode", "companyId", "createdBy", "order",
      "scrapQuantity", kit, "storageUnitIds", "sourcingType", "materialMakeMethodId"
    )
    SELECT $1, "methodType", "itemType", "itemId", quantity,
      "unitOfMeasureCode", "companyId", "createdBy", "order",
      "scrapQuantity", kit, "storageUnitIds", "sourcingType", "materialMakeMethodId"
    FROM "methodMaterial" WHERE "makeMethodId" = $2`,
    [targetMakeMethodId, sourceMakeMethodId]
  );
  await client.query(
    `INSERT INTO "methodOperation" (
      "makeMethodId", description, "companyId", "createdBy",
      "processId", "workCenterId", "order", "operationOrder",
      "setupTime", "setupUnit", "laborTime", "laborUnit",
      "machineTime", "machineUnit", "workInstruction"
    )
    SELECT $1, description, "companyId", "createdBy",
      "processId", "workCenterId", "order", "operationOrder",
      "setupTime", "setupUnit", "laborTime", "laborUnit",
      "machineTime", "machineUnit", "workInstruction"
    FROM "methodOperation" WHERE "makeMethodId" = $2`,
    [targetMakeMethodId, sourceMakeMethodId]
  );
}

// Version: new Draft method version on the SAME item, copying the Active method.
async function createDraftVersionMethod(
  ctx: Ctx,
  changeOrderId: string,
  activeMakeMethodId: string,
  targetItemId: string
): Promise<string> {
  const { client, userId } = ctx;
  const vRes = await client.query(
    `SELECT COALESCE(MAX(version), 0) + 1 AS v FROM "makeMethod" WHERE "itemId" = $1`,
    [targetItemId]
  );
  const nextVersion = vRes.rows[0].v;
  const mmRes = await client.query(
    `INSERT INTO "makeMethod" ("itemId", status, version, "changeOrderId", "companyId", "createdBy")
     SELECT "itemId", 'Draft', $2, $3, "companyId", $4 FROM "makeMethod" WHERE id = $1
     RETURNING id`,
    [activeMakeMethodId, nextVersion, changeOrderId, userId]
  );
  const draftId = mmRes.rows[0].id as string;
  await copyMethodRows(ctx, activeMakeMethodId, draftId);
  return draftId;
}

// Revision / New Part: create a new inactive item (Revision = same readableId +
// bumped revision; New Part = a new readableId), copy the source method into its
// auto-created Draft, and stamp changeOrderId on both the item and the draft.
async function createDraftItemMethod(
  ctx: Ctx,
  changeOrderId: string,
  source: { itemId: string; makeMethodId: string },
  kind: "Revision" | "NewPart",
  newReadableId: string,
  revision: string
): Promise<{ itemId: string; draftMakeMethodId: string }> {
  const { client, companyId, userId } = ctx;
  const itemRes = await client.query(
    `INSERT INTO item (
      "readableId", revision, name, type, "replenishmentSystem",
      "defaultMethodType", "itemTrackingType", "unitOfMeasureCode",
      active, "revisionStatus", "changeOrderId", "companyId", "createdBy"
    )
    SELECT $1, $2, name, type, "replenishmentSystem",
      "defaultMethodType", "itemTrackingType", "unitOfMeasureCode",
      false, 'Design', $3, "companyId", $4
    FROM item WHERE id = $5
    RETURNING id`,
    [newReadableId, revision, changeOrderId, userId, source.itemId]
  );
  const newItemId = itemRes.rows[0].id as string;
  if (kind === "NewPart") {
    await client.query(
      `INSERT INTO part (id, "companyId", "createdBy") VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [newReadableId, companyId, userId]
    );
  }
  // The item-insert interceptor auto-creates a Draft makeMethod; copy into it.
  const mmRes = await client.query(
    `SELECT id FROM "makeMethod" WHERE "itemId" = $1 ORDER BY version LIMIT 1`,
    [newItemId]
  );
  if (mmRes.rows.length === 0) {
    throw new Error(`No auto-created makeMethod for new item ${newReadableId}`);
  }
  const draftMakeMethodId = mmRes.rows[0].id as string;
  await copyMethodRows(ctx, source.makeMethodId, draftMakeMethodId);
  await client.query(
    `UPDATE "makeMethod" SET "changeOrderId" = $1 WHERE id = $2`,
    [changeOrderId, draftMakeMethodId]
  );
  return { itemId: newItemId, draftMakeMethodId };
}

// Add an affected item with its CO-owned Draft per change type. Returns the
// affected-item id + the draft make method id (for subsequent BOM edits).
async function addAffectedItem(
  ctx: Ctx,
  changeOrderId: string,
  source: { itemId: string; makeMethodId: string },
  changeType: "Version" | "Revision" | "NewPart",
  sortOrder: number,
  opts: {
    supersessionMode?: string;
    newReadableId?: string;
    revision?: string;
  } = {}
): Promise<{
  affectedItemId: string;
  draftMakeMethodId: string;
  newItemId: string | null;
}> {
  const { client, companyId, userId } = ctx;

  let draftMakeMethodId: string;
  let newItemId: string | null = null;
  if (changeType === "Version") {
    draftMakeMethodId = await createDraftVersionMethod(
      ctx,
      changeOrderId,
      source.makeMethodId,
      source.itemId
    );
  } else {
    const created = await createDraftItemMethod(
      ctx,
      changeOrderId,
      source,
      changeType,
      opts.newReadableId ?? `PRT-CO-${changeType}`,
      opts.revision ?? "1"
    );
    draftMakeMethodId = created.draftMakeMethodId;
    newItemId = created.itemId;
  }

  // The seed's "NewPart" scenario derives a new part from a source + writes a
  // supersession — that is the 1:1 replacement, now named 'Replacement Part' (the
  // net-new 'New Part' has no predecessor and isn't seeded here).
  const changeTypeValue =
    changeType === "NewPart" ? "Replacement Part" : changeType;

  const aiRes = await client.query(
    `INSERT INTO "changeOrderAffectedItem" (
      "changeOrderId", "itemId", "sortOrder", "changeType",
      "draftMakeMethodId", "baseMakeMethodId", "newItemId",
      "supersessionMode", "companyId", "createdBy"
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [
      changeOrderId,
      source.itemId,
      sortOrder,
      changeTypeValue,
      draftMakeMethodId,
      source.makeMethodId,
      newItemId,
      opts.supersessionMode ?? "Consume First",
      companyId,
      userId
    ]
  );
  return {
    affectedItemId: aiRes.rows[0].id as string,
    draftMakeMethodId,
    newItemId
  };
}

// Delete a BOM line from a Draft make method (models "remove a line").
async function deleteDraftMaterial(
  ctx: Ctx,
  draftMakeMethodId: string,
  componentItemId: string
) {
  const { client, companyId } = ctx;
  await client.query(
    `DELETE FROM "methodMaterial"
     WHERE "makeMethodId" = $1 AND "itemId" = $2 AND "companyId" = $3`,
    [draftMakeMethodId, componentItemId, companyId]
  );
}

async function addSupersession(
  ctx: Ctx,
  changeOrderId: string,
  predecessorItemId: string,
  successorItemId: string,
  supersessionMode = "Consume First"
) {
  const { client, companyId, userId } = ctx;
  await client.query(
    `INSERT INTO "changeOrderSupersession" (
      "changeOrderId", "predecessorItemId", "successorItemId", "supersessionMode",
      "companyId", "createdBy"
    ) VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      changeOrderId,
      predecessorItemId,
      successorItemId,
      supersessionMode,
      companyId,
      userId
    ]
  );
}

async function addActionTask(
  ctx: Ctx,
  changeOrderId: string,
  name: string,
  status: string,
  assignee: string | null,
  dueDate: string | null,
  sortOrder: number
) {
  const { client, companyId, userId } = ctx;
  await client.query(
    `INSERT INTO "changeOrderActionTask" (
      "changeOrderId", name, status, assignee, "dueDate", "sortOrder", "companyId", "createdBy"
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      changeOrderId,
      name,
      status,
      assignee,
      dueDate,
      sortOrder,
      companyId,
      userId
    ]
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function seed() {
  if (!process.env.SUPABASE_DB_URL) {
    console.error(
      "Error: SUPABASE_DB_URL is not set. Load it first:\n" +
        "  set -a; . ./.env.local; set +a"
    );
    process.exit(1);
  }

  const pgPool = getPostgresConnectionPool(1);
  const client = await pgPool.connect();

  try {
    const { companyId, companyName, userId, locationId, nonConformanceTypeId } =
      await resolveContext(client);

    console.log(`\nSeeding Change Orders for "${companyName}" (${companyId})`);
    console.log(`  user=${userId} location=${locationId}\n`);

    await client.query("BEGIN");

    try {
      const ctx: Ctx = { client, companyId, userId, locationId };

      // --- Idempotency: clear prior seed ---
      console.log("1. Clearing prior seed (if any)...");
      await deletePriorSeed(client, companyId);

      // --- Change order categories ---
      const cotRes = await client.query(
        `SELECT id, name FROM "changeOrderType" WHERE "companyId" = $1 AND name = ANY($2)`,
        [companyId, ["Design improvement", "Obsolescence", "Cost reduction"]]
      );
      const cotByName: Record<string, string> = {};
      for (const r of cotRes.rows) cotByName[r.name] = r.id;
      // Self-create the default categories if this company predates the
      // seed.data.ts defaults (older dev companies lack them).
      for (const name of [
        "Design improvement",
        "Obsolescence",
        "Cost reduction"
      ]) {
        if (!cotByName[name]) {
          const ins = await client.query(
            `INSERT INTO "changeOrderType" (name, "companyId", "createdBy") VALUES ($1, $2, $3) RETURNING id`,
            [name, companyId, userId]
          );
          cotByName[name] = ins.rows[0].id;
        }
      }
      const cotDesign = need(cotByName, "Design improvement");
      const cotObsolescence = need(cotByName, "Obsolescence");
      const cotCost = need(cotByName, "Cost reduction");

      // --- Processes ---
      console.log("2. Creating processes and work centers...");
      const processId: Record<string, string> = {};
      for (const name of PROCESS_NAMES) {
        const r = await client.query(
          `INSERT INTO process (name, "defaultStandardFactor", "companyId", "createdBy")
           VALUES ($1, 'Hours/Piece', $2, $3) RETURNING id`,
          [name, companyId, userId]
        );
        processId[name] = r.rows[0].id;
      }

      // --- Work centers ---
      const workCenterId: Record<string, string> = {};
      for (const name of WORK_CENTER_NAMES) {
        const r = await client.query(
          `INSERT INTO "workCenter" (name, "locationId", "companyId", "createdBy")
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [name, locationId, companyId, userId]
        );
        workCenterId[name] = r.rows[0].id;
      }

      // --- Suppliers / customers ---
      console.log("3. Creating suppliers and customers...");
      const supplierId: Record<string, string> = {};
      for (const name of SUPPLIER_NAMES) {
        const r = await client.query(
          `INSERT INTO supplier (name, "companyId", "createdBy") VALUES ($1, $2, $3) RETURNING id`,
          [name, companyId, userId]
        );
        supplierId[name] = r.rows[0].id;
      }
      const customerId: Record<string, string> = {};
      for (const name of CUSTOMER_NAMES) {
        const r = await client.query(
          `INSERT INTO customer (name, "companyId", "createdBy") VALUES ($1, $2, $3) RETURNING id`,
          [name, companyId, userId]
        );
        customerId[name] = r.rows[0].id;
      }

      // --- Purchased items (keyed by readableId + '.' + revision) ---
      console.log("4. Creating purchased parts...");
      const purchased: Record<string, string> = {};
      for (const def of PURCHASED_PARTS) {
        const key = `${def.readableId}.${def.revision}`;
        purchased[key] = await createPurchasedItem(ctx, def);
      }
      // Convenience references.
      const bracketA = need(purchased, "PRT-001186.0"); // ".A"
      const bracketB = need(purchased, "PRT-001186.B"); // ".B"
      const fst100 = need(purchased, "FST-100.0");
      const fst101 = need(purchased, "FST-101.0");
      const fst102 = need(purchased, "FST-102.0");
      const brg200 = need(purchased, "BRG-200.0");
      const cbl300 = need(purchased, "CBL-300.0");

      // --- Make items with BOM + BOP ---
      console.log("5. Creating make parts with BOM + BOP...");
      const make: Record<string, { itemId: string; makeMethodId: string }> = {};
      for (const def of MAKE_PARTS) {
        make[def.readableId] = await createMakeItem(ctx, def);
      }
      const ga0020 = need(make, "GA-0020");
      const ga0022 = need(make, "GA-0022");
      const ga0044 = need(make, "GA-0044");
      const sa0065 = need(make, "SA-0065");
      const veh1 = need(make, "VEH0000001");
      const veh6 = need(make, "VEH000006");

      // BOMs
      await addBomLine(ctx, ga0020.makeMethodId, bracketA, 1, 1);
      await addBomLine(ctx, ga0020.makeMethodId, fst100, 4, 2);
      await addBomLine(ctx, ga0020.makeMethodId, brg200, 2, 3);
      await addBopOperation(
        ctx,
        ga0020.makeMethodId,
        need(processId, "Machining"),
        need(workCenterId, "CNC Mill"),
        "Machining",
        1
      );
      await addBopOperation(
        ctx,
        ga0020.makeMethodId,
        need(processId, "Assembly"),
        need(workCenterId, "Assembly Line 1"),
        "Assembly",
        2
      );

      await addBomLine(ctx, ga0022.makeMethodId, bracketA, 1, 1);
      await addBomLine(ctx, ga0022.makeMethodId, fst100, 2, 2);
      await addBopOperation(
        ctx,
        ga0022.makeMethodId,
        need(processId, "Assembly"),
        need(workCenterId, "Assembly Line 1"),
        "Assembly",
        1
      );

      await addBomLine(ctx, ga0044.makeMethodId, bracketA, 1, 1);
      await addBomLine(ctx, ga0044.makeMethodId, cbl300, 1, 2);
      await addBopOperation(
        ctx,
        ga0044.makeMethodId,
        need(processId, "Assembly"),
        need(workCenterId, "Assembly Line 1"),
        "Assembly",
        1
      );

      await addBomLine(ctx, sa0065.makeMethodId, bracketA, 1, 1);
      await addBomLine(ctx, sa0065.makeMethodId, fst101, 1, 2);
      await addBopOperation(
        ctx,
        sa0065.makeMethodId,
        need(processId, "Welding"),
        need(workCenterId, "Weld Cell"),
        "Welding",
        1
      );
      await addBopOperation(
        ctx,
        sa0065.makeMethodId,
        need(processId, "Inspection"),
        need(workCenterId, "QC Bench"),
        "Inspection",
        2
      );

      await addBomLine(ctx, veh1.makeMethodId, ga0020.itemId, 1, 1);
      await addBomLine(ctx, veh1.makeMethodId, ga0022.itemId, 1, 2);
      await addBomLine(ctx, veh1.makeMethodId, sa0065.itemId, 1, 3);
      await addBopOperation(
        ctx,
        veh1.makeMethodId,
        need(processId, "Assembly"),
        need(workCenterId, "Assembly Line 1"),
        "Assembly",
        1
      );
      await addBopOperation(
        ctx,
        veh1.makeMethodId,
        need(processId, "Inspection"),
        need(workCenterId, "QC Bench"),
        "Inspection",
        2
      );

      await addBomLine(ctx, veh6.makeMethodId, sa0065.itemId, 1, 1);
      await addBomLine(ctx, veh6.makeMethodId, ga0044.itemId, 1, 2);
      await addBopOperation(
        ctx,
        veh6.makeMethodId,
        need(processId, "Assembly"),
        need(workCenterId, "Assembly Line 1"),
        "Assembly",
        1
      );

      // --- Downstream: PO, Job, Sales Order ---
      console.log("6. Creating downstream PO / Job / Sales Order...");

      // Open PO for PRT-001186.A (drives Implementation impact panel)
      const siRes = await client.query(
        `INSERT INTO "supplierInteraction" ("companyId", "supplierId") VALUES ($1, $2) RETURNING id`,
        [companyId, need(supplierId, "FastenerCo")]
      );
      const supplierInteractionId = siRes.rows[0].id;
      const poRes = await client.query(
        `INSERT INTO "purchaseOrder" (
          "purchaseOrderId", "supplierId", "supplierInteractionId", status,
          "purchaseOrderType", "exchangeRate", "companyId", "createdBy"
        ) VALUES ($1, $2, $3, 'To Receive', 'Purchase', 1, $4, $5) RETURNING id`,
        [
          PO_ID,
          need(supplierId, "FastenerCo"),
          supplierInteractionId,
          companyId,
          userId
        ]
      );
      const purchaseOrderId = poRes.rows[0].id;
      await client.query(
        `INSERT INTO "purchaseOrderDelivery" (id, "locationId", "companyId") VALUES ($1, $2, $3)`,
        [purchaseOrderId, locationId, companyId]
      );
      await client.query(
        `INSERT INTO "purchaseOrderLine" (
          "purchaseOrderId", "purchaseOrderLineType", "itemId",
          "purchaseQuantity", "quantityReceived", "quantityInvoiced",
          "supplierUnitPrice", "supplierShippingCost", "supplierTaxAmount",
          "exchangeRate", "setupPrice", "conversionFactor",
          "purchaseUnitOfMeasureCode", "inventoryUnitOfMeasureCode",
          "companyId", "createdBy"
        ) VALUES ($1, 'Part', $2, 200, 0, 0, 12.50, 0, 0, 1, 0, 1, 'EA', 'EA', $3, $4)`,
        [purchaseOrderId, bracketA, companyId, userId]
      );

      // In-progress job for VEH0000001
      await client.query(
        `INSERT INTO job (
          "jobId", "itemId", quantity, "locationId", status, "unitOfMeasureCode", "companyId", "createdBy"
        ) VALUES ($1, $2, 5, $3, 'In Progress', 'EA', $4, $5)`,
        [JOB_ID, veh1.itemId, locationId, companyId, userId]
      );

      // Sales order (To Ship) for VEH0000001
      const soRes = await client.query(
        `INSERT INTO "salesOrder" (
          "salesOrderId", "customerId", "currencyCode", status, "companyId", "createdBy"
        ) VALUES ($1, $2, 'USD', 'To Ship', $3, $4) RETURNING id`,
        [SO_ID, need(customerId, "VeloRetail"), companyId, userId]
      );
      const salesOrderId = soRes.rows[0].id;
      await client.query(
        `INSERT INTO "salesOrderShipment" (id, "locationId", "companyId") VALUES ($1, $2, $3)`,
        [salesOrderId, locationId, companyId]
      );
      await client.query(
        `INSERT INTO "salesOrderLine" (
          "salesOrderId", "salesOrderLineType", "itemId",
          "saleQuantity", "unitPrice", "unitOfMeasureCode", "companyId", "createdBy"
        ) VALUES ($1, 'Part', $2, 5, 899.00, 'EA', $3, $4)`,
        [salesOrderId, veh1.itemId, companyId, userId]
      );

      // --- NCR (linked from ECO-000001) ---
      console.log("7. Creating NCR...");
      const ncrRes = await client.query(
        `INSERT INTO "nonConformance" (
          "nonConformanceId", name, source, "locationId", "nonConformanceTypeId",
          "openDate", "companyId", "createdBy"
        ) VALUES ($1, $2, 'Internal', $3, $4, $5, $6, $7) RETURNING id`,
        [
          NCR_ID,
          "Derailleur thread failure under load",
          locationId,
          nonConformanceTypeId,
          "2026-07-05",
          companyId,
          userId
        ]
      );
      const ncrId = ncrRes.rows[0].id;

      // --- Change orders ---
      console.log("8. Creating change orders...");

      // ECO-000001 — Implementation
      const co1 = await createChangeOrder(ctx, {
        changeOrderId: "ECO-000001",
        name: "Sync 3 Derailleur Mount",
        status: "Implementation",
        changeOrderTypeId: cotDesign,
        assignee: userId,
        reasonForChange:
          "Field returns show the derailleur mount thread fails under sustained load. " +
          "Root-caused to the Rear Dropout Bracket geometry (see NCR-CO-001).",
        description:
          "Supersede Rear Dropout Bracket (PRT-001186.A) with the redesigned " +
          "PRT-001186.B across all affected assemblies. New CAD released via Onshape.",
        nonConformanceId: ncrId
      });
      // Top-to-bottom: the user selects the affected ASSEMBLIES first, then edits
      // each one's staged (snapshotted) BOM. Here the PRD change is swapping the
      // bracket PRT-001186.A → PRT-001186.B on every assembly that uses it.
      const co1Assemblies: {
        key: string;
        a: { itemId: string; makeMethodId: string };
      }[] = [
        { key: "GA-0020", a: ga0020 },
        { key: "GA-0022", a: ga0022 },
        { key: "GA-0044", a: ga0044 },
        { key: "SA-0065", a: sa0065 }
      ];
      let co1Sort = 0;
      for (const { a } of co1Assemblies) {
        // 1. Version change: spin a CO-owned Draft method (copy of Active).
        const { draftMakeMethodId } = await addAffectedItem(
          ctx,
          co1,
          a,
          "Version",
          co1Sort++
        );
        // 2. Edit the Draft's real BOM: remove bracketA (a "removed" line) and
        //    add bracketB (an "added" line). The diff derives from Draft-vs-base.
        await deleteDraftMaterial(ctx, draftMakeMethodId, bracketA);
        await addBomLine(ctx, draftMakeMethodId, bracketB, 1, 1);
      }
      // Optional manual supersession row (bracketA → bracketB) to exercise that
      // surface (different-part obsolescence, distinct from the auto revision cutover).
      await addSupersession(ctx, co1, bracketA, bracketB, "Consume First");
      await addActionTask(
        ctx,
        co1,
        "Submit PRT-001186.B CAD for Onshape approval",
        "Completed",
        userId,
        null,
        1
      );
      await addActionTask(
        ctx,
        co1,
        "Update work instruction WI-0089",
        "Pending",
        null,
        "2026-07-20",
        2
      );

      // ECO-000002 — Engineering Complete
      const co2 = await createChangeOrder(ctx, {
        changeOrderId: "ECO-000002",
        name: "VEH3 Battery Lock Update",
        status: "Engineering Complete",
        changeOrderTypeId: cotDesign,
        assignee: userId,
        reasonForChange:
          "Battery lock rattle under vibration; replace fastener with a sealed bearing detent.",
        description:
          "Remove M5 Bolt from Stage 3 and add a Sealed Bearing detent."
      });
      // One affected item (GA-0022, Version): swap M5 Bolt → Sealed Bearing detent.
      const co2Affected = await addAffectedItem(ctx, co2, ga0022, "Version", 0);
      await deleteDraftMaterial(ctx, co2Affected.draftMakeMethodId, fst100);
      await addBomLine(ctx, co2Affected.draftMakeMethodId, brg200, 1, 1);

      // ECO-000003 — Start
      const co3 = await createChangeOrder(ctx, {
        changeOrderId: "ECO-000003",
        name: "Cargo Box Bracket Redesign",
        status: "Start",
        changeOrderTypeId: cotDesign,
        assignee: userId,
        reasonForChange:
          "Cargo box bracket alignment dowel is over-specified; remove to reduce cost and weight.",
        description: "Delete Alignment Dowel from Pedal2 Sync3 sub-assembly."
      });
      // One affected item (SA-0065, Version): delete the Alignment Dowel line.
      const co3Affected = await addAffectedItem(ctx, co3, sa0065, "Version", 0);
      await deleteDraftMaterial(ctx, co3Affected.draftMakeMethodId, fst101);

      // ECO-000004 — Start. Demonstrates the Revision + New Part change types.
      const co4 = await createChangeOrder(ctx, {
        changeOrderId: "ECO-000004",
        name: "Cable Routing Doc Update + FFF Replacement",
        status: "Start",
        changeOrderTypeId: cotDesign,
        assignee: userId,
        reasonForChange:
          "Documentation revision for the sub-assembly, plus a fit-form-function " +
          "replacement introduced as a new part number.",
        description:
          "Revision: bump SA-0065 for a non-FFF doc/spec update (new revision, " +
          "no BoM change). New Part: introduce a new P/N derived from GA-0044 " +
          "(FFF replacement), superseding it at release."
      });
      // Revision change type — new inactive revision item of SA-0065 (method
      // copied into its Draft; no BoM edit — Revision is docs/attrs only).
      await addAffectedItem(ctx, co4, sa0065, "Revision", 0);
      // New Part change type — a new part number derived from GA-0044.
      await addAffectedItem(ctx, co4, ga0044, "NewPart", 1, {
        newReadableId: NEW_PART_IDS[0]
      });
      await addActionTask(
        ctx,
        co4,
        "Reroute cable channel",
        "In Progress",
        userId,
        null,
        1
      );

      // ECO-000005 — Done (already-applied CO)
      const co5 = await createChangeOrder(ctx, {
        changeOrderId: "ECO-000005",
        name: "Saddle Supersession Royal MW",
        status: "Done",
        changeOrderTypeId: cotObsolescence,
        assignee: userId,
        reasonForChange:
          "Original saddle supplier discontinued the SKU; superseded by Royal MW.",
        description:
          "Obsolescence supersession applied across affected vehicles."
      });
      await addActionTask(
        ctx,
        co5,
        "Confirm inventory drawdown of obsolete saddle",
        "Completed",
        userId,
        null,
        1
      );

      // ECO-000006 — Draft (Unassigned, blank)
      await createChangeOrder(ctx, {
        changeOrderId: "ECO-000006",
        name: "Luxembourg Handlebar Stem",
        status: "Draft",
        changeOrderTypeId: cotCost,
        assignee: null
      });

      // ECO-000007 — Start. One affected item (VEH0000001, a top-level product not
      // touched by another open CO): add a Locking Washer to its staged BOM.
      const co7 = await createChangeOrder(ctx, {
        changeOrderId: "ECO-000007",
        name: "Fork Crown Reinforcement",
        status: "Start",
        changeOrderTypeId: cotDesign,
        assignee: userId,
        reasonForChange:
          "Add a locking washer to the fork crown assembly to prevent loosening.",
        description:
          "Add Locking Washer (FST-102) x2 to the top-level Pedal4 Sync3 assembly."
      });
      // Version change on the top-level product: add FST-102 to the Draft BOM.
      const co7Affected = await addAffectedItem(ctx, co7, veh1, "Version", 0);
      await addBomLine(ctx, co7Affected.draftMakeMethodId, fst102, 2, 99);

      // --- Bump the CO sequence past the seeded ids ---
      console.log("9. Bumping changeOrder sequence...");
      await client.query(
        `UPDATE sequence SET next = 8 WHERE "table" = 'changeOrder' AND "companyId" = $1 AND next < 8`,
        [companyId]
      );

      await client.query("COMMIT");
      console.log("   Transaction committed successfully.\n");

      await printSummary(client, companyId);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("   Transaction rolled back due to error.");
      throw err;
    }
  } catch (error) {
    console.error("\nError seeding change orders:");
    console.error(error);
    process.exit(1);
  } finally {
    client.release();
    await pgPool.end();
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
async function printSummary(client: PoolClient, companyId: string) {
  const q = async (sql: string, params: unknown[] = []) =>
    (await client.query(sql, params)).rows;

  const items = await q(
    `SELECT count(*)::int n FROM item WHERE "companyId" = $1 AND "readableId" = ANY($2)`,
    [companyId, ALL_SEEDED_ITEM_IDS]
  );
  const makeMethods = await q(
    `SELECT count(*)::int n FROM "makeMethod" mk JOIN item i ON i.id = mk."itemId"
     WHERE i."companyId" = $1 AND i."readableId" = ANY($2) AND mk.status = 'Active'`,
    [companyId, MAKE_PARTS.map((p) => p.readableId)]
  );
  const bomLines = await q(
    `SELECT count(*)::int n FROM "methodMaterial" mm JOIN "makeMethod" mk ON mk.id = mm."makeMethodId"
     JOIN item i ON i.id = mk."itemId" WHERE i."companyId" = $1 AND i."readableId" = ANY($2)`,
    [companyId, ALL_SEEDED_ITEM_IDS]
  );
  const bopOps = await q(
    `SELECT count(*)::int n FROM "methodOperation" mo JOIN "makeMethod" mk ON mk.id = mo."makeMethodId"
     JOIN item i ON i.id = mk."itemId" WHERE i."companyId" = $1 AND i."readableId" = ANY($2)`,
    [companyId, ALL_SEEDED_ITEM_IDS]
  );
  const cosByStatus = await q(
    `SELECT status, count(*)::int n FROM "changeOrder"
     WHERE "companyId" = $1 AND "changeOrderId" = ANY($2) GROUP BY status ORDER BY status`,
    [companyId, CHANGE_ORDER_IDS]
  );
  const affectedItems = await q(
    `SELECT count(*)::int n FROM "changeOrderAffectedItem" ai
     JOIN "changeOrder" co ON co.id = ai."changeOrderId"
     WHERE co."companyId" = $1 AND co."changeOrderId" = ANY($2)`,
    [companyId, CHANGE_ORDER_IDS]
  );
  const draftMethods = await q(
    `SELECT count(*)::int n FROM "makeMethod" mk
     JOIN "changeOrder" co ON co.id = mk."changeOrderId"
     WHERE co."companyId" = $1 AND co."changeOrderId" = ANY($2)`,
    [companyId, CHANGE_ORDER_IDS]
  );
  const draftMaterials = await q(
    `SELECT count(*)::int n FROM "methodMaterial" mm
     JOIN "makeMethod" mk ON mk.id = mm."makeMethodId"
     JOIN "changeOrder" co ON co.id = mk."changeOrderId"
     WHERE co."companyId" = $1 AND co."changeOrderId" = ANY($2)`,
    [companyId, CHANGE_ORDER_IDS]
  );
  const changeTypes = await q(
    `SELECT "changeType", count(*)::int n FROM "changeOrderAffectedItem" ai
     JOIN "changeOrder" co ON co.id = ai."changeOrderId"
     WHERE co."companyId" = $1 AND co."changeOrderId" = ANY($2)
     GROUP BY "changeType" ORDER BY "changeType"`,
    [companyId, CHANGE_ORDER_IDS]
  );
  const supersessions = await q(
    `SELECT count(*)::int n FROM "changeOrderSupersession" s
     JOIN "changeOrder" co ON co.id = s."changeOrderId"
     WHERE co."companyId" = $1 AND co."changeOrderId" = ANY($2)`,
    [companyId, CHANGE_ORDER_IDS]
  );
  const actions = await q(
    `SELECT count(*)::int n FROM "changeOrderActionTask" t
     JOIN "changeOrder" co ON co.id = t."changeOrderId"
     WHERE co."companyId" = $1 AND co."changeOrderId" = ANY($2)`,
    [companyId, CHANGE_ORDER_IDS]
  );
  const ncrs = await q(
    `SELECT count(*)::int n FROM "nonConformance" WHERE "companyId" = $1 AND "nonConformanceId" = $2`,
    [companyId, NCR_ID]
  );

  console.log("========================================");
  console.log("Change Orders seed summary");
  console.log("========================================");
  console.log(`  Items:            ${items[0].n} (7 purchased + 6 make)`);
  console.log(`  Active makeMethods: ${makeMethods[0].n}`);
  console.log(`  BOM lines:        ${bomLines[0].n}`);
  console.log(`  BOP operations:   ${bopOps[0].n}`);
  console.log(
    `  Suppliers/Customers: ${SUPPLIER_NAMES.length}/${CUSTOMER_NAMES.length}`
  );
  console.log(`  Purchase Order:   ${PO_ID} (To Receive, PRT-001186.A x200)`);
  console.log(`  Job:              ${JOB_ID} (In Progress, VEH0000001)`);
  console.log(`  Sales Order:      ${SO_ID} (To Ship, VEH0000001)`);
  console.log(`  NCR:              ${ncrs[0].n > 0 ? NCR_ID : "MISSING"}`);
  console.log("  Change Orders by status:");
  for (const r of cosByStatus) console.log(`    ${r.status.padEnd(22)} ${r.n}`);
  console.log(`  Affected items:         ${affectedItems[0].n}`);
  console.log("  Affected items by change type:");
  for (const r of changeTypes)
    console.log(`    ${String(r.changeType).padEnd(20)} ${r.n}`);
  console.log(`  CO-owned draft methods: ${draftMethods[0].n}`);
  console.log(`  Draft BOM lines:        ${draftMaterials[0].n}`);
  console.log(`  Supersessions:          ${supersessions[0].n}`);
  console.log(`  Action tasks:           ${actions[0].n}`);
  console.log("========================================\n");
}

seed();
