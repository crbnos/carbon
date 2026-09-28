import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { datetime } from "@carbon/utils";
import { sql } from "kysely";
import { z } from "zod";

// Drag-sort persistence for every child list (document lines, assembly steps,
// change-notice actions). Not a `*.service.ts` on purpose: a generic
// "reorder any table" function must never be scanned into the API/MCP
// manifest — the per-table wrappers in each module's service are the contract.
//
// Kysely bypasses RLS, and the ids come from the request body, so the
// companyId AND parent-document predicates are the only thing stopping a
// request made through one document's route from reordering another
// document's rows. Both are mandatory arguments, not options.

type PublicTables = Database["public"]["Tables"];
type Row<T extends keyof PublicTables> = PublicTables[T]["Row"];

type SortColumnName = "sortOrder" | "order";
type RequiredColumns = "id" | "companyId" | "updatedBy" | "updatedAt";

/** Columns of `T` holding a text value (ids, foreign keys). */
type TextColumn<T extends keyof PublicTables> = {
  [K in keyof Row<T>]: Row<T>[K] extends string | null ? K : never;
}[keyof Row<T>] &
  string;

/** Tables with an `id` and a `companyId` — anything a parent can be. */
export type TenantTable = {
  [T in keyof PublicTables]: "id" | "companyId" extends keyof Row<T>
    ? T
    : never;
}[keyof PublicTables];

/** Tables a drag-sort can reorder: tenant key, audit columns and a sort column. */
export type SortableTable = {
  [T in keyof PublicTables]: RequiredColumns extends keyof Row<T>
    ? [Extract<keyof Row<T>, SortColumnName>] extends [never]
      ? never
      : T
    : never;
}[keyof PublicTables];

export type SortColumn<T extends SortableTable> = Extract<
  keyof Row<T>,
  SortColumnName
>;

export type ParentColumn<T extends keyof PublicTables> = Exclude<
  TextColumn<T>,
  RequiredColumns | "createdBy"
>;

/**
 * How the rows are tied to the document whose route is reordering them.
 * `id` when the row carries the parent's id itself (`quoteLine.quoteId`);
 * `via` when it is one hop away (`assemblyInstructionStepMaterial.stepId` →
 * `assemblyInstructionStep.assemblyInstructionId`).
 */
export type SortParent<T extends SortableTable, P extends TenantTable> =
  | { column: ParentColumn<T>; id: string }
  | {
      column: ParentColumn<T>;
      via: { table: P; column: ParentColumn<P>; id: string };
    };

export type UpdateSortOrderArgs<
  T extends SortableTable,
  P extends TenantTable = TenantTable
> = {
  table: T;
  column: SortColumn<T>;
  companyId: string;
  userId: string;
  parent: SortParent<T, P>;
  updates: { id: string; sortOrder: number }[];
};

/**
 * The single statement behind `updateSortOrder`, exported so its SQL can be
 * pinned by compiling it (no database needed).
 */
export function buildSortOrderUpdate<
  T extends SortableTable,
  P extends TenantTable = TenantTable
>(args: UpdateSortOrderArgs<T, P> & { updatedAt: string }) {
  const { table, column, companyId, userId, parent, updates, updatedAt } = args;

  const values = sql.join(
    updates.map(
      ({ id, sortOrder }) => sql`(${id}::text, ${sortOrder}::numeric)`
    )
  );

  const parentPredicate =
    "via" in parent
      ? sql`${sql.ref(`t.${parent.column}`)} IN (SELECT p."id" FROM ${sql.table(parent.via.table)} AS p WHERE ${sql.ref(`p.${parent.via.column}`)} = ${parent.via.id} AND p."companyId" = ${companyId})`
      : sql`${sql.ref(`t.${parent.column}`)} = ${parent.id}`;

  return sql<{
    id: string;
  }>`UPDATE ${sql.table(table)} AS t SET ${sql.ref(column)} = v."sortOrder", "updatedBy" = ${userId}, "updatedAt" = ${updatedAt} FROM (VALUES ${values}) AS v("id", "sortOrder") WHERE t."id" = v."id" AND t."companyId" = ${companyId} AND ${parentPredicate} RETURNING t."id"`;
}

/**
 * Persist a drag-sort in ONE `UPDATE … FROM (VALUES …)`, scoped to the company
 * and the parent document. All-or-nothing: if any id is outside that scope (or
 * missing, or repeated) fewer rows come back than were sent, and the
 * transaction rolls the whole reorder back.
 *
 * Takes the Kysely handle as an argument — never builds one (see AGENTS.md:
 * service files are browser-bundled). Throws; the route try/catches it.
 */
export async function updateSortOrder<
  T extends SortableTable,
  P extends TenantTable = TenantTable
>(db: Kysely<KyselyDatabase>, args: UpdateSortOrderArgs<T, P>) {
  if (args.updates.length === 0) return;

  const parentId = "via" in args.parent ? args.parent.via.id : args.parent.id;
  if (!parentId) throw new Error(`${args.table}: missing parent id`);

  const query = buildSortOrderUpdate({
    ...args,
    updatedAt: datetime.timestamp()
  });

  await db.transaction().execute(async (trx) => {
    const { rows } = await query.execute(trx);
    if (rows.length !== args.updates.length) {
      throw new Error(
        `${args.table}: ${args.updates.length - rows.length} of ${args.updates.length} rows are not on this document`
      );
    }
  });
}

// The drag-sort UI posts `updates` as a JSON map of row id → new sort order.
// A value must be a real finite number (or a numeric string): `Number()` turns
// garbage into NaN and "" into 0, and either would be written as a sort order.
const sortOrderValue = z.union([
  z.number(),
  z.string().trim().min(1).pipe(z.coerce.number())
]);
const sortOrderUpdatesValidator = z
  .record(z.string().min(1), sortOrderValue)
  .refine((map) => Object.keys(map).length > 0);

/**
 * Parse a reorder route's `updates` form field. Returns null when it is
 * missing, not JSON, empty, or carries a non-numeric sort order — the route
 * flashes an error instead of writing anything.
 */
export function parseSortOrderUpdates(
  formData: FormData
): { id: string; sortOrder: number }[] | null {
  const raw = formData.get("updates");
  if (typeof raw !== "string" || !raw) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = sortOrderUpdatesValidator.safeParse(json);
  if (!parsed.success) return null;
  return Object.entries(parsed.data).map(([id, sortOrder]) => ({
    id,
    sortOrder
  }));
}
