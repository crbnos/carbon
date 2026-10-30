// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/**
 * The SCIM 2.0 server behind `/scim/v2` (spec:
 * `.ai/specs/2026-10-30-scim-provisioning.md`). A customer's identity provider
 * creates, updates, deactivates and regroups the company's employees here.
 *
 * The entitlement lock (`requireEntitlement(…, "SCIM")`) runs on every request,
 * inside commercial code, after the token names the company. The ERP route only
 * hands the request over.
 *
 * Offboarding is the point: `active: false` and DELETE run the existing
 * per-company `deactivateUser`, delete the person's API keys in the company
 * (a key authenticates as its creator with no membership check), and — when
 * the person has no company left — revoke every GoTrue session. The global
 * `user` row and the person's records stay.
 *
 * SCIM only ever touches people it manages (a `scimUser` row). An employee the
 * IdP never provisioned — a shop-floor operator on a shared terminal — is never
 * listed, changed or deactivated.
 */

import { CONTROLLED_ENVIRONMENT, getPermissionCacheKey } from "@carbon/auth";
import { bustApiKeyCache, hashApiKey } from "@carbon/auth/auth.server";
import { signUserAccessToken } from "@carbon/auth/client.server";
import { deactivateUser } from "@carbon/auth/users.server";
import type { Database } from "@carbon/database";
import type { CreateAuditLogEntry } from "@carbon/database/audit.types";
import type { KyselyDatabase } from "@carbon/database/client";
import { getAppUrl } from "@carbon/env";
import { Ratelimit, redis } from "@carbon/kv";
import { getLogger } from "@carbon/logger";
import { updateSubscriptionQuantityForCompany } from "@carbon/stripe/stripe.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Kysely, Transaction } from "kysely";
import { sql } from "kysely";
import { insertAuditLogEntries, isAuditLogEnabled } from "../audit/audit";
import { EntitlementError, requireEntitlement } from "../entitlements.server";
import {
  getSsoConnection,
  getSsoConnectionByDomain
} from "./connections.server";
import { isSsoEnabled } from "./gate";
import {
  emailDomain,
  seedSsoIdentityForUser,
  uncoveredSsoDomainError
} from "./provisioning.server";
import {
  pickEmployeeType,
  replaceCompanyGrants,
  typeGrantsFor
} from "./scim-mapping";
import {
  applyGroupPatch,
  applyUserPatch,
  matchScimRoute,
  parsePaging,
  parseScimBoolean,
  parseScimFilter,
  readBearerToken,
  readGroupResource,
  readUserResource,
  resourceTypes,
  type ScimGroupState,
  type ScimUserRow,
  type ScimUserState,
  schemas,
  scimError,
  scimJson,
  scimListResponse,
  serviceProviderConfig,
  toScimGroup,
  toScimUser
} from "./scim-protocol";

const logger = getLogger("ee", "scim");

/** The SCIM rows are written by no person; the `system` user signs them. */
const SYSTEM_USER_ID = "system";
const TOKEN_PREFIX = "scim_";
const REQUESTS_PER_MINUTE = 600;
const RETRY_AFTER_SECONDS = "60";
const WRITE_BATCH = 500;

const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(REQUESTS_PER_MINUTE, "1 m")
});

export type ScimDeps = {
  db: Kysely<KyselyDatabase>;
  serviceRole: SupabaseClient<Database>;
};

export type ScimConnectionRow =
  Database["public"]["Tables"]["scimConnection"]["Row"];

type Ctx = ScimDeps & {
  connection: ScimConnectionRow;
  companyId: string;
  baseUrl: string;
};

const USER_COLUMNS =
  "id, userId, userName, externalId, email, givenName, familyName, active, createdAt, updatedAt";

type ScimUserRecord = ScimUserRow & { userId: string };

/** A refusal the transaction raises so it rolls back and the caller answers it. */
class ScimRefusal extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly scimType?: "uniqueness" | "invalidValue" | "mutability"
  ) {
    super(message);
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "23505"
  );
}

/** Escape LIKE metacharacters so `ilike` compares the value exactly. */
function exactPattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function scimBaseUrl(): string {
  return `${getAppUrl()}/scim/v2`;
}

export function scimActorLabel(identityProvider: string): string {
  return `SCIM (${identityProvider})`;
}

// ---------------------------------------------------------------------------
// The request edge
// ---------------------------------------------------------------------------

/**
 * Answer one SCIM request. Never throws: an unexpected failure is logged and
 * answered `500`, which Okta shows on its task and Entra retries next cycle.
 */
export async function handleScimRequest(
  request: Request,
  deps: ScimDeps
): Promise<Response> {
  try {
    return await handle(request, deps);
  } catch (err) {
    logger.error("SCIM request failed", {
      error: err,
      method: request.method,
      path: new URL(request.url).pathname
    });
    return scimError(500, "Carbon could not complete the request. Try again.");
  }
}

