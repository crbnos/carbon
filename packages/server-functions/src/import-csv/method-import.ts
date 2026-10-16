// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Method (BOM/BOP) importer — backs the `bom`, `operations`, and `partWithMethod`
// CSV imports. One row-type-multiplexed engine (ADR-0002): a single file carries
// PART/BOM/BOP/STEP/TOOL/PARAM rows, each non-PART row naming its parent part
// explicitly. Atomic per parent part and create-only / fill-if-empty (ADR-0001).
//
// The import-csv server function writes directly to the database and does NOT call
// the app's items.service.ts, so the derivation logic that `upsertMethodMaterial`
// owns (methodType / sourcingType / materialMakeMethodId / storageUnitIds from the
// component item) is replicated here.

import type { KyselyDatabase } from "@carbon/database/client";
import { datetime } from "@carbon/utils";
import { type Kysely, sql, type Transaction } from "kysely";
import {
  collectItemExtras,
  emptyItemExtras,
  itemExtrasError,
  writeItemExtras
} from "./item-extras";
import { inTransaction } from "./transaction";

type Rec = Record<string, string>;
type Summary = {
  inserted: number;
  updated: number;
  errors: Array<{ row: number; reason: string }>;
  skipped: Array<{ row: number; reason: string }>;
  /** Rows that updated an existing record, so took no defaults. */
  existingRows?: number[];
};

const ROW_TYPES = ["PART", "BOM", "BOP", "STEP", "TOOL", "PARAM"] as const;
type RowType = (typeof ROW_TYPES)[number];

const STEP_TYPES = [
  "Task",
  "Value",
  "Measurement",
  "Checkbox",
  "Timestamp",
  "Person",
  "List",
  "File",
  "Inspection"
] as const;

type Entry = { record: Rec; index: number };
type VersionBucket = {
  bom: Entry[];
  bop: Entry[];
  step: Entry[];
  tool: Entry[];
  param: Entry[];
};
type Group = {
  readableId: string;
  revision: string;
  firstIndex: number;
  partRow?: Entry;
  versions: Map<string, VersionBucket>;
};

type ItemInfo = {
  id: string;
  type: string;
  defaultMethodType: string | null;
  sourcingType: string | null;
};

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

const key = (readableId: string, revision: string) =>
  `${readableId} ${revision || "0"}`;

/** The key of a supplier's process: a supplier and a process. */
const supplierProcessKey = (supplierId: string, processId: string) =>
  `${supplierId} ${processId}`;

const num = (s: string | undefined): number | undefined => {
  if (s === undefined || s.trim() === "") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

const bool = (s: string | undefined): boolean =>
  typeof s === "string" && s.trim().toLowerCase() === "true";

const text = (s: string | undefined): string => (s ?? "").trim();

// Legacy CSV templates may still use the old "Inside"/"Outside" operation types.
const normalizeOperationType = (value: string): string =>
  value === "Inside"
    ? "Process"
    : value === "Outside"
      ? "Outside Processing"
      : value;

/**
 * The order to write a file's part groups in: each part after the parts of the
 * same file it uses as a material or tool, so a component's PART row may come
 * after the assembly that uses it. Otherwise file order. A part that uses
 * itself through others (A in B, B in A) is written in file order, and its
 * missing component then fails the row as before.
 */
export function componentsFirst(
  keys: string[],
  usesOf: (key: string) => string[]
): string[] {
  const inFile = new Set(keys);
  const placed = new Set<string>();
  const visiting = new Set<string>();
  const order: string[] = [];
  const visit = (k: string) => {
    if (placed.has(k) || visiting.has(k)) return;
    visiting.add(k);
    for (const used of usesOf(k)) {
      if (used !== k && inFile.has(used)) visit(used);
    }
    visiting.delete(k);
    placed.add(k);
    order.push(k);
  };
  for (const k of keys) visit(k);
  return order;
}

// The `row` reported on each error: the 0-based index of the data row. This must
// match how the results modal keys errors to rows (by array index into the parsed
// rows) and the standard importer in index.ts — NOT a human CSV line number.
const rowOf = (index: number) => index;

// Plain text → minimal tiptap doc for a step's rich-text description.
function plainTextToTiptap(value: string): Record<string, unknown> {
  const t = (value ?? "").trim();
  if (!t) return {};
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: t }] }]
  };
}

