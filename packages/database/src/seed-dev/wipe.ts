import type { PoolClient } from "pg";
import { quote, resetSequences } from "./sql.ts";
import type { Ctx } from "./types.ts";

/**
 * Tables the seed never touches: identity/access, accounting reference, the
 * list tables bootstrap creates, and infrastructure the developer owns.
 * Everything else with a `companyId` is business data this seed owns, so it is
 * discovered from information_schema and wiped — a business table added to the
 * schema later is cleaned automatically instead of leaking across re-runs.
 */
const PRESERVED_TABLES = new Set([
  // Created by bootstrap()
  "accountDefault",
  "changeOrderRequiredAction",
  "changeOrderType",
  "customerStatus",
  "employee",
  "employeeJob",
  "employeeType",
  "fiscalYearSettings",
  "fixedAssetClass",
  "gaugeType",
  "group",
  "location",
  "maintenanceFailureMode",
  "nonConformanceRequiredAction",
  "nonConformanceType",
  "paymentTerm",
  "periodCloseTaskDefinition",
  "scrapReason",
  "sequence",
  "unitOfMeasure",
  "userToCompany",
  // Accounting records with trigger-enforced immutability (Posted journals cannot be deleted)
  "journal",
  "journalLine",
  // Infrastructure owned by the developer or the platform
  "apiKey",
  "auditLogArchive",
  "companyIntegration",
  "companyUsage",
  "customField",
  "eventSystemSubscription",
  "invite",
  "notificationPreference",
  "oauthClient",
  "oauthCode",
  "oauthToken",
  "searchIndexRegistry",
  "tableView",
  "userAttributeCategory",
  "userModulePreference",
  "webhook"
]);

type ForeignKey = {
  child: string;
  parent: string;
  columns: string[];
  notNull: string[];
};

async function companyScopedTables(client: PoolClient): Promise<string[]> {
  const res = await client.query<{ table_name: string }>(
    `SELECT t.table_name
     FROM information_schema.tables t
     WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
       AND EXISTS (
         SELECT 1 FROM information_schema.columns c
         WHERE c.table_schema = 'public' AND c.table_name = t.table_name
           AND c.column_name = 'companyId'
       )
     ORDER BY t.table_name`
  );
  return res.rows.map((r) => r.table_name);
}