async function handle(request: Request, deps: ScimDeps): Promise<Response> {
  const token = readBearerToken(request.headers.get("authorization"));
  if (!token?.startsWith(TOKEN_PREFIX)) {
    return scimError(401, "A valid SCIM bearer token is required.");
  }

  const lookup = await deps.serviceRole
    .from("scimConnection")
    .select("*")
    .eq("tokenHash", hashApiKey(token))
    .maybeSingle();
  if (lookup.error) {
    logger.error("Failed to read the SCIM connection", { error: lookup.error });
    return scimError(500, "Carbon could not complete the request. Try again.");
  }
  if (!lookup.data) {
    return scimError(401, "A valid SCIM bearer token is required.");
  }

  const connection = lookup.data;
  const companyId = connection.companyId;

  try {
    await requireEntitlement(deps.serviceRole, companyId, "SCIM");
  } catch (err) {
    if (err instanceof EntitlementError) {
      return scimError(
        403,
        "SCIM provisioning requires the Business plan. Ask an administrator of the Carbon company to upgrade."
      );
    }
    throw err;
  }

  const { success } = await ratelimit.limit(`scim:${connection.id}`);
  if (!success) {
    return scimError(429, "Too many SCIM requests. Retry later.", undefined, {
      "Retry-After": RETRY_AFTER_SECONDS
    });
  }

  await touchConnection(deps.db, connection);

  const ctx: Ctx = { ...deps, connection, companyId, baseUrl: scimBaseUrl() };
  const url = new URL(request.url);
  const route = matchScimRoute(url.pathname);
  if (!route) return scimError(404, "This SCIM endpoint does not exist.");

  const method = request.method.toUpperCase();

  switch (route.resource) {
    case "ServiceProviderConfig":
      if (method !== "GET") return methodNotAllowed();
      return scimJson(serviceProviderConfig(ctx.baseUrl));
    case "ResourceTypes": {
      if (method !== "GET") return methodNotAllowed();
      const list = resourceTypes(ctx.baseUrl);
      if (!route.id) return scimJson(list);
      const one = list.Resources.find((type) => type.id === route.id);
      return one ? scimJson(one) : scimError(404, "Unknown resource type.");
    }
    case "Schemas": {
      if (method !== "GET") return methodNotAllowed();
      const list = schemas();
      if (!route.id) return scimJson(list);
      const one = list.Resources.find((schema) => schema.id === route.id);
      return one ? scimJson(one) : scimError(404, "Unknown schema.");
    }
    case "Users":
      if (!route.id) {
        if (method === "GET") return listUsers(ctx, url);
        if (method === "POST") return createUser(ctx, await readJson(request));
        return methodNotAllowed();
      }
      if (method === "GET") return getUser(ctx, route.id);
      if (method === "PUT")
        return replaceUser(ctx, route.id, await readJson(request));
      if (method === "PATCH")
        return patchUser(ctx, route.id, await readJson(request));
      if (method === "DELETE") return deleteUser(ctx, route.id);
      return methodNotAllowed();
    case "Groups":
      if (!route.id) {
        if (method === "GET") return listGroups(ctx, url);
        if (method === "POST") return createGroup(ctx, await readJson(request));
        return methodNotAllowed();
      }
      if (method === "GET") return getGroup(ctx, route.id, url);
      if (method === "PUT")
        return replaceGroup(ctx, route.id, await readJson(request));
      if (method === "PATCH")
        return patchGroup(ctx, route.id, await readJson(request));
      if (method === "DELETE") return deleteGroup(ctx, route.id);
      return methodNotAllowed();
  }
}

function methodNotAllowed(): Response {
  return scimError(405, "This method is not supported on this endpoint.");
}

const INVALID_JSON = Symbol("invalid-json");

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return INVALID_JSON;
  }
}

function invalidBody(body: unknown): Response | null {
  return body === INVALID_JSON
    ? scimError(400, "The request body is not valid JSON.", "invalidSyntax")
    : null;
}

