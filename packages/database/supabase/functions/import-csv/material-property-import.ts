import { Kysely, Transaction } from "npm:kysely@0.27.6";
import { DB } from "../lib/database.ts";

type Rec = Record<string, string>;

type Summary = {
  inserted: number;
  updated: number;
  errors: Array<{ row: number; reason: string }>;
  skipped: Array<{ row: number; reason: string }>;
};

export type MaterialPropertyTable =
  | "materialSubstance"
  | "materialForm"
  | "materialFinish"
  | "materialGrade"
  | "materialType"
  | "materialDimension";

const norm = (s: string | undefined) => (s ?? "").trim().toLowerCase();

const isMetricValue = (s: string | undefined) => {
  const v = norm(s);
  return v === "true" || v === "1" || v === "yes" || v === "y" || v === "metric";
};

const SUBSTANCE_UNMATCHED =
  "Substance could not be matched — make sure the substance exists and is mapped in the wizard";
const SHAPE_UNMATCHED =
  "Shape could not be matched — make sure the shape exists and is mapped in the wizard";

type ParentSpec = {
  field: "materialSubstanceId" | "materialFormId";
  table: "materialSubstance" | "materialForm";
  reason: string;
};

type TableConfig = {
  validate: (r: Rec) => string | null;
  keysOf: (r: Rec) => string[];
  loadExistingKeys: (
    trx: Transaction<DB>,
    companyId: string
  ) => Promise<Set<string>>;
  insert: (
    trx: Transaction<DB>,
    rows: Rec[],
    companyId: string,
    userId: string
  ) => Promise<number>;
  parents?: ParentSpec[];
};

const loadParentIds = async (
  trx: Transaction<DB>,
  table: "materialSubstance" | "materialForm",
  companyId: string
): Promise<Set<string>> => {
  const rows =
    table === "materialSubstance"
      ? await trx
          .selectFrom("materialSubstance")
          .select(["id"])
          .where((eb) =>
            eb.or([
              eb("companyId", "=", companyId),
              eb("companyId", "is", null),
            ])
          )
          .execute()
      : await trx
          .selectFrom("materialForm")
          .select(["id"])
          .where((eb) =>
            eb.or([
              eb("companyId", "=", companyId),
              eb("companyId", "is", null),
            ])
          )
          .execute();
  return new Set(rows.map((x) => x.id));
};

