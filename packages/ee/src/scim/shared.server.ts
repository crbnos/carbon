// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { getPermissionCacheKey } from "@carbon/auth";
import type { Database } from "@carbon/database";
import type { KyselyDatabase } from "@carbon/database/client";
import { redis } from "@carbon/kv";
import { getLogger } from "@carbon/logger";
import { updateSubscriptionQuantityForCompany } from "@carbon/stripe/stripe.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Kysely, sql, type Transaction } from "kysely";
import { scimError } from "./protocol";

export const logger = getLogger("ee", "scim");

/** The actor the audit log names for a change SCIM made. */
export const SCIM_ACTOR_LABEL = "SCIM";
export const SCIM_TOKEN_PREFIX = "scim_";
/** SCIM rows are written by no person; the `system` user signs them. */
export const SYSTEM_USER_ID = "system";
export const CONTROLLED_REFUSAL =
  "This is a controlled environment. Add members in Carbon so an administrator can attest to them; SCIM can then update and deactivate them.";

export type ScimDeps = {
  db: Kysely<KyselyDatabase>;
  serviceRole: SupabaseClient<Database>;
};

export type ScimConnectionRow =
  Database["public"]["Tables"]["scimConnection"]["Row"];

export type Ctx = ScimDeps & {
  connection: ScimConnectionRow;
  companyId: string;
  baseUrl: string;
};

export type Db = Kysely<KyselyDatabase> | Transaction<KyselyDatabase>;

/** A refusal a transaction throws so it rolls back and the handler answers it. */
export class ScimRefusal extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly scimType?: "uniqueness" | "invalidValue" | "mutability"
  ) {
    super(message);
  }

  toResponse(): Response {
    return scimError(this.status, this.message, this.scimType);
  }
}

export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "23505"
  );
}

/**
 * The ids of this company's rows whose column equals `value` without case
 * (RFC 7643: `userName` and `displayName` compare that way). Not PostgREST's
 * `ilike`: it reads `*` as a wildcard, so `a*@x.com` would match `ab@x.com`
 * and an IdP would link the wrong person.
 */
export async function idsMatchingWithoutCase(
  ctx: Ctx,
  table: "scimUser" | "scimGroup",
  column: "userName" | "displayName",
  value: string
): Promise<string[]> {
  const result = await sql<{ id: string }>`
    SELECT "id" FROM ${sql.table(table)}
    WHERE "companyId" = ${ctx.companyId}
      AND lower(${sql.ref(column)}) = lower(${value})
  `.execute(ctx.db);
  return result.rows.map((row) => row.id);
}

/**
 * Credit every change this transaction makes to SCIM in the audit log:
 * `dispatch_event_batch` copies the label into each audit row.
 */
export async function labelAsScim(
  trx: Transaction<KyselyDatabase>
): Promise<void> {
  await sql`SELECT set_config('app.actor_label', ${SCIM_ACTOR_LABEL}, true)`.execute(
    trx
  );
}

export async function hasMappedGroup(
  db: Db,
  companyId: string
): Promise<boolean> {
  const mapped = await db
    .selectFrom("scimGroup")
    .select("id")
    .where("companyId", "=", companyId)
    .where("employeeTypeId", "is not", null)
    .limit(1)
    .executeTakeFirst();
  return Boolean(mapped);
}

/**
 * Why the connection's defaults cannot be used, or null. Both tables have
 * single-column keys, so the company must be checked by hand.
 */
export async function missingDefault(
  db: Db,
  companyId: string,
  defaults: { defaultEmployeeTypeId: string; defaultLocationId: string }
): Promise<string | null> {
  const [type, location] = await Promise.all([
    db
      .selectFrom("employeeType")
      .select("id")
      .where("id", "=", defaults.defaultEmployeeTypeId)
      .where("companyId", "=", companyId)
      .executeTakeFirst(),
    db
      .selectFrom("location")
      .select("id")
      .where("id", "=", defaults.defaultLocationId)
      .where("companyId", "=", companyId)
      .executeTakeFirst()
  ]);
  if (!type) return "Employee type not found";
  if (!location) return "Location not found";
  return null;
}

export async function clearPermissionCaches(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  try {
    await redis.del(...userIds.map(getPermissionCacheKey));
  } catch (err) {
    logger.error("Failed to clear permission caches after a SCIM change", {
      error: err,
      userIds
    });
  }
}

export async function syncSeats(companyId: string): Promise<void> {
  try {
    await updateSubscriptionQuantityForCompany(companyId);
  } catch (err) {
    logger.error("Failed to sync seats after a SCIM change", {
      error: err,
      companyId
    });
  }
}

type PageResult<Row> = {
  data: Row[] | null;
  error: { code?: string } | null;
  count: number | null;
  status: number;
};

/**
 * One page of a SCIM list. A `startIndex` past the last row is an empty page
 * (RFC 7644 §3.4.2.4): PostgREST answers it 416, and through Kong its body can
 * arrive cut short, so the status is read before the error code.
 */
export async function readListPage<Row>(
  count: number,
  query: {
    rows: () => PromiseLike<PageResult<Row>>;
    total: () => PromiseLike<PageResult<unknown>>;
  }
): Promise<{ rows: Row[]; totalResults: number }> {
  const countOnly = async () => {
    const total = await query.total();
    if (total.error) throw total.error;
    return { rows: [], totalResults: total.count ?? 0 };
  };
  if (count === 0) return countOnly();

  const page = await query.rows();
  if (page.error) {
    if (page.status === 416 || page.error.code === "PGRST103") {
      return countOnly();
    }
    throw page.error;
  }
  const rows = page.data ?? [];
  return { rows, totalResults: page.count ?? rows.length };
}
