// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/**
 * `/Users`. SCIM only ever touches people it manages (a `scimUser` row): an
 * employee the IdP never provisioned is never listed, changed or deactivated.
 */

import { CONTROLLED_ENVIRONMENT } from "@carbon/auth";
import {
  getCarbonServiceRoleAs,
  signUserAccessToken
} from "@carbon/auth/client.server";
import { deactivateUser } from "@carbon/auth/users.server";
import { sql } from "kysely";
import {
  getSsoConnection,
  getSsoConnectionByDomain
} from "../sso/connections.server";
import { isSsoEnabled } from "../sso/gate";
import {
  emailDomain,
  seedSsoIdentityForUser,
  uncoveredSsoDomainError
} from "../sso/provisioning.server";
import {
  joinCompany,
  mappedTypeFor,
  readEmployeeMembership,
  writeName
} from "./access.server";
import {
  applyUserPatch,
  parsePaging,
  parseScimBoolean,
  parseScimFilter,
  readUserResource,
  type ScimUserRow,
  type ScimUserState,
  scimError,
  scimJson,
  scimListResponse,
  toScimUser
} from "./protocol";
import {
  CONTROLLED_REFUSAL,
  type Ctx,
  clearPermissionCaches,
  idsMatchingWithoutCase,
  isUniqueViolation,
  labelAsScim,
  logger,
  missingDefault,
  readListPage,
  SCIM_ACTOR_LABEL,
  ScimRefusal,
  SYSTEM_USER_ID,
  syncSeats
} from "./shared.server";

const USER_COLUMNS =
  "id, userId, userName, externalId, email, givenName, familyName, active, createdAt, updatedAt";

type ScimUserRecord = ScimUserRow & { userId: string };

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

function userNotFound(): Response {
  return scimError(404, "User not found.");
}

