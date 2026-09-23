import { maybeOne, quote } from "../sql.ts";
import type { Ctx } from "../types.ts";

/**
 * Id of a company-scoped lookup row by its name: a bootstrap row
 * (nonConformanceType, paymentTerm, scrapReason, …) or one tier 01 inserted
 * (the material taxonomy). Cached in ctx.refs.misc — never module scope, which
 * would leak across the drift check's four companies.
 */
export async function bootstrapIdByName(
  ctx: Ctx,
  table: string,
  name: string
): Promise<string> {
  const key = `${table}:${name}`;
  const cached = ctx.refs.misc[key];
  if (cached) return cached;
  const row = await maybeOne<{ id: string }>(
    ctx.client,
    `SELECT id FROM ${quote(table)} WHERE "companyId" = $1 AND name = $2`,
    [ctx.companyId, name]
  );
  if (!row) {
    throw new Error(`Seed: no ${table} named "${name}"`);
  }
  ctx.refs.misc[key] = row.id;
  return row.id;
}
