// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  nonConformanceRequiredActions,
  nonConformanceTypes,
  paymentTerms
} from "../../seed-data.ts";
import { insertReturning, maybeOne, quote } from "../sql.ts";
import type { Ctx } from "../types.ts";

/**
 * Settings lists a user can rename or delete, and that a restore of a backup
 * older than the list leaves empty. A missing name is added back, not refused.
 */
const RESTORABLE_LISTS = new Set([
  "changeOrderRequiredAction",
  "changeOrderType",
  "customerStatus",
  "gaugeType",
  "maintenanceFailureMode",
  "nonConformanceRequiredAction",
  "nonConformanceType",
  "paymentTerm",
  "returnReason",
  "scrapReason",
  "supplierStage"
]);

// The columns seedCompany writes beyond the name, so a re-added row matches it.
function restoredRow(table: string, name: string) {
  if (table === "nonConformanceRequiredAction") {
    const seeded = nonConformanceRequiredActions.find((a) => a.name === name);
    return {
      name,
      systemType: seeded && "systemType" in seeded ? seeded.systemType : null
    };
  }
  if (table === "paymentTerm") {
    const { createdBy: _, ...seeded } =
      paymentTerms.find((t) => t.name === name) ?? {};
    return { ...seeded, name };
  }
  return { name };
}

/**
 * Cached in ctx.refs.misc — never module scope, which would leak across the
 * drift check's four companies.
 */
export async function bootstrapIdByName(
  ctx: Ctx,
  table: string,
  name: string
): Promise<string> {
  const key = `${table}:${name}`;
  const cached = ctx.refs.misc[key];
  if (cached) return cached;
  let row = await maybeOne<{ id: string }>(
    ctx.client,
    `SELECT id FROM ${quote(table)} WHERE "companyId" = $1 AND name = $2`,
    [ctx.companyId, name]
  );
  if (!row && RESTORABLE_LISTS.has(table)) {
    row = await insertReturning(ctx, table, {
      ...restoredRow(table, name),
      createdBy: "system"
    });
  }
  if (!row) {
    throw new Error(`Seed: no ${table} named "${name}"`);
  }
  ctx.refs.misc[key] = row.id;
  return row.id;
}

/** Any of the company's NCR types; the first default when it has none. */
export async function anyNonConformanceTypeId(ctx: Ctx): Promise<string> {
  const row = await maybeOne<{ id: string }>(
    ctx.client,
    `SELECT id FROM "nonConformanceType" WHERE "companyId" = $1 LIMIT 1`,
    [ctx.companyId]
  );
  return (
    row?.id ??
    bootstrapIdByName(ctx, "nonConformanceType", nonConformanceTypes[0]!.name)
  );
}