const CONFIGS: Record<MaterialPropertyTable, TableConfig> = {
  materialSubstance: {
    validate: (r) =>
      !r.name?.trim()
        ? "Name is required"
        : !r.code?.trim()
          ? "Code is required"
          : null,
    keysOf: (r) => [`c:${norm(r.code)}`],
    loadExistingKeys: async (trx, companyId) => {
      const rows = await trx
        .selectFrom("materialSubstance")
        .select(["code"])
        .where((eb) =>
          eb.or([eb("companyId", "=", companyId), eb("companyId", "is", null)])
        )
        .execute();
      return new Set(rows.map((x) => `c:${norm(x.code ?? "")}`));
    },
    insert: async (trx, rows, companyId, userId) => {
      const now = new Date().toISOString();
      const inserted = await trx
        .insertInto("materialSubstance")
        .values(
          rows.map(
            (r) =>
              ({
                name: r.name.trim(),
                code: r.code.trim(),
                companyId,
                createdBy: userId,
                createdAt: now,
              }) as never
          )
        )
        .onConflict((oc) => oc.doNothing())
        .returning(["id"])
        .execute();
      return inserted.length;
    },
  },
  materialForm: {
    validate: (r) =>
      !r.name?.trim()
        ? "Name is required"
        : !r.code?.trim()
          ? "Code is required"
          : null,
    keysOf: (r) => [`c:${norm(r.code)}`],
    loadExistingKeys: async (trx, companyId) => {
      const rows = await trx
        .selectFrom("materialForm")
        .select(["code"])
        .where((eb) =>
          eb.or([eb("companyId", "=", companyId), eb("companyId", "is", null)])
        )
        .execute();
      return new Set(rows.map((x) => `c:${norm(x.code ?? "")}`));
    },
    insert: async (trx, rows, companyId, userId) => {
      const now = new Date().toISOString();
      const inserted = await trx
        .insertInto("materialForm")
        .values(
          rows.map(
            (r) =>
              ({
                name: r.name.trim(),
                code: r.code.trim(),
                companyId,
                createdBy: userId,
                createdAt: now,
              }) as never
          )
        )
        .onConflict((oc) => oc.doNothing())
        .returning(["id"])
        .execute();
      return inserted.length;
    },
  },
  materialFinish: {
    parents: [
      {
        field: "materialSubstanceId",
        table: "materialSubstance",
        reason: SUBSTANCE_UNMATCHED,
      },
    ],
    validate: (r) =>
      !r.name?.trim()
        ? "Name is required"
        : !r.materialSubstanceId?.trim()
          ? SUBSTANCE_UNMATCHED
          : null,
    keysOf: (r) => [`${r.materialSubstanceId.trim()}:${norm(r.name)}`],
    loadExistingKeys: async (trx, companyId) => {
      const rows = await trx
        .selectFrom("materialFinish")
        .select(["materialSubstanceId", "name"])
        .where((eb) =>
          eb.or([eb("companyId", "=", companyId), eb("companyId", "is", null)])
        )
        .execute();
      return new Set(rows.map((x) => `${x.materialSubstanceId}:${norm(x.name)}`));
    },
    insert: async (trx, rows, companyId) => {
      const inserted = await trx
        .insertInto("materialFinish")
        .values(
          rows.map(
            (r) =>
              ({
                name: r.name.trim(),
                materialSubstanceId: r.materialSubstanceId.trim(),
                companyId,
              }) as never
          )
        )
        .onConflict((oc) => oc.doNothing())
        .returning(["id"])
        .execute();
      return inserted.length;
    },
  },
  materialGrade: {
    parents: [
      {
        field: "materialSubstanceId",
        table: "materialSubstance",
        reason: SUBSTANCE_UNMATCHED,
      },
    ],
    validate: (r) =>
      !r.name?.trim()
        ? "Name is required"
        : !r.materialSubstanceId?.trim()
          ? SUBSTANCE_UNMATCHED
          : null,
    keysOf: (r) => [`${r.materialSubstanceId.trim()}:${norm(r.name)}`],
    loadExistingKeys: async (trx, companyId) => {
      const rows = await trx
        .selectFrom("materialGrade")
        .select(["materialSubstanceId", "name"])
        .where((eb) =>
          eb.or([eb("companyId", "=", companyId), eb("companyId", "is", null)])
        )
        .execute();
      return new Set(rows.map((x) => `${x.materialSubstanceId}:${norm(x.name)}`));
    },
    insert: async (trx, rows, companyId) => {
      const inserted = await trx
        .insertInto("materialGrade")
        .values(
          rows.map(
            (r) =>
              ({
                name: r.name.trim(),
                materialSubstanceId: r.materialSubstanceId.trim(),
                companyId,
              }) as never
          )
        )
        .onConflict((oc) => oc.doNothing())
        .returning(["id"])
        .execute();
      return inserted.length;
    },
  },
  materialType: {
    parents: [
      {
        field: "materialSubstanceId",
        table: "materialSubstance",
        reason: SUBSTANCE_UNMATCHED,
      },
      {
        field: "materialFormId",
        table: "materialForm",
        reason: SHAPE_UNMATCHED,
      },
    ],
    validate: (r) =>
      !r.name?.trim()
        ? "Name is required"
        : !r.code?.trim()
          ? "Code is required"
          : !r.materialSubstanceId?.trim()
            ? SUBSTANCE_UNMATCHED
            : !r.materialFormId?.trim()
              ? SHAPE_UNMATCHED
              : null,
    keysOf: (r) => {
      const sub = r.materialSubstanceId.trim();
      const form = r.materialFormId.trim();
      return [`${sub}:${form}:c:${norm(r.code)}`, `${sub}:${form}:n:${norm(r.name)}`];
    },
    loadExistingKeys: async (trx, companyId) => {
      const rows = await trx
        .selectFrom("materialType")
        .select(["materialSubstanceId", "materialFormId", "code", "name"])
        .where((eb) =>
          eb.or([eb("companyId", "=", companyId), eb("companyId", "is", null)])
        )
        .execute();
      const set = new Set<string>();
      for (const x of rows) {
        set.add(
          `${x.materialSubstanceId}:${x.materialFormId}:c:${norm(x.code ?? "")}`
        );
        set.add(`${x.materialSubstanceId}:${x.materialFormId}:n:${norm(x.name)}`);
      }
      return set;
    },
    insert: async (trx, rows, companyId) => {
      const inserted = await trx
        .insertInto("materialType")
        .values(
          rows.map(
            (r) =>
              ({
                name: r.name.trim(),
                code: r.code.trim(),
                materialSubstanceId: r.materialSubstanceId.trim(),
                materialFormId: r.materialFormId.trim(),
                companyId,
              }) as never
          )
        )
        .onConflict((oc) => oc.doNothing())
        .returning(["id"])
        .execute();
      return inserted.length;
    },
  },
  materialDimension: {
    parents: [
      {
        field: "materialFormId",
        table: "materialForm",
        reason: SHAPE_UNMATCHED,
      },
    ],
    validate: (r) =>
      !r.name?.trim()
        ? "Name is required"
        : !r.materialFormId?.trim()
          ? SHAPE_UNMATCHED
          : null,
    keysOf: (r) => [`${r.materialFormId.trim()}:${norm(r.name)}`],
    loadExistingKeys: async (trx, companyId) => {
      const rows = await trx
        .selectFrom("materialDimension")
        .select(["materialFormId", "name"])
        .where((eb) =>
          eb.or([eb("companyId", "=", companyId), eb("companyId", "is", null)])
        )
        .execute();
      return new Set(rows.map((x) => `${x.materialFormId}:${norm(x.name)}`));
    },
    insert: async (trx, rows, companyId) => {
      const inserted = await trx
        .insertInto("materialDimension")
        .values(
          rows.map(
            (r) =>
              ({
                name: r.name.trim(),
                materialFormId: r.materialFormId.trim(),
                isMetric: isMetricValue(r.isMetric),
                companyId,
              }) as never
          )
        )
        .onConflict((oc) => oc.doNothing())
        .returning(["id"])
        .execute();
      return inserted.length;
    },
  },
};