/** Record the last request, at most once a minute (the settings card shows it). */
async function touchConnection(
  db: Kysely<KyselyDatabase>,
  connection: ScimConnectionRow
): Promise<void> {
  try {
    await db
      .updateTable("scimConnection")
      .set({ lastRequestAt: sql`now()` })
      .where("id", "=", connection.id)
      .where("companyId", "=", connection.companyId)
      .where((eb) =>
        eb.or([
          eb("lastRequestAt", "is", null),
          eb("lastRequestAt", "<", sql<string>`now() - interval '1 minute'`)
        ])
      )
      .execute();
  } catch (err) {
    logger.error("Failed to record the SCIM request time", {
      error: err,
      companyId: connection.companyId
    });
  }
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

async function readScimUser(
  ctx: Ctx,
  id: string
): Promise<ScimUserRecord | null> {
  const result = await ctx.serviceRole
    .from("scimUser")
    .select(USER_COLUMNS)
    .eq("id", id)
    .eq("companyId", ctx.companyId)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data;
}

function stateOf(row: ScimUserRecord): ScimUserState {
  return {
    userName: row.userName,
    externalId: row.externalId,
    email: row.email,
    givenName: row.givenName,
    familyName: row.familyName,
    active: row.active
  };
}

async function listUsers(ctx: Ctx, url: URL): Promise<Response> {
  const filter = parseScimFilter(url.searchParams.get("filter"));
  if (!filter.ok) return scimError(400, filter.detail, filter.scimType);
  const { startIndex, count } = parsePaging(url);

  let query = ctx.serviceRole
    .from("scimUser")
    .select(USER_COLUMNS, { count: "exact" })
    .eq("companyId", ctx.companyId);

  for (const { attribute, value } of filter.value) {
    switch (attribute.toLowerCase()) {
      case "username":
        query = query.ilike("userName", exactPattern(value));
        break;
      case "externalid":
        query = query.eq("externalId", value);
        break;
      case "emails":
      case "emails.value":
        query = query.eq("email", value.toLowerCase());
        break;
      case "id":
        query = query.eq("id", value);
        break;
      case "active": {
        const active = parseScimBoolean(value);
        if (active === null) {
          return scimError(
            400,
            "active must be true or false",
            "invalidFilter"
          );
        }
        query = query.eq("active", active);
        break;
      }
      default:
        return scimError(
          400,
          `Carbon cannot filter Users by "${attribute}".`,
          "invalidFilter"
        );
    }
  }

  const page =
    count === 0
      ? await query.order("createdAt").order("id").limit(1)
      : await query
          .order("createdAt")
          .order("id")
          .range(startIndex - 1, startIndex - 2 + count);
  if (page.error) throw page.error;

  const resources =
    count === 0
      ? []
      : (page.data ?? []).map((row) => toScimUser(row, ctx.baseUrl));
  return scimJson(
    scimListResponse(resources, {
      totalResults: page.count ?? resources.length,
      startIndex
    })
  );
}

async function getUser(ctx: Ctx, id: string): Promise<Response> {
  const row = await readScimUser(ctx, id);
  return row
    ? scimJson(toScimUser(row, ctx.baseUrl))
    : scimError(404, "User not found.");
}

/** The employee type's grants in this company, as claim keys. */
async function readTypeGrants(
  db: Kysely<KyselyDatabase> | Transaction<KyselyDatabase>,
  companyId: string,
  employeeTypeIds: string[]
): Promise<Map<string, string[]>> {
  const grants = new Map<string, string[]>(
    employeeTypeIds.map((id) => [id, []])
  );
  if (employeeTypeIds.length === 0) return grants;

  const rows = await db
    .selectFrom("employeeTypePermission as p")
    .innerJoin("employeeType as t", "t.id", "p.employeeTypeId")
    .select([
      "p.employeeTypeId",
      "p.module",
      "p.view",
      "p.create",
      "p.update",
      "p.delete"
    ])
    .where("t.companyId", "=", companyId)
    .where("p.employeeTypeId", "in", employeeTypeIds)
    .execute();

  for (const id of employeeTypeIds) {
    grants.set(
      id,
      typeGrantsFor(
        rows.filter((row) => row.employeeTypeId === id),
        companyId
      )
    );
  }
  return grants;
}

/** Rewrite this company's slice of each person's `userPermission` row. */
async function writeCompanyGrants(
  trx: Transaction<KyselyDatabase>,
  companyId: string,
  grantsByUser: Map<string, string[]>
): Promise<void> {
  const userIds = [...grantsByUser.keys()];
  if (userIds.length === 0) return;

  // Serialize on the user rows before the read-merge-write, as acceptInvite
  // does: the userPermission lock holds nothing while that row is absent.
  await trx
    .selectFrom("user")
    .select("id")
    .where("id", "in", userIds)
    .forNoKeyUpdate()
    .execute();

  const current = await trx
    .selectFrom("userPermission")
    .select(["id", "permissions"])
    .where("id", "in", userIds)
    .forUpdate()
    .execute();
  const currentById = new Map(
    current.map((row) => [
      row.id,
      (row.permissions ?? {}) as Record<string, string[]>
    ])
  );

  const rows = userIds.map((id) => ({
    id,
    permissions: JSON.stringify(
      replaceCompanyGrants(
        currentById.get(id) ?? {},
        grantsByUser.get(id) ?? [],
        companyId
      )
    )
  }));

  for (let i = 0; i < rows.length; i += WRITE_BATCH) {
    const batch = rows.slice(i, i + WRITE_BATCH);
    await sql`
      INSERT INTO "userPermission" ("id", "permissions")
      VALUES ${sql.join(batch.map((row) => sql`(${row.id}, ${row.permissions}::jsonb)`))}
      ON CONFLICT ("id") DO UPDATE SET "permissions" = EXCLUDED."permissions"
    `.execute(trx);
  }
}

async function clearPermissionCaches(userIds: string[]): Promise<void> {
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

async function syncSeats(companyId: string): Promise<void> {
  try {
    await updateSubscriptionQuantityForCompany(companyId);
  } catch (err) {
    logger.error("Failed to sync seats after a SCIM change", {
      error: err,
      companyId
    });
  }
}

type EmployeeAudit = {
  userId: string;
  operation: CreateAuditLogEntry["operation"];
  diff: NonNullable<CreateAuditLogEntry["diff"]>;
};

async function auditEmployees(
  serviceRole: SupabaseClient<Database>,
  connection: ScimConnectionRow,
  entries: EmployeeAudit[]
): Promise<void> {
  if (entries.length === 0) return;
  try {
    if (!(await isAuditLogEnabled(serviceRole, connection.companyId))) return;
    await insertAuditLogEntries(
      serviceRole,
      connection.companyId,
      entries.map((entry) => ({
        tableName: "employee",
        entityType: "employee",
        entityId: entry.userId,
        recordId: entry.userId,
        operation: entry.operation,
        actorId: null,
        diff: entry.diff,
        metadata: {
          origin: "scim",
          actorLabel: scimActorLabel(connection.identityProvider)
        }
      }))
    );
  } catch (err) {
    logger.error("Failed to write the SCIM audit entry", {
      error: err,
      companyId: connection.companyId
    });
  }
}

async function hasOtherCompany(
  db: Kysely<KyselyDatabase> | Transaction<KyselyDatabase>,
  userId: string,
  companyId: string
): Promise<boolean> {
  const other = await db
    .selectFrom("userToCompany")
    .select("companyId")
    .where("userId", "=", userId)
    .where("companyId", "!=", companyId)
    .limit(1)
    .executeTakeFirst();
  return Boolean(other);
}

/** The connection's defaults, re-checked against the company before a write. */
async function readOwnedDefaults(ctx: Ctx): Promise<boolean> {
  const [type, location] = await Promise.all([
    ctx.db
      .selectFrom("employeeType")
      .select("id")
      .where("id", "=", ctx.connection.defaultEmployeeTypeId)
      .where("companyId", "=", ctx.companyId)
      .executeTakeFirst(),
    ctx.db
      .selectFrom("location")
      .select("id")
      .where("id", "=", ctx.connection.defaultLocationId)
      .where("companyId", "=", ctx.companyId)
      .executeTakeFirst()
  ]);
  return Boolean(type && location);
}

async function createUser(ctx: Ctx, body: unknown): Promise<Response> {
  const invalid = invalidBody(body);
  if (invalid) return invalid;
  const parsed = readUserResource(body);
  if (!parsed.ok) return scimError(400, parsed.detail, parsed.scimType);
  const state = parsed.value;

  const duplicate = await ctx.serviceRole
    .from("scimUser")
    .select("id")
    .eq("companyId", ctx.companyId)
    .ilike("userName", exactPattern(state.userName))
    .maybeSingle();
  if (duplicate.error) throw duplicate.error;
  if (duplicate.data) {
    return scimError(409, "A user with this userName exists.", "uniqueness");
  }

  // The invite rule: with SAML SSO on, members must be on a verified domain.
  const sso = await getSsoConnection(ctx.serviceRole, ctx.companyId);
  if (sso.error) throw sso.error;
  if (sso.data) {
    const refusal = uncoveredSsoDomainError(
      sso.data.domains ?? [],
      state.email
    );
    if (refusal) return scimError(400, refusal, "invalidValue");
  }

  if (!(await readOwnedDefaults(ctx))) {
    logger.error("SCIM connection defaults are not in the company", {
      companyId: ctx.companyId,
      connectionId: ctx.connection.id
    });
    return scimError(
      500,
      "The SCIM connection's default employee type or location no longer exists. Update it in Carbon."
    );
  }

  const existing = await ctx.serviceRole
    .from("user")
    .select("id, active")
    .eq("email", state.email)
    .maybeSingle();
  if (existing.error) throw existing.error;

  if (existing.data && existing.data.active === false) {
    return scimError(
      409,
      "This email belongs to an archived Carbon account. Contact Carbon support.",
      "uniqueness"
    );
  }

  let userId = existing.data?.id ?? null;
  let createdAuthUser = false;

  if (!userId) {
    if (CONTROLLED_ENVIRONMENT) {
      return scimError(
        403,
        "This is a controlled environment. Invite new members in Carbon so an administrator can attest to them; SCIM can then manage them."
      );
    }

    const name = [state.givenName, state.familyName].filter(Boolean).join(" ");
    const created = await ctx.serviceRole.auth.admin.createUser({
      email: state.email,
      password: crypto.randomUUID(),
      email_confirm: true,
      user_metadata: name ? { name } : undefined
    });
    if (created.error) {
      if (created.error.code === "user_already_exists") {
        return scimError(
          409,
          "An account with this email exists without a Carbon profile. Contact Carbon support.",
          "uniqueness"
        );
      }
      throw created.error;
    }
    userId = created.data.user.id;
    createdAuthUser = true;
  }

  // With SAML SSO on for the domain, seed the identity so the person's first
  // SSO sign-in links to this account (self-hosted only; isSsoEnabled gates it).
  if (isSsoEnabled()) {
    const domain = emailDomain(state.email);
    const ssoForDomain = domain
      ? await getSsoConnectionByDomain(ctx.serviceRole, domain)
      : null;
    if (ssoForDomain?.data) {
      const seed = await seedSsoIdentityForUser(ctx.db, {
        userId,
        email: state.email,
        providerId: ssoForDomain.data.providerId
      });
      if (seed.error) {
        logger.error("Failed to seed the SSO identity for a SCIM user", {
          userId,
          error: seed.error
        });
      }
    }
  }

  let outcome: { scimUserId: string; joined: boolean; employeeTypeId: string };
  try {
    outcome = await ctx.db.transaction().execute(async (trx) => {
      const membership = await trx
        .selectFrom("userToCompany")
        .select("role")
        .where("userId", "=", userId)
        .where("companyId", "=", ctx.companyId)
        .executeTakeFirst();
      if (membership && membership.role !== "employee") {
        throw new ScimRefusal(
          409,
          "This person is a customer or supplier contact in this company.",
          "uniqueness"
        );
      }

      const employee = await trx
        .selectFrom("employee")
        .select(["employeeTypeId", "active"])
        .where("id", "=", userId)
        .where("companyId", "=", ctx.companyId)
        .executeTakeFirst();

      // An active employee is adopted as is: same type, same grants.
      const adopt =
        membership?.role === "employee" && employee?.active === true;
      const employeeTypeId = adopt
        ? (employee?.employeeTypeId ?? ctx.connection.defaultEmployeeTypeId)
        : ctx.connection.defaultEmployeeTypeId;
      let joined = false;

      if (!adopt) {
        await trx
          .insertInto("employee")
          .values({
            id: userId,
            companyId: ctx.companyId,
            employeeTypeId,
            active: state.active
          })
          .onConflict((oc) =>
            oc
              .columns(["id", "companyId"])
              .doUpdateSet({ employeeTypeId, active: state.active })
          )
          .execute();

        await trx
          .insertInto("employeeJob")
          .values({
            id: userId,
            companyId: ctx.companyId,
            locationId: ctx.connection.defaultLocationId
          })
          .onConflict((oc) => oc.columns(["id", "companyId"]).doNothing())
          .execute();

        if (state.active) {
          await trx
            .insertInto("userToCompany")
            .values({ userId, companyId: ctx.companyId, role: "employee" })
            .onConflict((oc) => oc.columns(["userId", "companyId"]).doNothing())
            .execute();

          const grants = await readTypeGrants(trx, ctx.companyId, [
            employeeTypeId
          ]);
          await writeCompanyGrants(
            trx,
            ctx.companyId,
            new Map([[userId, grants.get(employeeTypeId) ?? []]])
          );
          joined = true;
        }
      }

      // An invite the IdP has now superseded would otherwise stay redeemable.
      await trx
        .updateTable("invite")
        .set({ revokedAt: sql`now()` })
        .where("email", "=", state.email)
        .where("companyId", "=", ctx.companyId)
        .where("acceptedAt", "is", null)
        .where("revokedAt", "is", null)
        .execute();

      // `user` is global: write the name only for a person no other company
      // also sees.
      if (
        (state.givenName || state.familyName) &&
        !(await hasOtherCompany(trx, userId, ctx.companyId))
      ) {
        await trx
          .updateTable("user")
          .set({
            firstName: state.givenName ?? "",
            lastName: state.familyName ?? ""
          })
          .where("id", "=", userId)
          .where("active", "=", true)
          .execute();
      }

      const inserted = await trx
        .insertInto("scimUser")
        .values({
          companyId: ctx.companyId,
          connectionId: ctx.connection.id,
          userId,
          userName: state.userName,
          externalId: state.externalId,
          email: state.email,
          givenName: state.givenName,
          familyName: state.familyName,
          active: state.active,
          createdBy: SYSTEM_USER_ID
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      return { scimUserId: inserted.id, joined, employeeTypeId };
    });
  } catch (err) {
    if (createdAuthUser) {
      const removed = await ctx.serviceRole.auth.admin.deleteUser(userId);
      if (removed.error) {
        logger.error("Failed to remove the auth user of a failed SCIM create", {
          userId,
          error: removed.error
        });
      }
    }
    if (err instanceof ScimRefusal) {
      return scimError(err.status, err.message, err.scimType);
    }
    if (isUniqueViolation(err)) {
      return scimError(
        409,
        "This person is already provisioned in this company.",
        "uniqueness"
      );
    }
    throw err;
  }

  await clearPermissionCaches([userId]);
  if (outcome.joined) {
    await syncSeats(ctx.companyId);
    await auditEmployees(ctx.serviceRole, ctx.connection, [
      {
        userId,
        operation: "INSERT",
        diff: {
          active: { new: true },
          employeeTypeId: { new: outcome.employeeTypeId }
        }
      }
    ]);
  }

  const row = await readScimUser(ctx, outcome.scimUserId);
  if (!row) throw new Error("The provisioned SCIM user could not be read back");
  return scimJson(toScimUser(row, ctx.baseUrl), 201, {
    Location: `${ctx.baseUrl}/Users/${row.id}`
  });
}

async function replaceUser(
  ctx: Ctx,
  id: string,
  body: unknown
): Promise<Response> {
  const invalid = invalidBody(body);
  if (invalid) return invalid;
  const row = await readScimUser(ctx, id);
  if (!row) return scimError(404, "User not found.");
  const parsed = readUserResource(body);
  if (!parsed.ok) return scimError(400, parsed.detail, parsed.scimType);
  return applyUserState(ctx, row, parsed.value);
}

async function patchUser(
  ctx: Ctx,
  id: string,
  body: unknown
): Promise<Response> {
  const invalid = invalidBody(body);
  if (invalid) return invalid;
  const row = await readScimUser(ctx, id);
  if (!row) return scimError(404, "User not found.");
  const patched = applyUserPatch(stateOf(row), body);
  if (!patched.ok) return scimError(400, patched.detail, patched.scimType);
  return applyUserState(ctx, row, patched.value);
}

/**
 * Store the IdP's new view of the person and act on the change. Only a change
 * of `active` moves membership, so a manual deactivation in Carbon sticks
 * until the IdP itself deactivates and reactivates the person. The sign-in
 * email never changes from here.
 */
async function applyUserState(
  ctx: Ctx,
  row: ScimUserRecord,
  next: ScimUserState
): Promise<Response> {
  try {
    await ctx.db
      .updateTable("scimUser")
      .set({
        userName: next.userName,
        externalId: next.externalId,
        email: next.email,
        givenName: next.givenName,
        familyName: next.familyName,
        active: next.active,
        updatedBy: SYSTEM_USER_ID,
        updatedAt: sql`now()`
      })
      .where("id", "=", row.id)
      .where("companyId", "=", ctx.companyId)
      .execute();
  } catch (err) {
    if (isUniqueViolation(err)) {
      return scimError(409, "A user with this userName exists.", "uniqueness");
    }
    throw err;
  }

  if (row.active && !next.active) {
    await deactivateScimUser(ctx, row);
  } else if (!row.active && next.active) {
    const refusal = await reactivateScimUser(ctx, row);
    if (refusal) return refusal;
  }

  const nameChanged =
    next.givenName !== row.givenName || next.familyName !== row.familyName;
  if (
    nameChanged &&
    (next.givenName || next.familyName) &&
    !(await hasOtherCompany(ctx.db, row.userId, ctx.companyId))
  ) {
    await ctx.db
      .updateTable("user")
      .set({
        firstName: next.givenName ?? "",
        lastName: next.familyName ?? ""
      })
      .where("id", "=", row.userId)
      .where("active", "=", true)
      .execute();
  }

  const updated = await readScimUser(ctx, row.id);
  return updated
    ? scimJson(toScimUser(updated, ctx.baseUrl))
    : scimError(404, "User not found.");
}

/**
 * Offboard the person from this company: membership, grants, API keys and —
 * when no company is left — every session. Each step is idempotent and
 * logged, so the IdP's retry finishes whatever a failure left undone.
 */
async function deactivateScimUser(
  ctx: Ctx,
  row: ScimUserRecord
): Promise<void> {
  const { userId } = row;

  const deactivated = await deactivateUser(
    ctx.serviceRole,
    userId,
    ctx.companyId
  );
  if (!deactivated.success) {
    logger.error("SCIM deactivation failed to remove the membership", {
      userId,
      companyId: ctx.companyId,
      message: deactivated.message
    });
  }

  // A key authenticates as its creator and nothing re-checks membership, so a
  // key that outlives the membership keeps the person's access open.
  const keys = await ctx.serviceRole
    .from("apiKey")
    .select("id, keyHash")
    .eq("createdBy", userId)
    .eq("companyId", ctx.companyId);
  if (keys.error) {
    logger.error("Failed to read the API keys of a deactivated SCIM user", {
      userId,
      error: keys.error
    });
  } else if (keys.data.length > 0) {
    const removed = await ctx.serviceRole
      .from("apiKey")
      .delete()
      .eq("companyId", ctx.companyId)
      .in(
        "id",
        keys.data.map((key) => key.id)
      );
    if (removed.error) {
      logger.error("Failed to delete the API keys of a deactivated SCIM user", {
        userId,
        error: removed.error
      });
    }
    await Promise.all(
      keys.data
        .map((key) => key.keyHash)
        .filter((hash): hash is string => Boolean(hash))
        .map(bustApiKeyCache)
    );
  }

  // Another company still trusts this session; leave it. With none left,
  // revoke every refresh token (GoTrue reads a token with no session_id as
  // "all sessions").
  const remaining = await ctx.serviceRole
    .from("userToCompany")
    .select("companyId", { count: "exact", head: true })
    .eq("userId", userId);
  if (remaining.error) {
    logger.error("Failed to count the remaining companies of a SCIM user", {
      userId,
      error: remaining.error
    });
  } else if ((remaining.count ?? 0) === 0) {
    try {
      const signedOut = await ctx.serviceRole.auth.admin.signOut(
        await signUserAccessToken(userId),
        "global"
      );
      if (signedOut.error) throw signedOut.error;
    } catch (err) {
      logger.error("Failed to end the sessions of a deactivated SCIM user", {
        userId,
        error: err
      });
    }
  }

  await syncSeats(ctx.companyId);
  await auditEmployees(ctx.serviceRole, ctx.connection, [
    { userId, operation: "UPDATE", diff: { active: { old: true, new: false } } }
  ]);
}

/** The employee type a person's mapped groups give, or null with no mapping. */
async function mappedTypeFor(
  db: Kysely<KyselyDatabase> | Transaction<KyselyDatabase>,
  ctx: Ctx,
  scimUserId: string
): Promise<string | null> {
  if (!(await hasMappedGroup(db, ctx.companyId))) return null;
  const groups = await db
    .selectFrom("scimGroupMember as m")
    .innerJoin("scimGroup as g", (join) =>
      join
        .onRef("g.id", "=", "m.groupId")
        .onRef("g.companyId", "=", "m.companyId")
    )
    .select(["g.employeeTypeId", "g.priority", "g.displayName"])
    .where("m.companyId", "=", ctx.companyId)
    .where("m.scimUserId", "=", scimUserId)
    .execute();
  return pickEmployeeType(groups, ctx.connection.defaultEmployeeTypeId);
}

async function reactivateScimUser(
  ctx: Ctx,
  row: ScimUserRecord
): Promise<Response | null> {
  const { userId } = row;
  let employeeTypeId: string;
  try {
    employeeTypeId = await ctx.db.transaction().execute(async (trx) => {
      const membership = await trx
        .selectFrom("userToCompany")
        .select("role")
        .where("userId", "=", userId)
        .where("companyId", "=", ctx.companyId)
        .executeTakeFirst();
      if (membership && membership.role !== "employee") {
        throw new ScimRefusal(
          409,
          "This person is a customer or supplier contact in this company.",
          "uniqueness"
        );
      }

      const employee = await trx
        .selectFrom("employee")
        .select("employeeTypeId")
        .where("id", "=", userId)
        .where("companyId", "=", ctx.companyId)
        .executeTakeFirst();

      const typeId =
        (await mappedTypeFor(trx, ctx, row.id)) ??
        employee?.employeeTypeId ??
        ctx.connection.defaultEmployeeTypeId;

      await trx
        .insertInto("employee")
        .values({
          id: userId,
          companyId: ctx.companyId,
          employeeTypeId: typeId,
          active: true
        })
        .onConflict((oc) =>
          oc
            .columns(["id", "companyId"])
            .doUpdateSet({ employeeTypeId: typeId, active: true })
        )
        .execute();

      await trx
        .insertInto("employeeJob")
        .values({
          id: userId,
          companyId: ctx.companyId,
          locationId: ctx.connection.defaultLocationId
        })
        .onConflict((oc) => oc.columns(["id", "companyId"]).doNothing())
        .execute();

      await trx
        .insertInto("userToCompany")
        .values({ userId, companyId: ctx.companyId, role: "employee" })
        .onConflict((oc) => oc.columns(["userId", "companyId"]).doNothing())
        .execute();

      const grants = await readTypeGrants(trx, ctx.companyId, [typeId]);
      await writeCompanyGrants(
        trx,
        ctx.companyId,
        new Map([[userId, grants.get(typeId) ?? []]])
      );
      return typeId;
    });
  } catch (err) {
    if (err instanceof ScimRefusal) {
      // Keep the IdP's view honest: the person is still inactive here.
      await ctx.db
        .updateTable("scimUser")
        .set({ active: false })
        .where("id", "=", row.id)
        .where("companyId", "=", ctx.companyId)
        .execute();
      return scimError(err.status, err.message, err.scimType);
    }
    throw err;
  }

  await clearPermissionCaches([userId]);
  await syncSeats(ctx.companyId);
  await auditEmployees(ctx.serviceRole, ctx.connection, [
    {
      userId,
      operation: "UPDATE",
      diff: {
        active: { old: false, new: true },
        employeeTypeId: { new: employeeTypeId }
      }
    }
  ]);
  return null;
}

async function deleteUser(ctx: Ctx, id: string): Promise<Response> {
  const row = await readScimUser(ctx, id);
  if (!row) return scimError(404, "User not found.");
  if (row.active) await deactivateScimUser(ctx, row);
  await ctx.db
    .deleteFrom("scimUser")
    .where("id", "=", row.id)
    .where("companyId", "=", ctx.companyId)
    .execute();
  return new Response(null, { status: 204 });
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

const GROUP_COLUMNS = "id, displayName, externalId, createdAt, updatedAt";

function excludesMembers(url: URL): boolean {
  const excluded = url.searchParams.get("excludedAttributes") ?? "";
  return excluded
    .split(",")
    .some((name) => name.trim().toLowerCase() === "members");
}

async function readGroupMembers(
  ctx: Ctx,
  groupIds: string[]
): Promise<Map<string, { value: string; display: string }[]>> {
  const members = new Map<string, { value: string; display: string }[]>(
    groupIds.map((id) => [id, []])
  );
  if (groupIds.length === 0) return members;
  const rows = await ctx.db
    .selectFrom("scimGroupMember as m")
    .innerJoin("scimUser as u", (join) =>
      join
        .onRef("u.id", "=", "m.scimUserId")
        .onRef("u.companyId", "=", "m.companyId")
    )
    .select(["m.groupId", "m.scimUserId", "u.userName"])
    .where("m.companyId", "=", ctx.companyId)
    .where("m.groupId", "in", groupIds)
    .orderBy("u.userName")
    .execute();
  for (const row of rows) {
    members
      .get(row.groupId)
      ?.push({ value: row.scimUserId, display: row.userName });
  }
  return members;
}

async function listGroups(ctx: Ctx, url: URL): Promise<Response> {
  const filter = parseScimFilter(url.searchParams.get("filter"));
  if (!filter.ok) return scimError(400, filter.detail, filter.scimType);
  const { startIndex, count } = parsePaging(url);

  let query = ctx.serviceRole
    .from("scimGroup")
    .select(GROUP_COLUMNS, { count: "exact" })
    .eq("companyId", ctx.companyId);

  for (const { attribute, value } of filter.value) {
    switch (attribute.toLowerCase()) {
      case "displayname":
        query = query.ilike("displayName", exactPattern(value));
        break;
      case "externalid":
        query = query.eq("externalId", value);
        break;
      case "id":
        query = query.eq("id", value);
        break;
      default:
        return scimError(
          400,
          `Carbon cannot filter Groups by "${attribute}".`,
          "invalidFilter"
        );
    }
  }

  const page =
    count === 0
      ? await query.order("createdAt").order("id").limit(1)
      : await query
          .order("createdAt")
          .order("id")
          .range(startIndex - 1, startIndex - 2 + count);
  if (page.error) throw page.error;

  const rows = count === 0 ? [] : (page.data ?? []);
  const members = excludesMembers(url)
    ? null
    : await readGroupMembers(
        ctx,
        rows.map((row) => row.id)
      );
  return scimJson(
    scimListResponse(
      rows.map((row) =>
        toScimGroup(row, members?.get(row.id) ?? null, ctx.baseUrl)
      ),
      { totalResults: page.count ?? rows.length, startIndex }
    )
  );
}

async function readGroup(ctx: Ctx, id: string) {
  const result = await ctx.serviceRole
    .from("scimGroup")
    .select(GROUP_COLUMNS)
    .eq("id", id)
    .eq("companyId", ctx.companyId)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data;
}

async function getGroup(ctx: Ctx, id: string, url: URL): Promise<Response> {
  const row = await readGroup(ctx, id);
  if (!row) return scimError(404, "Group not found.");
  const members = excludesMembers(url)
    ? null
    : ((await readGroupMembers(ctx, [row.id])).get(row.id) ?? []);
  return scimJson(toScimGroup(row, members, ctx.baseUrl));
}

/** Keep only the member ids that name a person of this company. */
async function knownMembers(ctx: Ctx, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await ctx.db
    .selectFrom("scimUser")
    .select("id")
    .where("companyId", "=", ctx.companyId)
    .where("id", "in", ids)
    .execute();
  return rows.map((row) => row.id);
}

/** Write a group's name and members; answer the people whose groups changed. */
async function writeGroup(
  ctx: Ctx,
  groupId: string,
  state: ScimGroupState
): Promise<string[]> {
  const wanted = new Set(await knownMembers(ctx, state.memberIds));

  return ctx.db.transaction().execute(async (trx) => {
    await trx
      .updateTable("scimGroup")
      .set({
        displayName: state.displayName,
        externalId: state.externalId,
        updatedBy: SYSTEM_USER_ID,
        updatedAt: sql`now()`
      })
      .where("id", "=", groupId)
      .where("companyId", "=", ctx.companyId)
      .execute();

    const current = await trx
      .selectFrom("scimGroupMember")
      .select("scimUserId")
      .where("groupId", "=", groupId)
      .where("companyId", "=", ctx.companyId)
      .execute();
    const have = new Set(current.map((row) => row.scimUserId));

    const removed = [...have].filter((id) => !wanted.has(id));
    const added = [...wanted].filter((id) => !have.has(id));

    if (removed.length > 0) {
      await trx
        .deleteFrom("scimGroupMember")
        .where("groupId", "=", groupId)
        .where("companyId", "=", ctx.companyId)
        .where("scimUserId", "in", removed)
        .execute();
    }
    if (added.length > 0) {
      await trx
        .insertInto("scimGroupMember")
        .values(
          added.map((scimUserId) => ({
            groupId,
            scimUserId,
            companyId: ctx.companyId
          }))
        )
        .onConflict((oc) => oc.doNothing())
        .execute();
    }
    return [...removed, ...added];
  });
}

async function createGroup(ctx: Ctx, body: unknown): Promise<Response> {
  const invalid = invalidBody(body);
  if (invalid) return invalid;
  const parsed = readGroupResource(body);
  if (!parsed.ok) return scimError(400, parsed.detail, parsed.scimType);

  let groupId: string;
  try {
    const inserted = await ctx.db
      .insertInto("scimGroup")
      .values({
        companyId: ctx.companyId,
        connectionId: ctx.connection.id,
        displayName: parsed.value.displayName,
        externalId: parsed.value.externalId,
        createdBy: SYSTEM_USER_ID
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    groupId = inserted.id;
  } catch (err) {
    if (isUniqueViolation(err)) {
      return scimError(
        409,
        "A group with this displayName exists.",
        "uniqueness"
      );
    }
    throw err;
  }

  const changed = await writeGroup(ctx, groupId, parsed.value);
  await reconcileEmployeeTypes(ctx.db, ctx.serviceRole, {
    connection: ctx.connection,
    scimUserIds: changed
  });

  const row = await readGroup(ctx, groupId);
  if (!row)
    throw new Error("The provisioned SCIM group could not be read back");
  const members = (await readGroupMembers(ctx, [groupId])).get(groupId) ?? [];
  return scimJson(toScimGroup(row, members, ctx.baseUrl), 201, {
    Location: `${ctx.baseUrl}/Groups/${groupId}`
  });
}

async function groupState(
  ctx: Ctx,
  row: { id: string; displayName: string; externalId: string | null }
): Promise<ScimGroupState> {
  const members = await ctx.db
    .selectFrom("scimGroupMember")
    .select("scimUserId")
    .where("groupId", "=", row.id)
    .where("companyId", "=", ctx.companyId)
    .execute();
  return {
    displayName: row.displayName,
    externalId: row.externalId,
    memberIds: members.map((member) => member.scimUserId)
  };
}

async function saveGroup(
  ctx: Ctx,
  groupId: string,
  state: ScimGroupState
): Promise<Response | null> {
  try {
    const changed = await writeGroup(ctx, groupId, state);
    await reconcileEmployeeTypes(ctx.db, ctx.serviceRole, {
      connection: ctx.connection,
      scimUserIds: changed
    });
    return null;
  } catch (err) {
    if (isUniqueViolation(err)) {
      return scimError(
        409,
        "A group with this displayName exists.",
        "uniqueness"
      );
    }
    throw err;
  }
}

async function replaceGroup(
  ctx: Ctx,
  id: string,
  body: unknown
): Promise<Response> {
  const invalid = invalidBody(body);
  if (invalid) return invalid;
  const row = await readGroup(ctx, id);
  if (!row) return scimError(404, "Group not found.");
  const parsed = readGroupResource(body);
  if (!parsed.ok) return scimError(400, parsed.detail, parsed.scimType);

  const refusal = await saveGroup(ctx, row.id, parsed.value);
  if (refusal) return refusal;
  return getGroup(ctx, row.id, new URL(`${ctx.baseUrl}/Groups/${row.id}`));
}

async function patchGroup(
  ctx: Ctx,
  id: string,
  body: unknown
): Promise<Response> {
  const invalid = invalidBody(body);
  if (invalid) return invalid;
  const row = await readGroup(ctx, id);
  if (!row) return scimError(404, "Group not found.");
  const patched = applyGroupPatch(await groupState(ctx, row), body);
  if (!patched.ok) return scimError(400, patched.detail, patched.scimType);

  const refusal = await saveGroup(ctx, row.id, patched.value);
  if (refusal) return refusal;
  return new Response(null, { status: 204 });
}

async function deleteGroup(ctx: Ctx, id: string): Promise<Response> {
  const row = await readGroup(ctx, id);
  if (!row) return scimError(404, "Group not found.");
  const { memberIds } = await groupState(ctx, row);
  await ctx.db
    .deleteFrom("scimGroup")
    .where("id", "=", row.id)
    .where("companyId", "=", ctx.companyId)
    .execute();
  await reconcileEmployeeTypes(ctx.db, ctx.serviceRole, {
    connection: ctx.connection,
    scimUserIds: memberIds
  });
  return new Response(null, { status: 204 });
}

// ---------------------------------------------------------------------------
// Group → employee type
// ---------------------------------------------------------------------------

async function hasMappedGroup(
  db: Kysely<KyselyDatabase> | Transaction<KyselyDatabase>,
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
 * Bring each active provisioned person's employee type in line with their
 * mapped groups: the mapped group with the lowest priority, else the
 * connection's default type. A person whose type changes gets this company's
 * grants rewritten from the new type. With no mapped group at all, SCIM never
 * changes a type, so admins keep full control until they map one.
 *
 * `scimUserIds` limits the pass to the people a group change touched; omit it
 * to reconcile everyone (after a mapping or default-type change).
 */
export async function reconcileEmployeeTypes(
  db: Kysely<KyselyDatabase>,
  serviceRole: SupabaseClient<Database>,
  {
    connection,
    scimUserIds
  }: { connection: ScimConnectionRow; scimUserIds?: string[] }
): Promise<{ changed: number }> {
  const { companyId } = connection;
  if (scimUserIds && scimUserIds.length === 0) return { changed: 0 };
  if (!(await hasMappedGroup(db, companyId))) return { changed: 0 };

  let peopleQuery = db
    .selectFrom("scimUser")
    .select(["id", "userId"])
    .where("companyId", "=", companyId)
    .where("active", "=", true);
  if (scimUserIds) peopleQuery = peopleQuery.where("id", "in", scimUserIds);
  const people = await peopleQuery.execute();
  if (people.length === 0) return { changed: 0 };

  const memberships = await db
    .selectFrom("scimGroupMember as m")
    .innerJoin("scimGroup as g", (join) =>
      join
        .onRef("g.id", "=", "m.groupId")
        .onRef("g.companyId", "=", "m.companyId")
    )
    .select(["m.scimUserId", "g.employeeTypeId", "g.priority", "g.displayName"])
    .where("m.companyId", "=", companyId)
    .where(
      "m.scimUserId",
      "in",
      people.map((person) => person.id)
    )
    .execute();

  const desired = new Map<string, string>(
    people.map((person) => [
      person.userId,
      pickEmployeeType(
        memberships.filter((m) => m.scimUserId === person.id),
        connection.defaultEmployeeTypeId
      )
    ])
  );

  const employees = await db
    .selectFrom("employee")
    .select(["id", "employeeTypeId"])
    .where("companyId", "=", companyId)
    .where("active", "=", true)
    .where("id", "in", [...desired.keys()])
    .execute();

  const changes = employees
    .filter((employee) => desired.get(employee.id) !== employee.employeeTypeId)
    .map((employee) => ({
      userId: employee.id,
      from: employee.employeeTypeId,
      to: desired.get(employee.id) as string
    }));
  if (changes.length === 0) return { changed: 0 };

  await db.transaction().execute(async (trx) => {
    const typeIds = [...new Set(changes.map((change) => change.to))];
    const grants = await readTypeGrants(trx, companyId, typeIds);

    // Only types of this company may be assigned; a mapping to a deleted or
    // foreign type would otherwise land through employee's single-column FK.
    const ownTypes = await trx
      .selectFrom("employeeType")
      .select("id")
      .where("companyId", "=", companyId)
      .where("id", "in", typeIds)
      .execute();
    const owned = new Set(ownTypes.map((type) => type.id));

    for (const typeId of typeIds) {
      if (!owned.has(typeId)) continue;
      await trx
        .updateTable("employee")
        .set({ employeeTypeId: typeId })
        .where("companyId", "=", companyId)
        .where(
          "id",
          "in",
          changes
            .filter((change) => change.to === typeId)
            .map((change) => change.userId)
        )
        .execute();
    }

    await writeCompanyGrants(
      trx,
      companyId,
      new Map(
        changes
          .filter((change) => owned.has(change.to))
          .map((change) => [change.userId, grants.get(change.to) ?? []])
      )
    );
  });

  await clearPermissionCaches(changes.map((change) => change.userId));
  await auditEmployees(
    serviceRole,
    connection,
    changes.map((change) => ({
      userId: change.userId,
      operation: "UPDATE" as const,
      diff: { employeeTypeId: { old: change.from, new: change.to } }
    }))
  );
  return { changed: changes.length };
}
