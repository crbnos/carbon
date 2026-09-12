import { Kysely, Transaction } from "npm:kysely@0.27.6";
import { DB } from "../lib/database.ts";

type Rec = Record<string, string>;

type Summary = {
  inserted: number;
  updated: number;
  errors: Array<{ row: number; reason: string }>;
  skipped: Array<{ row: number; reason: string }>;
};

// Company-scoped configuration lookups: small, flat, name-keyed tables a
// customer fills in once during onboarding. They share create-only,
// skip-duplicate semantics with the material-taxonomy imports
// (`material-property-import.ts`) rather than the id-mapped upsert the
// workCenter/process/item paths use, because none of them carries a natural
// external id — a customer's UoM list is a column of codes, not a keyed
// export. Every one of these tables has a UNIQUE (name, companyId) constraint,
// so a duplicate row would otherwise abort the whole transaction instead of
// reporting one skipped row.
export type ConfigLookupTable =
  | "unitOfMeasure"
  | "itemPostingGroup"
  | "storageType"
  | "scrapReason"
  | "department";

const norm = (s: string | undefined) => (s ?? "").trim().toLowerCase();

const requireName = (r: Rec) => (!r.name?.trim() ? "Name is required" : null);

type TableConfig = {
  // Row-level validation. Returns a reason string, or null when the row is fine.
  validate: (r: Rec) => string | null;
  // The natural keys used for both in-file dedup and match-against-existing.
  // A table with two unique constraints yields two keys, so a row colliding on
  // either is reported rather than dropped by the ON CONFLICT clause.
  keysOf: (r: Rec) => string[];
  // The same keys, read off a row already in the database.
  keysOfExisting: (r: {
    name: string | null;
    code?: string | null;
  }) => string[];
  // The columns to read off the mapped record, beyond the audit fields.
  values: (r: Rec) => Record<string, string>;
  // Set when the table carries a self-referencing parent applied in a second
  // pass (see `applyParents` below).
  parentField?: "parentDepartmentId";
};

// Exported for `config-lookup-import.test.ts` — the validation rules and
// dedup keys are the parts that fail silently.
export const CONFIGS: Record<ConfigLookupTable, TableConfig> = {
  unitOfMeasure: {
    validate: (r) => {
      if (!r.code?.trim()) return "Code is required";
      if (r.code.trim().length > 10)
        return "Code must be 10 characters or fewer";
      if (!r.name?.trim()) return "Name is required";
      if (r.name.trim().length > 50)
        return "Name must be 50 characters or fewer";
      return null;
    },
    // `code` and `name` are BOTH unique per company, so both are dedup keys —
    // importing "Each" against an existing EA/Each is a skip with a reason,
    // not a row silently swallowed by ON CONFLICT.
    keysOf: (r) => [`c:${norm(r.code)}`, `n:${norm(r.name)}`],
    keysOfExisting: (r) => [
      `c:${norm(r.code ?? "")}`,
      `n:${norm(r.name ?? "")}`
    ],
    values: (r) => ({ code: r.code.trim(), name: r.name.trim() })
  },
  itemPostingGroup: {
    validate: (r) => {
      const reason = requireName(r);
      if (reason) return reason;
      if (r.name.trim().length > 255)
        return "Name must be 255 characters or fewer";
      return null;
    },
    keysOf: (r) => [norm(r.name)],
    keysOfExisting: (r) => [norm(r.name ?? "")],
    values: (r) => {
      const values: Record<string, string> = { name: r.name.trim() };
      if (r.description?.trim()) values.description = r.description.trim();
      return values;
    }
  },
  storageType: {
    validate: requireName,
    keysOf: (r) => [norm(r.name)],
    keysOfExisting: (r) => [norm(r.name ?? "")],
    values: (r) => ({ name: r.name.trim() })
  },
  scrapReason: {
    validate: requireName,
    keysOf: (r) => [norm(r.name)],
    keysOfExisting: (r) => [norm(r.name ?? "")],
    values: (r) => ({ name: r.name.trim() })
  },
  department: {
    validate: requireName,
    keysOf: (r) => [norm(r.name)],
    keysOfExisting: (r) => [norm(r.name ?? "")],
    values: (r) => ({ name: r.name.trim() }),
    parentField: "parentDepartmentId"
  }
};