export async function listUsers(ctx: Ctx, url: URL): Promise<Response> {
  const filter = parseScimFilter(url.searchParams.get("filter"));
  if (!filter.ok) return scimError(400, filter.detail, filter.scimType);
  const { startIndex, count } = parsePaging(url);

  // A factory, not one builder: supabase-js builders are mutable, and an
  // out-of-range page needs a second (count-only) read with the same filters.
  const newQuery = (head: boolean) =>
    ctx.serviceRole
      .from("scimUser")
      .select(USER_COLUMNS, { count: "exact", head })
      .eq("companyId", ctx.companyId);
  const filters: Array<(q: ReturnType<typeof newQuery>) => typeof q> = [];
  const filtered = (head: boolean) =>
    filters.reduce((q, apply) => apply(q), newQuery(head));

  for (const { attribute, value } of filter.value) {
    switch (attribute.toLowerCase()) {
      case "username": {
        const ids = await idsMatchingWithoutCase(
          ctx,
          "scimUser",
          "userName",
          value
        );
        if (ids.length === 0) {
          return scimJson(
            scimListResponse([], { totalResults: 0, startIndex })
          );
        }
        filters.push((q) => q.in("id", ids));
        break;
      }
      case "externalid":
        filters.push((q) => q.eq("externalId", value));
        break;
      case "emails":
      case "emails.value":
        filters.push((q) => q.eq("email", value.toLowerCase()));
        break;
      case "id":
        filters.push((q) => q.eq("id", value));
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
        filters.push((q) => q.eq("active", active));
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

  const { rows, totalResults } = await readListPage(count, {
    rows: () =>
      filtered(false)
        .order("createdAt")
        .order("id")
        .range(startIndex - 1, startIndex - 2 + count),
    total: () => filtered(true)
  });
  return scimJson(
    scimListResponse(
      rows.map((row) => toScimUser(row, ctx.baseUrl)),
      { totalResults, startIndex }
    )
  );
}

export async function getUser(ctx: Ctx, id: string): Promise<Response> {
  const row = await readScimUser(ctx, id);
  return row ? scimJson(toScimUser(row, ctx.baseUrl)) : userNotFound();
}

export async function createUser(ctx: Ctx, body: unknown): Promise<Response> {
  const parsed = readUserResource(body);
  if (!parsed.ok) return scimError(400, parsed.detail, parsed.scimType);
  const state = parsed.value;

  const duplicates = await idsMatchingWithoutCase(
    ctx,
    "scimUser",
    "userName",
    state.userName
  );
  if (duplicates.length > 0) {
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

  if (await missingDefault(ctx.db, ctx.companyId, ctx.connection)) {
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
    if (CONTROLLED_ENVIRONMENT) return scimError(403, CONTROLLED_REFUSAL);

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

  // So the person's first SAML sign-in links to this account.
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

  let outcome: { scimUserId: string; joined: boolean };
  try {
    outcome = await ctx.db.transaction().execute(async (trx) => {
      await labelAsScim(trx);
      const { isMember, employee } = await readEmployeeMembership(
        trx,
        ctx.companyId,
        userId
      );

      // An active employee is adopted as is: same type, same grants.
      const adopt = isMember && employee?.active === true;
      // An invite records the U.S.-person attestation; SCIM cannot give it.
      if (CONTROLLED_ENVIRONMENT && !adopt) {
        throw new ScimRefusal(403, CONTROLLED_REFUSAL);
      }
      if (!adopt) {
        await joinCompany(trx, ctx, {
          userId,
          employeeTypeId: ctx.connection.defaultEmployeeTypeId,
          active: state.active
        });
      }

      // The IdP now manages the person, so an open invite must not stay redeemable.
      await trx
        .updateTable("invite")
        .set({ revokedAt: sql`now()` })
        .where("email", "=", state.email)
        .where("companyId", "=", ctx.companyId)
        .where("acceptedAt", "is", null)
        .where("revokedAt", "is", null)
        .execute();

      await writeName(trx, ctx.companyId, userId, state);

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

      return { scimUserId: inserted.id, joined: !adopt && state.active };
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
    if (err instanceof ScimRefusal) return err.toResponse();
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
  if (outcome.joined) await syncSeats(ctx.companyId);

  const row = await readScimUser(ctx, outcome.scimUserId);
  if (!row) throw new Error("The provisioned SCIM user could not be read back");
  return scimJson(toScimUser(row, ctx.baseUrl), 201, {
    Location: `${ctx.baseUrl}/Users/${row.id}`
  });
}

export async function replaceUser(
  ctx: Ctx,
  id: string,
  body: unknown
): Promise<Response> {
  const row = await readScimUser(ctx, id);
  if (!row) return userNotFound();
  const parsed = readUserResource(body);
  if (!parsed.ok) return scimError(400, parsed.detail, parsed.scimType);
  return applyUserState(ctx, row, parsed.value);
}

export async function patchUser(
  ctx: Ctx,
  id: string,
  body: unknown
): Promise<Response> {
  const row = await readScimUser(ctx, id);
  if (!row) return userNotFound();
  const patched = applyUserPatch(
    {
      userName: row.userName,
      externalId: row.externalId,
      email: row.email,
      givenName: row.givenName,
      familyName: row.familyName,
      active: row.active
    },
    body
  );
  if (!patched.ok) return scimError(400, patched.detail, patched.scimType);
  return applyUserState(ctx, row, patched.value);
}

export async function deleteUser(ctx: Ctx, id: string): Promise<Response> {
  const row = await readScimUser(ctx, id);
  if (!row) return userNotFound();
  if (row.active && !(await deactivateScimUser(ctx, row))) {
    return offboardingFailed();
  }
  await ctx.db
    .deleteFrom("scimUser")
    .where("id", "=", row.id)
    .where("companyId", "=", ctx.companyId)
    .execute();
  return new Response(null, { status: 204 });
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

  // `active` is stored only after Carbon has acted on it: if offboarding
  // fails, the row stays active and the 500 makes the IdP send it again.
  if (row.active && !next.active) {
    if (!(await deactivateScimUser(ctx, row))) return offboardingFailed();
  } else if (!row.active && next.active) {
    const refusal = await reactivateScimUser(ctx, row);
    if (refusal) return refusal;
  }
  if (row.active !== next.active) {
    await ctx.db
      .updateTable("scimUser")
      .set({ active: next.active })
      .where("id", "=", row.id)
      .where("companyId", "=", ctx.companyId)
      .execute();
  }

  if (next.givenName !== row.givenName || next.familyName !== row.familyName) {
    await writeName(ctx.db, ctx.companyId, row.userId, next);
  }

  const updated = await readScimUser(ctx, row.id);
  return updated ? scimJson(toScimUser(updated, ctx.baseUrl)) : userNotFound();
}

function offboardingFailed(): Response {
  return scimError(
    500,
    "Carbon could not finish removing this person from the company. Retry the request."
  );
}

/**
 * Remove the person from this company (`deactivateUser` also deletes their
 * API keys here) and, when no company is left, end every session. False when
 * they could still have access, so the IdP retries; a failed sign-out is only
 * logged, since the membership is already gone.
 */
async function deactivateScimUser(
  ctx: Ctx,
  row: ScimUserRecord
): Promise<boolean> {
  const { userId } = row;
  // The labelled client makes the audit log show these changes as "SCIM".
  const deactivated = await deactivateUser(
    getCarbonServiceRoleAs(SCIM_ACTOR_LABEL),
    userId,
    ctx.companyId
  );
  if (!deactivated.success) {
    logger.error("SCIM deactivation failed", {
      userId,
      companyId: ctx.companyId,
      message: deactivated.message
    });
    return false;
  }

  // A session another company still trusts stays. With none left, revoke
  // every refresh token: GoTrue reads a token with no session_id as "all".
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
  return true;
}

/** Bring the person back with their mapped type, else the type they had. */
async function reactivateScimUser(
  ctx: Ctx,
  row: ScimUserRecord
): Promise<Response | null> {
  if (CONTROLLED_ENVIRONMENT) return scimError(403, CONTROLLED_REFUSAL);
  const { userId } = row;
  try {
    await ctx.db.transaction().execute(async (trx) => {
      await labelAsScim(trx);
      const { employee } = await readEmployeeMembership(
        trx,
        ctx.companyId,
        userId
      );
      await joinCompany(trx, ctx, {
        userId,
        employeeTypeId:
          (await mappedTypeFor(trx, ctx, row.id)) ??
          employee?.employeeTypeId ??
          ctx.connection.defaultEmployeeTypeId,
        active: true
      });
    });
  } catch (err) {
    if (err instanceof ScimRefusal) return err.toResponse();
    throw err;
  }

  await clearPermissionCaches([userId]);
  await syncSeats(ctx.companyId);
  return null;
}