async function foreignKeys(client: PoolClient): Promise<ForeignKey[]> {
  const res = await client.query<{
    child: string;
    parent: string;
    columns: string[];
    notnull: string[] | null;
  }>(
    `SELECT
       con.conrelid::regclass::text AS child,
       con.confrelid::regclass::text AS parent,
       (SELECT array_agg(a.attname::text ORDER BY k.ord)
          FROM unnest(con.conkey) WITH ORDINALITY k(attnum, ord)
          JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum) AS columns,
       (SELECT array_agg(a.attname::text)
          FROM unnest(con.conkey) k(attnum)
          JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
         WHERE a.attnotnull) AS notnull
     FROM pg_constraint con
     JOIN pg_class rel ON rel.oid = con.conrelid
     JOIN pg_namespace ns ON ns.oid = rel.relnamespace
     WHERE con.contype = 'f' AND ns.nspname = 'public'`
  );
  const unquote = (s: string) => s.replace(/"/g, "");
  return res.rows.map((r) => ({
    child: unquote(r.child),
    parent: unquote(r.parent),
    columns: r.columns,
    notNull: r.notnull ?? []
  }));
}

// companyId is part of most composite FKs but is never the discriminator —
// a MATCH SIMPLE constraint is satisfied as soon as any column is NULL.
function payloadColumns(fk: ForeignKey): string[] {
  return fk.columns.filter((c) => c !== "companyId");
}

function isNullable(fk: ForeignKey): boolean {
  const payload = payloadColumns(fk);
  return payload.length > 0 && payload.every((c) => !fk.notNull.includes(c));
}

// Children before parents. Only NOT NULL edges constrain the order, because
// every nullable edge has already been broken by nullNullableReferences().
// That subgraph is acyclic by construction: a NOT NULL cycle is uninsertable.
function deletionOrder(tables: string[], hardEdges: ForeignKey[]): string[] {
  const set = new Set(tables);
  const parentsOf = new Map(tables.map((t) => [t, new Set<string>()]));
  for (const fk of hardEdges) {
    if (fk.child === fk.parent) continue;
    parentsOf.get(fk.child)?.add(fk.parent);
  }

  const remaining = new Set(set);
  const order: string[] = [];
  while (remaining.size > 0) {
    const inbound = new Map([...remaining].map((t) => [t, 0]));
    for (const child of remaining) {
      for (const parent of parentsOf.get(child) ?? []) {
        if (remaining.has(parent)) {
          inbound.set(parent, (inbound.get(parent) ?? 0) + 1);
        }
      }
    }
    const ready = [...remaining].filter((t) => inbound.get(t) === 0);
    if (ready.length === 0) {
      throw new Error(
        `Seed: cycle in NOT NULL foreign keys among ${[...remaining].join(", ")}`
      );
    }
    for (const t of ready) {
      order.push(t);
      remaining.delete(t);
    }
  }
  return order;
}

// Breaks every optional reference into the delete set — including the traps:
// makeMethod.changeOrderId (ON DELETE SET NULL), item.changeOrderId,
// job.salesOrderId, kanban.jobId, itemLedger.correctionOfItemLedgerId, and the
// customer/supplier/quote/job reference cycles.
async function nullNullableReferences(
  client: PoolClient,
  companyId: string,
  fks: ForeignKey[],
  deleteSet: Set<string>
): Promise<number> {
  let count = 0;
  for (const fk of fks) {
    if (!deleteSet.has(fk.parent)) continue;
    if (!isNullable(fk)) continue;
    const payload = payloadColumns(fk);
    const assignments = payload.map((c) => `${quote(c)} = NULL`).join(", ");
    const anySet = payload.map((c) => `${quote(c)} IS NOT NULL`).join(" OR ");
    await client.query(
      `UPDATE ${quote(fk.child)} SET ${assignments}
       WHERE "companyId" = $1 AND (${anySet})`,
      [companyId]
    );
    count += 1;
  }
  return count;
}

export async function wipeCompanyBusinessData(ctx: Ctx): Promise<void> {
  const { client, companyId } = ctx;

  const tables = await companyScopedTables(client);
  const deleteSet = new Set(tables.filter((t) => !PRESERVED_TABLES.has(t)));
  const fks = (await foreignKeys(client)).filter(
    (fk) =>
      deleteSet.has(fk.parent) &&
      (deleteSet.has(fk.child) || PRESERVED_TABLES.has(fk.child))
  );

  // Delete lines with check constraints that would block nulling their item FKs.
  // salesOrderLine.itemId can't be set NULL (check requires it for Part/Material/Tool/etc).
  // Cascade via the parent headers — the headers are in deleteSet and will be deleted again
  // (harmlessly) in the topo pass.
  for (const t of [
    "purchaseInvoice",
    "salesInvoice",
    "salesOrder",
    "purchaseOrder",
    "quote",
    "salesRfq"
  ]) {
    if (deleteSet.has(t)) {
      await client.query(`DELETE FROM ${quote(t)} WHERE "companyId" = $1`, [
        companyId
      ]);
    }
  }

  await nullNullableReferences(client, companyId, fks, deleteSet);

  const hardEdges = fks.filter(
    (fk) => deleteSet.has(fk.child) && !isNullable(fk)
  );
  for (const table of deletionOrder([...deleteSet], hardEdges)) {
    await client.query(`DELETE FROM ${quote(table)} WHERE "companyId" = $1`, [
      companyId
    ]);
  }

  // location is preserved, but only the bootstrap one — the rest are seed data.
  // Re-point the employee at it first; employeeJob is preserved and NOT NULL.
  await client.query(
    `UPDATE "employeeJob" SET "locationId" = $2
     WHERE "companyId" = $1 AND "locationId" IS DISTINCT FROM $2`,
    [companyId, ctx.locationId]
  );
  await client.query(
    `DELETE FROM location WHERE "companyId" = $1 AND id <> $2`,
    [companyId, ctx.locationId]
  );

  // Run N and run N+1 must produce identical readable ids.
  await resetSequences(client, companyId);

  await assertWipeClean(ctx, deleteSet);
}

// Fails loudly if anything survived, so a table the wipe can't reach shows up
// as a seed error rather than as data quietly accumulating across re-runs.
export async function assertWipeClean(
  ctx: Ctx,
  deleteSet: Set<string>
): Promise<void> {
  const tables = [...deleteSet];
  const union = tables
    .map(
      (t) =>
        `SELECT '${t}' AS table_name, count(*)::int AS count FROM ${quote(t)} WHERE "companyId" = $1`
    )
    .join(" UNION ALL ");
  const res = await ctx.client.query<{ table_name: string; count: number }>(
    `SELECT * FROM (${union}) s WHERE count > 0 ORDER BY table_name`,
    [ctx.companyId]
  );
  if (res.rows.length > 0) {
    const detail = res.rows.map((r) => `${r.table_name}=${r.count}`).join(", ");
    throw new Error(`Seed: wipe left rows behind — ${detail}`);
  }
}
