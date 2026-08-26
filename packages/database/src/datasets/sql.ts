import type { PoolClient } from "pg";
import { sequences } from "../../supabase/functions/lib/seed.data.ts";
import type { Ctx } from "./types.ts";

export type Row = Record<string, unknown>;

type InsertOpts = {
  // "nothing" → ON CONFLICT DO NOTHING; any other string is used verbatim.
  onConflict?: "nothing" | string;
  returning?: string;
  // Set false to leave companyId / createdBy alone (reference data uses 'system').
  audit?: boolean;
};

const columnCache = new Map<string, Set<string>>();

export function quote(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

// Memoized information_schema lookup — turns a typo'd column into an immediate
// throw naming the table, instead of a Postgres error 200 statements later.
export async function columnsOf(
  client: PoolClient,
  table: string
): Promise<Set<string>> {
  const cached = columnCache.get(table);
  if (cached) return cached;
  const res = await client.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  );
  if (res.rows.length === 0) {
    throw new Error(`Seed: unknown table "${table}"`);
  }
  const cols = new Set(res.rows.map((r) => r.column_name));
  columnCache.set(table, cols);
  return cols;
}

// Columns present on both tables — used when copying method rows into job /
// quote shapes, so the copy can't drift when a migration adds a column.
export async function sharedColumns(
  client: PoolClient,
  source: string,
  target: string,
  exclude: string[] = []
): Promise<string[]> {
  const [a, b] = await Promise.all([
    columnsOf(client, source),
    columnsOf(client, target)
  ]);
  const skip = new Set(exclude);
  return [...a].filter((c) => b.has(c) && !skip.has(c));
}

async function buildInsert(
  ctx: Ctx,
  table: string,
  values: Row,
  opts: InsertOpts
): Promise<{ text: string; params: unknown[] }> {
  const cols = await columnsOf(ctx.client, table);
  const row: Row = { ...values };
  if (opts.audit !== false) {
    if (cols.has("companyId") && row.companyId === undefined) {
      row.companyId = ctx.companyId;
    }
    if (cols.has("createdBy") && row.createdBy === undefined) {
      row.createdBy = ctx.userId;
    }
  }

  const keys = Object.keys(row).filter((k) => row[k] !== undefined);
  for (const key of keys) {
    if (!cols.has(key)) {
      throw new Error(`Seed: table "${table}" has no column "${key}"`);
    }
  }
  if (keys.length === 0) {
    throw new Error(`Seed: nothing to insert into "${table}"`);
  }

  const conflict =
    opts.onConflict === "nothing"
      ? " ON CONFLICT DO NOTHING"
      : opts.onConflict
        ? ` ON CONFLICT ${opts.onConflict}`
        : "";

  return {
    text:
      `INSERT INTO ${quote(table)} (${keys.map(quote).join(", ")}) ` +
      `VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")})${conflict}`,
    params: keys.map((k) => row[k])
  };
}

export async function insertRow(
  ctx: Ctx,
  table: string,
  values: Row,
  opts: InsertOpts = {}
): Promise<void> {
  const { text, params } = await buildInsert(ctx, table, values, opts);
  await ctx.client.query(text, params);
}

// ON CONFLICT DO NOTHING — the row may already exist and that is fine.
export async function insertMaybe(
  ctx: Ctx,
  table: string,
  values: Row
): Promise<void> {
  await insertRow(ctx, table, values, { onConflict: "nothing" });
}

// Throws when the insert returns no row (the ON CONFLICT DO NOTHING trap —
// otherwise it surfaces as a confusing `undefined` far downstream).
export async function insertReturning<T extends Row = { id: string }>(
  ctx: Ctx,
  table: string,
  values: Row,
  opts: InsertOpts = {}
): Promise<T> {
  const { text, params } = await buildInsert(ctx, table, values, opts);
  const returning = opts.returning ?? '"id"';
  const res = await ctx.client.query<T>(
    `${text} RETURNING ${returning}`,
    params
  );
  const row = res.rows[0];
  if (!row) {
    throw new Error(`Seed: insert into "${table}" returned no row`);
  }
  return row;
}

export async function insertId(
  ctx: Ctx,
  table: string,
  values: Row,
  opts: InsertOpts = {}
): Promise<string> {
  const row = await insertReturning<{ id: string }>(ctx, table, values, opts);
  return row.id;
}

export async function rows<T extends Row>(
  client: PoolClient,
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const res = await client.query<T>(text, params);
  return res.rows;
}