export async function importMaterialProperties(
  db: Kysely<DB>,
  {
    table,
    mappedRecords,
    companyId,
    userId,
    summary,
  }: {
    table: MaterialPropertyTable;
    mappedRecords: Rec[];
    companyId: string;
    userId: string;
    summary: Summary;
  }
) {
  const config = CONFIGS[table];

  await db.transaction().execute(async (trx) => {
    const existingKeys = await config.loadExistingKeys(trx, companyId);

    const parentSpecs = config.parents ?? [];
    const parentIds = new Map<string, Set<string>>();
    for (const parentTable of new Set(parentSpecs.map((p) => p.table))) {
      parentIds.set(parentTable, await loadParentIds(trx, parentTable, companyId));
    }

    const seenKeys = new Set<string>();
    const accepted: Rec[] = [];

    for (const [rowIndex, record] of mappedRecords.entries()) {
      const reason = config.validate(record);
      if (reason) {
        summary.errors.push({ row: rowIndex, reason });
        continue;
      }

      const foreignParent = parentSpecs.find(
        (p) => !parentIds.get(p.table)?.has((record[p.field] ?? "").trim())
      );
      if (foreignParent) {
        summary.errors.push({ row: rowIndex, reason: foreignParent.reason });
        continue;
      }

      const keys = config.keysOf(record);
      if (keys.some((k) => existingKeys.has(k))) {
        summary.skipped.push({ row: rowIndex, reason: "Already exists — skipped" });
        continue;
      }
      if (keys.some((k) => seenKeys.has(k))) {
        summary.skipped.push({
          row: rowIndex,
          reason: "Duplicate row in file — skipped",
        });
        continue;
      }

      keys.forEach((k) => seenKeys.add(k));
      accepted.push(record);
    }

    console.log({
      function: "import-material-properties",
      table,
      totalRecords: mappedRecords.length,
      accepted: accepted.length,
      skipped: summary.skipped.length,
      errors: summary.errors.length,
    });

    if (accepted.length > 0) {
      summary.inserted += await config.insert(trx, accepted, companyId, userId);
    }
  });
}