const loadExisting = async (
  trx: Kysely<DB> | Transaction<DB>,
  table: ConfigLookupTable,
  companyId: string
) => {
  const rows = await trx
    .selectFrom(table)
    .select(table === "unitOfMeasure" ? ["id", "name", "code"] : ["id", "name"])
    .where("companyId", "=", companyId)
    .execute();
  return rows as Array<{ id: string; name: string | null; code?: string }>;
};

// Parents are applied AFTER every insert, as individual UPDATEs outside the
// insert transaction, so a parent defined further down the same file still
// resolves and an unresolved or self-referencing parent reports one row error
// instead of rolling the whole import back. Mirrors the storage-unit parent
// pass in `index.ts`.
const applyParents = async (
  db: Kysely<DB>,
  table: ConfigLookupTable,
  parentField: "parentDepartmentId",
  pending: Array<{ row: number; name: string; parentName: string }>,
  companyId: string,
  summary: Summary
) => {
  if (pending.length === 0) return;

  const idsByName = new Map<string, string>();
  for (const row of await loadExisting(db, table, companyId)) {
    idsByName.set(norm(row.name ?? ""), row.id);
  }

  for (const { row, name, parentName } of pending) {
    const id = idsByName.get(norm(name));
    if (!id) continue;

    if (norm(parentName) === norm(name)) {
      summary.errors.push({ row, reason: "A record cannot be its own parent" });
      continue;
    }

    const parentId = idsByName.get(norm(parentName));
    if (!parentId) {
      summary.errors.push({
        row,
        reason: `Parent "${parentName}" was not found`
      });
      continue;
    }

    try {
      await db
        .updateTable(table)
        .set({ [parentField]: parentId } as never)
        .where("id", "=", id)
        .where("companyId", "=", companyId)
        .execute();
    } catch (err) {
      summary.errors.push({ row, reason: (err as Error).message });
    }
  }
};

export async function importConfigLookups(
  db: Kysely<DB>,
  {
    table,
    mappedRecords,
    companyId,
    userId,
    summary
  }: {
    table: ConfigLookupTable;
    mappedRecords: Rec[];
    companyId: string;
    userId: string;
    summary: Summary;
  }
) {
  const config = CONFIGS[table];
  const pendingParents: Array<{
    row: number;
    name: string;
    parentName: string;
  }> = [];

  await db.transaction().execute(async (trx) => {
    const existingKeys = new Set(
      (await loadExisting(trx, table, companyId)).flatMap(config.keysOfExisting)
    );

    const seenKeys = new Set<string>();
    const accepted: Rec[] = [];

    for (const [rowIndex, record] of mappedRecords.entries()) {
      const reason = config.validate(record);
      if (reason) {
        summary.errors.push({ row: rowIndex, reason });
        continue;
      }

      const keys = config.keysOf(record);
      if (keys.some((k) => existingKeys.has(k))) {
        summary.skipped.push({
          row: rowIndex,
          reason: "Already exists — skipped"
        });
        continue;
      }
      if (keys.some((k) => seenKeys.has(k))) {
        summary.skipped.push({
          row: rowIndex,
          reason: "Duplicate row in file — skipped"
        });
        continue;
      }

      for (const key of keys) seenKeys.add(key);
      accepted.push(record);

      if (config.parentField && record.parentName?.trim()) {
        pendingParents.push({
          row: rowIndex,
          name: record.name.trim(),
          parentName: record.parentName.trim()
        });
      }
    }

    console.log({
      function: "import-config-lookups",
      table,
      totalRecords: mappedRecords.length,
      accepted: accepted.length,
      skipped: summary.skipped.length,
      errors: summary.errors.length
    });

    if (accepted.length > 0) {
      const now = new Date().toISOString();
      const inserted = await trx
        .insertInto(table)
        .values(
          accepted.map(
            (r) =>
              ({
                ...config.values(r),
                companyId,
                createdBy: userId,
                createdAt: now
              }) as never
          )
        )
        .onConflict((oc) => oc.doNothing())
        .returning(["id"])
        .execute();
      summary.inserted += inserted.length;
    }
  });

  if (config.parentField) {
    await applyParents(
      db,
      table,
      config.parentField,
      pendingParents,
      companyId,
      summary
    );
  }
}