export async function maybeOne<T extends Row>(
  client: PoolClient,
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const res = await client.query<T>(text, params);
  return res.rows[0] ?? null;
}

export async function one<T extends Row>(
  client: PoolClient,
  text: string,
  params: unknown[] = []
): Promise<T> {
  const row = await maybeOne<T>(client, text, params);
  if (!row) throw new Error(`Seed: query returned no rows\n${text}`);
  return row;
}

// Strict lookup into a ref bag: a miss is a seed bug, not a runtime "maybe".
// `what` names the kind of thing, so the error says which bag was empty.
export function need<T>(rec: Record<string, T>, key: string, what?: string): T {
  const value = rec[key];
  if (value === undefined) {
    throw new Error(`Seed: missing ${what ? `${what} ` : ""}"${key}"`);
  }
  return value;
}

// TipTap JSONB document — the shape every rich-text column in the app expects.
export function RICH(text: string): string {
  return JSON.stringify({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }]
  });
}

// Guard against duplicate satellite rows (the classic itemCost double-insert,
// which fans out every view that joins it).
export async function assertSingle(
  ctx: Ctx,
  table: string,
  where: Row
): Promise<void> {
  const keys = Object.keys(where);
  const clause = keys.map((k, i) => `${quote(k)} = $${i + 1}`).join(" AND ");
  const res = await ctx.client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM ${quote(table)} WHERE ${clause}`,
    keys.map((k) => where[k])
  );
  const count = Number(res.rows[0]?.count ?? 0);
  if (count !== 1) {
    throw new Error(
      `Seed: expected exactly 1 "${table}" row for ${JSON.stringify(where)}, found ${count}`
    );
  }
}

// get_next_sequence uses INTO STRICT and aborts the transaction if the row is
// missing, so backfill any sequence added to seed.data.ts after this company
// was created. Must run BEFORE resetSequences.
export async function ensureSequences(
  client: PoolClient,
  companyId: string
): Promise<void> {
  for (const seq of sequences) {
    await client.query(
      `INSERT INTO sequence ("table", name, prefix, suffix, next, size, step, "companyId")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT DO NOTHING`,
      [
        seq.table,
        seq.name,
        seq.prefix,
        seq.suffix,
        seq.next,
        seq.size,
        seq.step,
        companyId
      ]
    );
  }
}

// Re-running the seed must produce the same readable ids as the first run.
export async function resetSequences(
  client: PoolClient,
  companyId: string
): Promise<void> {
  await client.query(`UPDATE sequence SET next = 0 WHERE "companyId" = $1`, [
    companyId
  ]);
}

// SECURITY DEFINER, skips its permission check when session_user != 'authenticator'.
export async function nextSequence(ctx: Ctx, table: string): Promise<string> {
  const res = await ctx.client.query<{ value: string }>(
    `SELECT get_next_sequence($1, $2) AS value`,
    [table, ctx.companyId]
  );
  const value = res.rows[0]?.value;
  if (!value) throw new Error(`Seed: no sequence value for "${table}"`);
  return value;
}

const SUMMARY_TABLES = [
  "location",
  "process",
  "workCenter",
  "customer",
  "supplier",
  "item",
  "makeMethod",
  "methodMaterial",
  "itemLedger",
  "opportunity",
  "salesRfq",
  "quote",
  "salesOrder",
  "shipment",
  "salesInvoice",
  "supplierInteraction",
  "purchasingRfq",
  "supplierQuote",
  "purchaseOrder",
  "receipt",
  "purchaseInvoice",
  "job",
  "jobOperation",
  "nonConformance",
  "changeOrder",
  "fixedAsset",
  "workflow"
];

export async function printSummary(
  client: PoolClient,
  companyId: string
): Promise<void> {
  const union = SUMMARY_TABLES.map(
    (t) =>
      `SELECT '${t}' AS table_name, count(*)::int AS count FROM ${quote(t)} WHERE "companyId" = $1`
  ).join(" UNION ALL ");

  const res = await client.query<{ table_name: string; count: number }>(union, [
    companyId
  ]);
  const byTable = new Map(res.rows.map((r) => [r.table_name, r.count]));

  console.log("\nSeeded row counts");
  console.log("-----------------");
  for (const table of SUMMARY_TABLES) {
    const count = byTable.get(table) ?? 0;
    console.log(`  ${table.padEnd(22)} ${String(count).padStart(6)}`);
  }
}