function normalizeRowType(
  raw: string | undefined,
  table: string
): RowType | null {
  const v = (raw ?? "").trim().toUpperCase();
  // The BOM file is homogeneous — every row is a BOM line — so a blank Row Type
  // defaults to BOM. The operations and combined files are multi-type (BOP/STEP/
  // TOOL/PARAM, +PART), so Row Type is a required discriminator there.
  if (!v) return table === "bom" ? "BOM" : null;
  return (ROW_TYPES as readonly string[]).includes(v) ? (v as RowType) : null;
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

/**
 * Imports a method file's parts, BOMs and operations one parent part at a time.
 * Each part's group is written whole or not at all.
 */
export async function importMethods(
  db: Kysely<KyselyDatabase>,
  args: {
    table: "bom" | "operations" | "partWithMethod";
    // The file's rows as [row number, record]: a row rejected earlier (a
    // reference outside the company) is left out but keeps its number.
    rows: Array<[number, Rec]>;
    companyId: string;
    userId: string;
    summary: Summary;
  }
): Promise<void> {
  const { table, rows, companyId, userId, summary } = args;

  // 1. classify + group by parent part ------------------------------------
  const groups = new Map<string, Group>();
  const getGroup = (readableId: string, revision: string, index: number) => {
    const k = key(readableId, revision);
    let g = groups.get(k);
    if (!g) {
      g = {
        readableId,
        revision: revision || "0",
        firstIndex: index,
        versions: new Map()
      };
      groups.set(k, g);
    }
    return g;
  };
  const getBucket = (g: Group, version: string): VersionBucket => {
    let b = g.versions.get(version);
    if (!b) {
      b = { bom: [], bop: [], step: [], tool: [], param: [] };
      g.versions.set(version, b);
    }
    return b;
  };

  for (const [index, record] of rows) {
    const rowType = normalizeRowType(record.rowType, table);
    if (!rowType) {
      summary.errors.push({
        row: rowOf(index),
        reason: `Unknown or missing Row Type "${text(record.rowType)}"`
      });
      continue;
    }

    if (rowType === "PART") {
      const readableId = text(record.readableId);
      if (!readableId) {
        summary.errors.push({
          row: rowOf(index),
          reason: "PART row is missing Part Number"
        });
        continue;
      }
      const g = getGroup(readableId, text(record.revision), index);
      // The first PART row describes the part. Before, a later one replaced
      // it with no report.
      if (g.partRow) {
        summary.skipped.push({
          row: rowOf(index),
          reason: `${g.readableId} rev ${g.revision} is already on an earlier PART row`
        });
      } else g.partRow = { record, index };
      continue;
    }

    // BOM / BOP / STEP / TOOL / PARAM — keyed to a parent part.
    const parentId = text(record.parentId);
    if (!parentId) {
      summary.errors.push({
        row: rowOf(index),
        reason: `${rowType} row is missing Parent ID`
      });
      continue;
    }
    const g = getGroup(parentId, text(record.parentRevision), index);
    const bucket = getBucket(g, text(record.makeMethodVersion));
    const entry = { record, index };
    if (rowType === "BOM") bucket.bom.push(entry);
    else if (rowType === "BOP") bucket.bop.push(entry);
    else if (rowType === "STEP") bucket.step.push(entry);
    else if (rowType === "TOOL") bucket.tool.push(entry);
    else if (rowType === "PARAM") bucket.param.push(entry);
  }

  if (groups.size === 0) return;

  // 2. collect reference lookups ------------------------------------------
  const readableIds = new Set<string>();
  const processNames = new Set<string>();
  const workCenterNames = new Set<string>();
  const uomCodes = new Set<string>();
  const supplierNames = new Set<string>();

  for (const g of groups.values()) {
    readableIds.add(g.readableId);
    for (const bucket of g.versions.values()) {
      for (const e of bucket.bom) {
        if (text(e.record.componentId))
          readableIds.add(text(e.record.componentId));
        if (text(e.record.unitOfMeasureCode))
          uomCodes.add(text(e.record.unitOfMeasureCode));
      }
      for (const e of bucket.bop) {
        if (text(e.record.process))
          processNames.add(text(e.record.process).toLowerCase());
        if (text(e.record.workCenter))
          workCenterNames.add(text(e.record.workCenter).toLowerCase());
        if (text(e.record.supplier))
          supplierNames.add(text(e.record.supplier).toLowerCase());
      }
      for (const e of bucket.tool) {
        if (text(e.record.toolId)) readableIds.add(text(e.record.toolId));
      }
      for (const e of bucket.step) {
        if (text(e.record.stepUnitOfMeasureCode))
          uomCodes.add(text(e.record.stepUnitOfMeasureCode));
      }
    }
  }

  const itemMap = new Map<string, ItemInfo>();
  if (readableIds.size > 0) {
    const rows = await db
      .selectFrom("item")
      .select([
        "id",
        "readableId",
        "revision",
        "type",
        "defaultMethodType",
        "sourcingType"
      ])
      .where("companyId", "=", companyId)
      .where("readableId", "in", Array.from(readableIds))
      .execute();
    for (const r of rows) {
      const k = key(r.readableId, r.revision ?? "0");
      if (!itemMap.has(k)) {
        itemMap.set(k, {
          id: r.id,
          type: r.type,
          defaultMethodType: r.defaultMethodType ?? null,
          sourcingType: r.sourcingType ?? null
        });
      }
    }
  }

  const { map: processMap, ambiguous: processAmbiguous } = await nameMap(
    db,
    "process",
    companyId,
    processNames
  );
  const { map: workCenterMap, ambiguous: workCenterAmbiguous } = await nameMap(
    db,
    "workCenter",
    companyId,
    workCenterNames
  );

  const uomSet = new Set<string>();
  if (uomCodes.size > 0) {
    const rows = await db
      .selectFrom("unitOfMeasure")
      .select(["code"])
      .where("companyId", "=", companyId)
      .execute();
    for (const r of rows) uomSet.add(r.code);
  }

  const supplierMap = new Map<string, string>();
  if (supplierNames.size > 0) {
    const rows = await db
      .selectFrom("supplier")
      .select(["id", "name", "readableId"])
      .where("companyId", "=", companyId)
      .execute();
    for (const r of rows) {
      supplierMap.set(r.name.toLowerCase(), r.id);
      if (r.readableId) supplierMap.set(r.readableId.toLowerCase(), r.id);
    }
  }

  // The named suppliers' processes, by supplier and process: what an Outside
  // Processing operation links to.
  const supplierProcessMap = new Map<string, string>();
  const namedSupplierIds = [
    ...new Set(
      [...supplierNames].flatMap((name) => supplierMap.get(name) ?? [])
    )
  ];
  if (namedSupplierIds.length > 0) {
    const rows = await db
      .selectFrom("supplierProcess")
      .select(["id", "supplierId", "processId"])
      .where("companyId", "=", companyId)
      .where("supplierId", "in", namedSupplierIds)
      .orderBy("id")
      .execute();
    for (const r of rows) {
      const k = supplierProcessKey(r.supplierId, r.processId);
      if (!supplierProcessMap.has(k)) supplierProcessMap.set(k, r.id);
    }
  }

  // Set of parts that this file will create (so a same-file sub-assembly counts
  // as resolvable during validation even though it doesn't exist yet).
  const fileCreatedParts = new Set<string>();
  for (const g of groups.values()) {
    if (g.partRow) fileCreatedParts.add(key(g.readableId, g.revision));
  }

  // 3 + 4. validate and write each part group, components first ------------
  const writeOrder = componentsFirst([...groups.keys()], (k) => {
    const uses: string[] = [];
    for (const bucket of groups.get(k)!.versions.values()) {
      for (const e of bucket.bom) {
        uses.push(
          key(text(e.record.componentId), text(e.record.componentRevision))
        );
      }
      for (const e of bucket.tool) {
        uses.push(key(text(e.record.toolId), text(e.record.toolRevision)));
      }
    }
    return uses;
  });
  for (const g of writeOrder.map((k) => groups.get(k)!)) {
    const partLabel = `${g.readableId} rev ${g.revision}`;
    const errors = validateGroup(g, {
      itemMap,
      fileCreatedParts,
      processMap,
      processAmbiguous,
      workCenterMap,
      workCenterAmbiguous,
      uomSet,
      supplierMap,
      supplierProcessMap
    });

    if (errors.length > 0) {
      for (const e of errors) summary.errors.push(e);
      continue;
    }

    try {
      const result = await writeGroup(db, g, {
        companyId,
        userId,
        itemMap,
        processMap,
        workCenterMap,
        supplierMap,
        supplierProcessMap
      });
      // Every row counts once: the PART row as inserted (a new item) or
      // updated (an existing one), each method row written as inserted, and
      // each row of a version that already had content as skipped.
      if (result.partCreated === true) summary.inserted++;
      else if (result.partCreated === false) {
        summary.updated++;
        if (g.partRow) summary.existingRows?.push(rowOf(g.partRow.index));
      }
      summary.inserted += result.rowsInserted;
      for (const { index, version } of result.skippedRows) {
        // Create-only, never clobber. Benign: not something the user needs to
        // fix, so it is a skip, not an error.
        summary.skipped.push({
          row: rowOf(index),
          reason: `Part ${partLabel} already has a method${version ? ` (version ${version})` : ""}; skipped`
        });
      }
    } catch (err) {
      summary.errors.push({
        row: rowOf(g.firstIndex),
        reason: `Part ${partLabel} failed to import: ${
          err instanceof Error ? err.message : String(err)
        }`
      });
    }
  }
}

// ---------------------------------------------------------------------------
// reference helpers
// ---------------------------------------------------------------------------

async function nameMap(
  db: Kysely<KyselyDatabase>,
  table: "process" | "workCenter",
  companyId: string,
  names: Set<string>
): Promise<{ map: Map<string, string>; ambiguous: Set<string> }> {
  const map = new Map<string, string>();
  const ambiguous = new Set<string>();
  if (names.size === 0) return { map, ambiguous };

  const rows = await db
    .selectFrom(table)
    .select(["id", "name"])
    .where("companyId", "=", companyId)
    .execute();
  for (const r of rows) {
    const lower = r.name.toLowerCase();
    if (map.has(lower)) ambiguous.add(lower);
    else map.set(lower, r.id);
  }
  return { map, ambiguous };
}

// ---------------------------------------------------------------------------
// validation (pure, given the resolved lookups)
// ---------------------------------------------------------------------------

type Lookups = {
  itemMap: Map<string, ItemInfo>;
  fileCreatedParts: Set<string>;
  processMap: Map<string, string>;
  processAmbiguous: Set<string>;
  workCenterMap: Map<string, string>;
  workCenterAmbiguous: Set<string>;
  uomSet: Set<string>;
  supplierMap: Map<string, string>;
  supplierProcessMap: Map<string, string>;
};

/** Every reason a part's group cannot be written; empty when it can. */
function validateGroup(
  g: Group,
  lk: Lookups
): Array<{ row: number; reason: string }> {
  const errors: Array<{ row: number; reason: string }> = [];
  const parentKey = key(g.readableId, g.revision);
  const partLabel = `${g.readableId} rev ${g.revision}`;

  // The PART row's lead time and unit cost.
  if (g.partRow) {
    const extrasError = itemExtrasError(g.partRow.record);
    if (extrasError) {
      errors.push({ row: rowOf(g.partRow.index), reason: extrasError });
    }
  }

  // Parent must be makeable (Part or Tool). A part created by this file is makeable.
  if (!g.partRow) {
    const parent = lk.itemMap.get(parentKey);
    if (!parent) {
      errors.push({
        row: rowOf(g.firstIndex),
        reason: `Parent part ${partLabel} not found`
      });
    } else if (parent.type !== "Part" && parent.type !== "Tool") {
      errors.push({
        row: rowOf(g.firstIndex),
        reason: `Parent ${partLabel} is a ${parent.type}; only a Part or Tool can own a method`
      });
    }
  }

  for (const bucket of g.versions.values()) {
    // Op No uniqueness within the parent + a set to validate child references.
    const opNos = new Set<string>();
    for (const e of bucket.bop) {
      const opNo = text(e.record.opNo);
      if (!opNo) {
        errors.push({
          row: rowOf(e.index),
          reason: "BOP row is missing Op No"
        });
        continue;
      }
      if (opNos.has(opNo)) {
        errors.push({
          row: rowOf(e.index),
          reason: `Duplicate Op No "${opNo}" for ${partLabel}`
        });
      }
      opNos.add(opNo);

      // process required + resolvable
      const proc = text(e.record.process).toLowerCase();
      if (!proc) {
        errors.push({
          row: rowOf(e.index),
          reason: `Op ${opNo}: Process is required`
        });
      } else if (lk.processAmbiguous.has(proc)) {
        errors.push({
          row: rowOf(e.index),
          reason: `Op ${opNo}: Process name is ambiguous`
        });
      } else if (!lk.processMap.has(proc)) {
        errors.push({
          row: rowOf(e.index),
          reason: `Op ${opNo}: Process "${text(e.record.process)}" not found`
        });
      }

      const wc = text(e.record.workCenter).toLowerCase();
      if (wc) {
        if (lk.workCenterAmbiguous.has(wc)) {
          errors.push({
            row: rowOf(e.index),
            reason: `Op ${opNo}: Work Center name is ambiguous`
          });
        } else if (!lk.workCenterMap.has(wc)) {
          errors.push({
            row: rowOf(e.index),
            reason: `Op ${opNo}: Work Center "${text(e.record.workCenter)}" not found`
          });
        }
      }

      // In-house operations need time units.
      const opType =
        normalizeOperationType(text(e.record.operationType)) || "Process";

      // The supplier of an Outside Processing operation must offer its
      // process; before, an unmatched one left the operation without a
      // supplier and no report.
      const supplierName = text(e.record.supplier);
      if (supplierName) {
        const supplierId = lk.supplierMap.get(supplierName.toLowerCase());
        const processId = lk.processMap.get(proc);
        if (opType !== "Outside Processing") {
          errors.push({
            row: rowOf(e.index),
            reason: `Op ${opNo}: Operation Supplier is only for Outside Processing operations`
          });
        } else if (!supplierId) {
          errors.push({
            row: rowOf(e.index),
            reason: `Op ${opNo}: Operation Supplier "${supplierName}" not found`
          });
        } else if (
          processId &&
          !lk.supplierProcessMap.has(supplierProcessKey(supplierId, processId))
        ) {
          errors.push({
            row: rowOf(e.index),
            reason: `Op ${opNo}: Operation Supplier "${supplierName}" has no "${text(e.record.process)}" process`
          });
        }
      }

      if (opType !== "Outside Processing") {
        if (
          !text(e.record.setupUnit) ||
          !text(e.record.laborUnit) ||
          !text(e.record.machineUnit)
        ) {
          errors.push({
            row: rowOf(e.index),
            reason: `Op ${opNo}: In-house operations require Setup, Labor, and Machine units`
          });
        }
      }
    }

    // BOM lines
    for (const e of bucket.bom) {
      const componentId = text(e.record.componentId);
      if (!componentId) {
        errors.push({
          row: rowOf(e.index),
          reason: "BOM row is missing Material ID"
        });
        continue;
      }
      const compKey = key(componentId, text(e.record.componentRevision));
      if (!lk.itemMap.has(compKey) && !lk.fileCreatedParts.has(compKey)) {
        errors.push({
          row: rowOf(e.index),
          reason: `Material ${componentId} rev ${text(e.record.componentRevision) || "0"} not found`
        });
      }
      if (num(e.record.quantity) === undefined) {
        errors.push({
          row: rowOf(e.index),
          reason: "BOM row has an invalid Quantity"
        });
      }
      const uom = text(e.record.unitOfMeasureCode);
      if (uom && !lk.uomSet.has(uom)) {
        errors.push({
          row: rowOf(e.index),
          reason: `Unit of Measure "${uom}" not found`
        });
      }
    }

    // STEP / TOOL / PARAM must reference a known Op No within this version.
    for (const e of bucket.step) {
      const opNo = text(e.record.opNo);
      if (!opNos.has(opNo)) {
        errors.push({
          row: rowOf(e.index),
          reason: `STEP references unknown Op No "${opNo}"`
        });
      }
      if (!text(e.record.stepName)) {
        errors.push({
          row: rowOf(e.index),
          reason: "STEP row is missing Name"
        });
      }
      const stepType = text(e.record.stepType) || "Task";
      if (!(STEP_TYPES as readonly string[]).includes(stepType)) {
        errors.push({
          row: rowOf(e.index),
          reason: `Invalid Step Type "${stepType}"`
        });
      }
      if (stepType === "Measurement" && !text(e.record.stepUnitOfMeasureCode)) {
        errors.push({
          row: rowOf(e.index),
          reason: "Measurement step requires a Step Unit of Measure"
        });
      }
      if (stepType === "List" && !text(e.record.stepListValues)) {
        errors.push({
          row: rowOf(e.index),
          reason: "List step requires Step List Values"
        });
      }
    }
    for (const e of bucket.tool) {
      const opNo = text(e.record.opNo);
      if (!opNos.has(opNo)) {
        errors.push({
          row: rowOf(e.index),
          reason: `TOOL references unknown Op No "${opNo}"`
        });
      }
      const toolId = text(e.record.toolId);
      if (!toolId) {
        errors.push({
          row: rowOf(e.index),
          reason: "TOOL row is missing Tool ID"
        });
      } else {
        const toolKey = key(toolId, text(e.record.toolRevision));
        if (!lk.itemMap.has(toolKey) && !lk.fileCreatedParts.has(toolKey)) {
          errors.push({
            row: rowOf(e.index),
            reason: `Tool ${toolId} rev ${text(e.record.toolRevision) || "0"} not found`
          });
        }
      }
      if (num(e.record.toolQuantity) === undefined) {
        errors.push({
          row: rowOf(e.index),
          reason: "TOOL row has an invalid Quantity"
        });
      }
    }
    for (const e of bucket.param) {
      const opNo = text(e.record.opNo);
      if (!opNos.has(opNo)) {
        errors.push({
          row: rowOf(e.index),
          reason: `PARAM references unknown Op No "${opNo}"`
        });
      }
      if (!text(e.record.paramKey)) {
        errors.push({
          row: rowOf(e.index),
          reason: "PARAM row is missing Key"
        });
      }
      if (!text(e.record.paramValue)) {
        errors.push({
          row: rowOf(e.index),
          reason: "PARAM row is missing Value"
        });
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// write (one transaction per part group → atomic per part, ADR-0001)
// ---------------------------------------------------------------------------

/**
 * Writes one part's group in its own transaction: the PART row's item, then its
 * materials, operations, steps, tools and parameters.
 */
async function writeGroup(
  db: Kysely<KyselyDatabase>,
  g: Group,
  ctx: {
    companyId: string;
    userId: string;
    itemMap: Map<string, ItemInfo>;
    processMap: Map<string, string>;
    workCenterMap: Map<string, string>;
    supplierMap: Map<string, string>;
    supplierProcessMap: Map<string, string>;
  }
): Promise<{
  // Whether the PART row created the item (false: it already existed); null
  // when the group has no PART row.
  partCreated: boolean | null;
  rowsInserted: number;
  skippedRows: Array<{ index: number; version: string }>;
}> {
  const { companyId, userId } = ctx;
  const now = () => datetime.timestamp();

  return await inTransaction(db, async (trx) => {
    let partCreated: boolean | null = null;
    let rowsInserted = 0;
    const skippedRows: Array<{ index: number; version: string }> = [];

    // Resolve (or create) the parent item.
    let parentItemId: string;
    if (g.partRow) {
      const r = g.partRow.record;
      const inserted = await trx
        .insertInto("item")
        .values([
          {
            readableId: g.readableId,
            revision: g.revision || "0",
            name: text(r.name) || g.readableId,
            mpn: text(r.mpn) || undefined,
            type: "Part",
            companyId,
            active: text(r.active).toLowerCase() !== "false",
            replenishmentSystem: text(r.replenishmentSystem) || "Buy and Make",
            defaultMethodType: text(r.defaultMethodType) || undefined,
            itemTrackingType: text(r.itemTrackingType) || "Inventory",
            unitOfMeasureCode: text(r.unitOfMeasureCode) || "EA",
            createdAt: now(),
            createdBy: userId
          } as never
        ])
        // Re-running the same file upserts the item rather than duplicating it.
        .onConflict((oc) =>
          oc.constraint("item_unique").doUpdateSet({
            updatedAt: now(),
            updatedBy: userId
          } as never)
        )
        // xmax = 0 only on a freshly inserted row, not on a conflict update.
        .returning(["id", sql<boolean>`xmax = 0`.as("created")])
        .execute();
      parentItemId = inserted[0]!.id;
      partCreated = Boolean(inserted[0]!.created);

      // The makeMethod Draft v1 is created by the AFTER INSERT trigger on item.
      // The part row links to the item by readableId (part.id = item.readableId).
      await trx
        .insertInto("part")
        .values([
          {
            id: g.readableId,
            companyId,
            approved: true,
            createdAt: now(),
            createdBy: userId
          } as never
        ])
        .onConflict((oc) => oc.columns(["id", "companyId"]).doNothing())
        .execute();

      // The lead time and unit cost the PART row carries, written as the
      // part import writes them.
      const extras = emptyItemExtras();
      collectItemExtras(extras, parentItemId, r);
      await writeItemExtras(trx, extras, companyId, userId);
    } else {
      const parent = ctx.itemMap.get(key(g.readableId, g.revision));
      parentItemId = parent!.id;
    }

    for (const [version, bucket] of g.versions) {
      const makeMethodId = await ensureMakeMethod(
        trx,
        parentItemId,
        version,
        companyId,
        userId
      );

      // Create-only: fill a version only if it has no method content yet.
      const hasMaterial = await trx
        .selectFrom("methodMaterial")
        .select("id")
        .where("makeMethodId", "=", makeMethodId)
        .limit(1)
        .executeTakeFirst();
      const hasOperation = await trx
        .selectFrom("methodOperation")
        .select("id")
        .where("makeMethodId", "=", makeMethodId)
        .limit(1)
        .executeTakeFirst();
      if (hasMaterial || hasOperation) {
        for (const e of [
          ...bucket.bom,
          ...bucket.bop,
          ...bucket.step,
          ...bucket.tool,
          ...bucket.param
        ]) {
          skippedRows.push({ index: e.index, version });
        }
        continue;
      }

      // --- materials (BOM), in file row order ---
      let order = 1;
      for (const e of bucket.bom) {
        const r = e.record;
        const component = await resolveItem(
          trx,
          companyId,
          text(r.componentId),
          text(r.componentRevision),
          ctx.itemMap
        );
        const methodType = component.defaultMethodType ?? "Pull from Inventory";
        const sourcingType = component.sourcingType ?? "Specified";

        let materialMakeMethodId: string | null = null;
        if (methodType === "Make to Order") {
          materialMakeMethodId = await currentMakeMethodId(
            trx,
            component.id,
            companyId
          );
        }

        const storageUnitIds = await seedStorageUnitIds(trx, component.id);

        await trx
          .insertInto("methodMaterial")
          .values([
            {
              makeMethodId,
              itemId: component.id,
              itemType: component.type,
              methodType,
              sourcingType,
              materialMakeMethodId,
              quantity: num(r.quantity) ?? 1,
              unitOfMeasureCode: text(r.unitOfMeasureCode) || "EA",
              order,
              kit: bool(r.kit),
              storageUnitIds,
              companyId,
              createdBy: userId,
              createdAt: now()
            } as never
          ])
          .execute();
        order++;
        rowsInserted++;
      }

      // --- operations (BOP), keyed by Op No ---
      const opIdByNo = new Map<string, string>();
      let opIndex = 1;
      for (const e of bucket.bop) {
        const r = e.record;
        const opNo = text(r.opNo);
        const opType =
          normalizeOperationType(text(r.operationType)) || "Process";
        const processId = ctx.processMap.get(text(r.process).toLowerCase())!;
        const workCenterId = text(r.workCenter)
          ? ctx.workCenterMap.get(text(r.workCenter).toLowerCase())
          : undefined;

        // Validation made sure a named supplier offers the process.
        const supplierId = text(r.supplier)
          ? ctx.supplierMap.get(text(r.supplier).toLowerCase())
          : undefined;
        const operationSupplierProcessId =
          opType === "Outside Processing" && supplierId
            ? ctx.supplierProcessMap.get(
                supplierProcessKey(supplierId, processId)
              )
            : undefined;

        const inserted = await trx
          .insertInto("methodOperation")
          .values([
            {
              makeMethodId,
              order: num(opNo) ?? opIndex,
              operationOrder: text(r.operationOrder) || "After Previous",
              operationType: opType,
              processId,
              workCenterId,
              description: text(r.operationDescription),
              setupUnit: text(r.setupUnit) || undefined,
              setupTime: num(r.setupTime) ?? 0,
              laborUnit: text(r.laborUnit) || undefined,
              laborTime: num(r.laborTime) ?? 0,
              machineUnit: text(r.machineUnit) || undefined,
              machineTime: num(r.machineTime) ?? 0,
              operationSupplierProcessId,
              operationMinimumCost: num(r.operationMinimumCost),
              operationUnitCost: num(r.operationUnitCost),
              operationLeadTime: num(r.operationLeadTime),
              workInstruction: {},
              companyId,
              createdBy: userId,
              createdAt: now()
            } as never
          ])
          .returning(["id"])
          .execute();
        opIdByNo.set(opNo, inserted[0]!.id);
        opIndex++;
        rowsInserted++;
      }

      // --- steps / tools / parameters per operation ---
      const sortByOp = new Map<string, number>();
      for (const e of bucket.step) {
        const r = e.record;
        const operationId = opIdByNo.get(text(r.opNo))!;
        const sortOrder = (sortByOp.get(operationId) ?? 0) + 1;
        sortByOp.set(operationId, sortOrder);
        const stepType = text(r.stepType) || "Task";
        await trx
          .insertInto("methodOperationStep")
          .values([
            {
              operationId,
              name: text(r.stepName),
              description: plainTextToTiptap(text(r.stepDescription)),
              type: stepType,
              required: bool(r.stepRequired),
              sortOrder,
              unitOfMeasureCode:
                stepType === "Measurement"
                  ? text(r.stepUnitOfMeasureCode) || undefined
                  : undefined,
              minValue: num(r.stepMinValue),
              maxValue: num(r.stepMaxValue),
              listValues:
                stepType === "List" && text(r.stepListValues)
                  ? text(r.stepListValues)
                      .split("|")
                      .map((v) => v.trim())
                      .filter(Boolean)
                  : undefined,
              companyId,
              createdBy: userId,
              createdAt: now()
            } as never
          ])
          .execute();
        rowsInserted++;
      }

      for (const e of bucket.tool) {
        const r = e.record;
        const operationId = opIdByNo.get(text(r.opNo))!;
        const tool = await resolveItem(
          trx,
          companyId,
          text(r.toolId),
          text(r.toolRevision),
          ctx.itemMap
        );
        await trx
          .insertInto("methodOperationTool")
          .values([
            {
              operationId,
              toolId: tool.id,
              quantity: num(r.toolQuantity) ?? 1,
              companyId,
              createdBy: userId,
              createdAt: now()
            } as never
          ])
          .execute();
        rowsInserted++;
      }

      for (const e of bucket.param) {
        const r = e.record;
        const operationId = opIdByNo.get(text(r.opNo))!;
        await trx
          .insertInto("methodOperationParameter")
          .values([
            {
              operationId,
              key: text(r.paramKey),
              value: text(r.paramValue),
              companyId,
              createdBy: userId,
              createdAt: now()
            } as never
          ])
          .execute();
        rowsInserted++;
      }
    }

    return { partCreated, rowsInserted, skippedRows };
  });
}

// ---------------------------------------------------------------------------
// transaction-scoped resolution helpers
// ---------------------------------------------------------------------------

// Resolve an item id by readableId + revision. Falls back to a DB lookup for a
// part created earlier in this same file (not present in the prefetched map).
async function resolveItem(
  trx: Transaction<KyselyDatabase>,
  companyId: string,
  readableId: string,
  revision: string,
  itemMap: Map<string, ItemInfo>
): Promise<ItemInfo> {
  const k = key(readableId, revision);
  const cached = itemMap.get(k);
  if (cached) return cached;

  const row = await trx
    .selectFrom("item")
    .select(["id", "type", "defaultMethodType", "sourcingType"])
    .where("companyId", "=", companyId)
    .where("readableId", "=", readableId)
    .where("revision", "=", revision || "0")
    .limit(1)
    .executeTakeFirst();
  if (!row) {
    throw new Error(`Item ${readableId} rev ${revision || "0"} not found`);
  }
  const info: ItemInfo = {
    id: row.id,
    type: row.type,
    defaultMethodType: row.defaultMethodType ?? null,
    sourcingType: row.sourcingType ?? null
  };
  itemMap.set(k, info);
  return info;
}

// The part's current (active, else highest non-archived) make method id —
// mirrors the activeMakeMethods view ranking.
async function currentMakeMethodId(
  trx: Transaction<KyselyDatabase>,
  itemId: string,
  companyId: string
): Promise<string | null> {
  const rows = await trx
    .selectFrom("makeMethod")
    .select(["id", "version", "status"])
    .where("itemId", "=", itemId)
    .where("companyId", "=", companyId)
    .where("status", "!=", "Archived")
    .execute();
  if (rows.length === 0) return null;
  rows.sort((a, b) => {
    const aActive = a.status === "Active" ? 0 : 1;
    const bActive = b.status === "Active" ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return Number(b.version) - Number(a.version);
  });
  return rows[0]!.id;
}

// Resolve the target make method for a version. Blank → the part's current
// method (the trigger-created Draft v1 for a new part). Explicit → find-or-create
// that version as a Draft; never auto-activate.
async function ensureMakeMethod(
  trx: Transaction<KyselyDatabase>,
  itemId: string,
  version: string,
  companyId: string,
  userId: string
): Promise<string> {
  if (!version.trim()) {
    const current = await currentMakeMethodId(trx, itemId, companyId);
    if (current) return current;
    // No make method yet (e.g. a non-trigger item type) — create Draft v1.
    const inserted = await trx
      .insertInto("makeMethod")
      .values([
        {
          itemId,
          companyId,
          version: 1,
          status: "Draft",
          createdBy: userId,
          createdAt: datetime.timestamp()
        } as never
      ])
      .returning(["id"])
      .execute();
    return inserted[0]!.id;
  }

  const versionNumber = num(version) ?? 1;
  const existing = await trx
    .selectFrom("makeMethod")
    .select(["id"])
    .where("itemId", "=", itemId)
    .where("companyId", "=", companyId)
    .where("version", "=", versionNumber)
    .limit(1)
    .executeTakeFirst();
  if (existing) return existing.id;

  const inserted = await trx
    .insertInto("makeMethod")
    .values([
      {
        itemId,
        companyId,
        version: versionNumber,
        status: "Draft",
        createdBy: userId,
        createdAt: datetime.timestamp()
      } as never
    ])
    .returning(["id"])
    .execute();
  return inserted[0]!.id;
}

// Seed storageUnitIds from the component's pickMethod default bins (mirrors
// resolveMethodMaterialStorageUnitIds in items.service.ts).
async function seedStorageUnitIds(
  trx: Transaction<KyselyDatabase>,
  itemId: string
): Promise<Record<string, string>> {
  const current: Record<string, string> = {};
  const rows = await trx
    .selectFrom("pickMethod")
    .select(["locationId", "defaultStorageUnitId"])
    .where("itemId", "=", itemId)
    .execute();
  for (const row of rows) {
    if (
      row.locationId &&
      row.defaultStorageUnitId &&
      !current[row.locationId]
    ) {
      current[row.locationId] = row.defaultStorageUnitId;
    }
  }
  return current;
}
