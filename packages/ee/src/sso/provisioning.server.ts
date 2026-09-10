import { getPermissionCacheKey } from "@carbon/auth";
import type { Database } from "@carbon/database";
import type { KyselyDatabase } from "@carbon/database/client";
import { redis } from "@carbon/kv";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Kysely } from "kysely";
import { sql } from "kysely";

const logger = getLogger("ee");

/**
 * Move the SAML identity GoTrue created for a duplicate auth user onto the
 * account that already owns the email. This writes the auth schema directly
 * (self-hosted Supabase — Carbon SSO's only supported deployment).
 * The caller MUST have verified the asserted email's domain belongs to the
 * SSO connection first (rogue-IdP defense), and deletes the duplicate auth
 * user afterwards. After the move, every future SSO login resolves straight
 * to the existing account — nothing is archived, magic link keeps working.
 *
 * Any "sso:" identity ALREADY on the target is deleted first: this function
 * only runs when GoTrue minted a fresh duplicate, so the identity that just
 * authenticated lives on `fromUserId` and a pre-existing one on `toUserId`
 * can only point at a dead provider (deactivate → re-create). Left in place,
 * getSsoProviderIdFromUser could resolve the stale provider id and lock the
 * account out of SSO permanently. Both statements share one transaction, so
 * a failed move never leaves the target with its old identity deleted; if
 * the move itself fails, the next SSO login re-creates the duplicate and
 * retries — self-healing.
 */
export async function linkSsoIdentityToUser(
  db: Kysely<KyselyDatabase>,
  {
    fromUserId,
    toUserId
  }: {
    fromUserId: string;
    toUserId: string;
  }
): Promise<{ data: { moved: number } | null; error: string | null }> {
  try {
    const moved = await db.transaction().execute(async (trx) => {
      await sql`
        DELETE FROM auth.identities
        WHERE user_id = ${toUserId}::uuid AND provider LIKE 'sso:%'
      `.execute(trx);
      const result = await sql`
        UPDATE auth.identities
        SET user_id = ${toUserId}::uuid, updated_at = now()
        WHERE user_id = ${fromUserId}::uuid AND provider LIKE 'sso:%'
      `.execute(trx);
      return Number(result.numAffectedRows ?? 0);
    });
    return {
      data: { moved },
      error: null
    };
  } catch (err) {
    logger.error("Failed to link SSO identity", {
      fromUserId,
      toUserId,
      error: err
    });
    return {
      data: null,
      error:
        err instanceof Error ? err.message : "Failed to link SAML SSO identity"
    };
  }
}

// --- Pre-seeded SSO identities (provider-agnostic account linking) ----------
// Carbon runs GoTrue with GOTRUE_DISABLE_SIGNUP=true, so a SAML sign-in that
// resolves to "create a new user" is rejected (422). Pre-seeding an
// auth.identities row for an existing user makes GoTrue take the
// LinkAccount/AccountExists branch instead — no signup, the existing UUID is
// kept, and password/Google/magic-link all keep working.
//
// The match that carries the load is the GENERATED `email` column
// (lower(identity_data->>'email')), NOT provider_id: GoTrue v2.177.0 marks every
// SAML assertion email Verified and hard-rejects an emailless assertion, so its
// email-column fallback in DetermineAccountLinking fires for EVERY successful
// SAML sign-in — for any IdP (Okta, Entra, OneLogin, Ping, Google, JumpCloud,
// ADFS). Keying on provider_id would only work for IdPs whose NameID is the
// email (Okta); Entra's default is an opaque persistent pairwise id. `provider_id`
// here is just a readable placeholder. GoTrue self-heals on the next login by
// creating a row keyed on the real NameID, which then resolves via AccountExists.

/** The auth.identities.provider value for a GoTrue SSO provider id. */
export function ssoProviderColumn(providerId: string): string {
  return `sso:${providerId}`;
}

/** The lowercased domain of an email, or null (mirrors uncoveredSsoDomainError). */
export function emailDomain(email: string): string | null {
  return email.split("@")[1]?.trim().toLowerCase() ?? null;
}

/**
 * Pre-seed one SSO identity so a single existing/invited user links on their
 * next SAML sign-in. Idempotent (ON CONFLICT DO NOTHING). Off-Enterprise callers
 * must gate on isSsoEnabled() before calling — this writes the auth schema
 * unconditionally.
 */
export async function seedSsoIdentityForUser(
  db: Kysely<KyselyDatabase>,
  {
    userId,
    email,
    providerId
  }: {
    userId: string;
    email: string;
    providerId: string;
  }
): Promise<{ data: { seeded: boolean } | null; error: string | null }> {
  const lowerEmail = email.toLowerCase();
  const provider = ssoProviderColumn(providerId);
  try {
    const result = await sql`
      INSERT INTO auth.identities
        (provider_id, user_id, identity_data, provider, created_at, updated_at)
      VALUES (
        ${lowerEmail},
        ${userId}::uuid,
        jsonb_build_object('sub', ${lowerEmail}::text, 'email', ${lowerEmail}::text),
        ${provider},
        now(),
        now()
      )
      ON CONFLICT (provider_id, provider) DO NOTHING
    `.execute(db);
    return {
      data: { seeded: Number(result.numAffectedRows ?? 0) > 0 },
      error: null
    };
  } catch (err) {
    logger.error("Failed to seed SSO identity", {
      userId,
      providerId,
      error: err
    });
    return {
      data: null,
      error: err instanceof Error ? err.message : "Failed to seed SSO identity"
    };
  }
}

/**
 * Backfill SSO identities for EVERY existing non-SSO user whose email is on the
 * domain — run when a domain is verified. Not company-scoped: the adopted policy
 * is that the verified domain owner controls identity for that domain
 * instance-wide (GoTrue keys linking on domain, not company). Returns the linked
 * user ids so the caller can write an audit record. Idempotent.
 */
export async function backfillSsoIdentitiesForDomain(
  db: Kysely<KyselyDatabase>,
  {
    providerId,
    domain
  }: {
    providerId: string;
    domain: string;
  }
): Promise<{ data: { linkedUserIds: string[] } | null; error: string | null }> {
  const lowerDomain = domain.toLowerCase();
  const provider = ssoProviderColumn(providerId);
  try {
    const result = await sql<{ user_id: string }>`
      INSERT INTO auth.identities
        (provider_id, user_id, identity_data, provider, created_at, updated_at)
      SELECT
        lower(u.email),
        u.id,
        jsonb_build_object('sub', lower(u.email), 'email', lower(u.email)),
        ${provider},
        now(),
        now()
      FROM auth.users u
      WHERE u.email IS NOT NULL
        AND u.is_sso_user = false
        AND lower(split_part(u.email, '@', 2)) = ${lowerDomain}
      ON CONFLICT (provider_id, provider) DO NOTHING
      RETURNING user_id
    `.execute(db);
    return {
      data: { linkedUserIds: result.rows.map((r) => r.user_id) },
      error: null
    };
  } catch (err) {
    logger.error("Failed to backfill SSO identities", {
      providerId,
      domain,
      error: err
    });
    return {
      data: null,
      error:
        err instanceof Error ? err.message : "Failed to backfill SSO identities"
    };
  }
}

/**
 * Remove this domain's SSO identities when the domain is unregistered. Keyed on
 * the GENERATED `email` column, not provider_id, so it also catches the rows
 * GoTrue self-heals with the IdP's real (possibly opaque) NameID.
 */
export async function removeSsoIdentitiesForDomain(
  db: Kysely<KyselyDatabase>,
  {
    providerId,
    domain
  }: {
    providerId: string;
    domain: string;
  }
): Promise<{ data: { removed: number } | null; error: string | null }> {
  const lowerDomain = domain.toLowerCase();
  const provider = ssoProviderColumn(providerId);
  try {
    const result = await sql`
      DELETE FROM auth.identities
      WHERE provider = ${provider}
        AND lower(split_part(email, '@', 2)) = ${lowerDomain}
    `.execute(db);
    return {
      data: { removed: Number(result.numAffectedRows ?? 0) },
      error: null
    };
  } catch (err) {
    logger.error("Failed to remove SSO identities", {
      providerId,
      domain,
      error: err
    });
    return {
      data: null,
      error:
        err instanceof Error ? err.message : "Failed to remove SSO identities"
    };
  }
}

/**
 * Remove a throwaway JIT SSO auth user COMPLETELY — the auth user AND the
 * `public."user"` / `userPermission` rows the `on_auth_user_created` trigger
 * auto-created for it. `public."user".id` has no FK to `auth.users`, so
 * deleting only the auth half (what the callback's rejection paths once did)
 * strands a profile row that trips `authIdentityExists` and makes the email
 * permanently un-invitable.
 *
 * Guarded on zero `userToCompany` memberships — re-checked here, not just at
 * the caller — so a linked or real account can never be deleted: a membership
 * means the id was attached to a company and is not a throwaway. Public rows
 * are deleted BEFORE the auth user: if the auth delete then fails, the remnant
 * is auth-only, which the next SSO attempt (or invite) resolves by itself —
 * never the un-invitable orphan.
 */
export async function deleteJitSsoUser(
  serviceRole: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  userId: string
): Promise<{ data: { deleted: boolean } | null; error: string | null }> {
  try {
    const membership = await db
      .selectFrom("userToCompany")
      .select("companyId")
      .where("userId", "=", userId)
      .limit(1)
      .executeTakeFirst();

    if (membership) {
      logger.warn("Refused to delete JIT SSO user with a company membership", {
        userId
      });
      return { data: { deleted: false }, error: null };
    }

    await db.transaction().execute(async (trx) => {
      await trx.deleteFrom("userPermission").where("id", "=", userId).execute();
      await trx.deleteFrom("user").where("id", "=", userId).execute();
    });

    const removed = await serviceRole.auth.admin.deleteUser(userId);
    if (removed.error) {
      logger.error("Failed to delete JIT SSO auth user", {
        userId,
        error: removed.error
      });
      return { data: null, error: removed.error.message };
    }

    return { data: { deleted: true }, error: null };
  } catch (err) {
    logger.error("Failed to delete JIT SSO user", { userId, error: err });
    return {
      data: null,
      error:
        err instanceof Error ? err.message : "Failed to delete JIT SSO user"
    };
  }
}

/**
 * The archived form of an INACTIVE email-holder's address. When a deactivated
 * `user` row still owns the email an SSO invite needs, `migrateUserToSso`
 * rewrites it to this form to free `index_user_email_key` for the new SSO
 * user, while preserving the original email as a suffix (the `employees`
 * view filters `u.active = TRUE`, so it is never displayed). Active accounts
 * are never archived — the callback links them instead.
 */
export function buildArchivedEmail(oldUserId: string, email: string): string {
  return `sso-archived+${oldUserId}+${email}`;
}

/**
 * Merge invite grants into a user's existing permission set — the same
 * semantics as `setUserPermissions` in the ERP users module (arrays are
 * concatenated per key; new keys are taken as-is).
 */
export function mergeInvitePermissions(
  current: Record<string, string[]>,
  granted: Record<string, string[]>
): Record<string, string[]> {
  const merged = { ...current };
  Object.entries(granted).forEach(([key, value]) => {
    const existing = merged[key];
    merged[key] = existing ? [...existing, ...value] : value;
  });
  return merged;
}

/**
 * The refusal message for an employee invite whose email domain is outside the
 * company's active SSO connection, or null when the invite may proceed. Match
 * is exact per domain (a connection covering example.com does not cover
 * sub.example.com — GoTrue routes SSO logins the same way). Stored domains are
 * lowercased by the settings validator; the email is lowercased here.
 */
export function uncoveredSsoDomainError(
  domains: string[],
  email: string
): string | null {
  const domain = email.split("@")[1]?.trim().toLowerCase();
  if (domain && domains.includes(domain)) {
    return null;
  }
  return `Single sign-on is active for ${domains.join(
    ", "
  )}. Employees must be invited with an email on a covered domain — or add this domain to the SAML SSO connection in Settings → Security.`;
}

type InviteRow = Database["public"]["Tables"]["invite"]["Row"];

type MigrateUserToSsoResult = {
  data: {
    userId: string;
    alreadyAccepted: boolean;
  } | null;
  error: string | null;
};

/**
 * Accept a pending invite for a new SSO auth identity in one transaction:
 * insert the new `user` row, activate the invite-time account row for the
 * invite's role (`employee` / `customerAccount` / `supplierAccount`), add
 * company membership + invite permissions, and accept the invite (guarded by
 * `acceptedAt IS NULL` under a FOR UPDATE lock).
 *
 * Existing ACTIVE accounts never reach this function — the callback's linking
 * branch moves the SAML identity onto them before the membership check runs.
 * This function only accepts invites for accounts with no active same-email
 * predecessor. When an INACTIVE `user` row still holds the email, its address
 * is rewritten to the archived form inside the transaction to free the unique
 * email index for the fresh insert.
 *
 * Post-commit (best-effort, logged, never thrown): permission-cache
 * invalidation for the new user id.
 */
export async function migrateUserToSso(
  db: Kysely<KyselyDatabase>,
  serviceRole: SupabaseClient<Database>,
  {
    newUserId,
    email,
    companyId,
    invite
  }: {
    newUserId: string;
    email: string;
    companyId: string;
    invite: Pick<InviteRow, "id" | "companyId" | "role" | "permissions">;
  }
): Promise<MigrateUserToSsoResult> {
  // Pre-check outside the transaction (read only): does another `user` row —
  // active or not — still hold this email? An active holder is a defensive
  // refusal (the callback's linking branch should have absorbed it); an
  // inactive holder must have its email freed before the fresh insert, or the
  // unique email index fails the insert forever.
  const emailHolderResult = await serviceRole
    .from("user")
    .select("id, active")
    .eq("email", email.toLowerCase())
    .neq("id", newUserId)
    .maybeSingle();

  if (emailHolderResult.error) {
    return { data: null, error: emailHolderResult.error.message };
  }

  const emailHolder = emailHolderResult.data;

  if (emailHolder?.active) {
    return {
      data: null,
      error:
        "An active account already owns this email and should have been linked automatically. Sign in with SAML SSO again; contact your administrator if this persists."
    };
  }

  let result: { alreadyAccepted: boolean };

  try {
    result = await db.transaction().execute(async (trx) => {
      // Lock the invite first: two concurrent SSO callbacks for the same user
      // serialize here, and the loser sees `acceptedAt` set and does nothing.
      const lockedInvite = await trx
        .selectFrom("invite")
        .select(["id", "acceptedAt", "revokedAt"])
        .where("id", "=", invite.id)
        .forUpdate()
        .executeTakeFirst();

      if (!lockedInvite) {
        throw new Error("Invite no longer exists");
      }
      if (lockedInvite.revokedAt !== null) {
        throw new Error("Invite has been revoked");
      }
      if (lockedInvite.acceptedAt !== null) {
        return { alreadyAccepted: true };
      }

      // An inactive email-holder still owns the unique email index the new
      // row needs — free it first. Guarded on `active = false` so a row that
      // was reactivated between the pre-check and this statement is never
      // touched (the insert below then fails loudly instead of silently
      // hijacking a live account's email).
      if (emailHolder) {
        await trx
          .updateTable("user")
          .set({ email: buildArchivedEmail(emailHolder.id, email) })
          .where("id", "=", emailHolder.id)
          .where("active", "=", false)
          .execute();
      }

      // Insert the new user row (the create_public_user trigger skipped it
      // when another row still held the email).
      const emailLocalPart = email.split("@")[0] ?? "";
      await trx
        .insertInto("user")
        .values({
          id: newUserId,
          email: email.toLowerCase(),
          active: true,
          firstName: emailLocalPart,
          lastName: "",
          about: ""
        })
        .onConflict((oc) => oc.column("id").doNothing())
        .execute();

      // Activate the invite-time account row for the invite's role — the SSO
      // path must finish everything acceptInvite's activate* helpers do, or a
      // covered-domain customer/supplier invite is consumed while its portal
      // account stays inactive. The row is keyed to this id (also covers a
      // linked existing account accepting an invite). A missing row is a
      // refusal, never an insert: `employee.employeeTypeId` and
      // `customerAccount.customerId` / `supplierAccount.supplierId` are
      // NOT NULL and the invite doesn't carry them — inventing one would be a
      // silent privilege decision. Re-inviting recreates the row.
      if (invite.role === "employee") {
        const employeeRow = await trx
          .updateTable("employee")
          .set({ active: true })
          .where("id", "=", newUserId)
          .where("companyId", "=", companyId)
          .returning("id")
          .executeTakeFirst();

        if (!employeeRow) {
          throw new Error(
            "No employee record exists for this invite. Ask an administrator to re-invite the user."
          );
        }
      } else if (invite.role === "customer") {
        const customerRow = await trx
          .updateTable("customerAccount")
          .set({ active: true })
          .where("id", "=", newUserId)
          .where("companyId", "=", companyId)
          .returning("id")
          .executeTakeFirst();

        if (!customerRow) {
          throw new Error(
            "No customer account exists for this invite. Ask an administrator to re-invite the user."
          );
        }
      } else if (invite.role === "supplier") {
        const supplierRow = await trx
          .updateTable("supplierAccount")
          .set({ active: true })
          .where("id", "=", newUserId)
          .where("companyId", "=", companyId)
          .returning("id")
          .executeTakeFirst();

        if (!supplierRow) {
          throw new Error(
            "No supplier account exists for this invite. Ask an administrator to re-invite the user."
          );
        }
      }

      // Company membership for the new user.
      await trx
        .insertInto("userToCompany")
        .values({ userId: newUserId, companyId, role: invite.role })
        .onConflict((oc) => oc.columns(["userId", "companyId"]).doNothing())
        .execute();

      // Merge invite permissions into userPermission (setUserPermissions
      // semantics), under lock so concurrent grants don't lose writes.
      const currentPermission = await trx
        .selectFrom("userPermission")
        .select("permissions")
        .where("id", "=", newUserId)
        .forUpdate()
        .executeTakeFirst();

      const mergedPermissions = mergeInvitePermissions(
        (currentPermission?.permissions ?? {}) as Record<string, string[]>,
        (invite.permissions ?? {}) as Record<string, string[]>
      );
      const mergedPermissionsJson = JSON.stringify(mergedPermissions);

      await trx
        .insertInto("userPermission")
        .values({ id: newUserId, permissions: mergedPermissionsJson })
        .onConflict((oc) =>
          oc.column("id").doUpdateSet({ permissions: mergedPermissionsJson })
        )
        .execute();

      // Accept the invite — guarded so a concurrent accept can never
      // double-apply (we hold the row lock from the SELECT above).
      await trx
        .updateTable("invite")
        .set({ acceptedAt: datetime.timestamp() })
        .where("id", "=", invite.id)
        .where("acceptedAt", "is", null)
        .execute();

      return { alreadyAccepted: false };
    });
  } catch (err) {
    logger.error("SSO user migration failed", {
      error: err,
      newUserId,
      companyId
    });
    return {
      data: null,
      error: err instanceof Error ? err.message : "Failed to migrate user"
    };
  }

  if (result.alreadyAccepted) {
    // A concurrent accept won the race and owns all side effects.
    return {
      data: { userId: newUserId, alreadyAccepted: true },
      error: null
    };
  }

  logger.info("SSO user migration committed", {
    newUserId,
    companyId
  });

  // Post-commit side effect: idempotent, failure-tolerant — log, never throw.
  try {
    await redis.del(getPermissionCacheKey(newUserId));
  } catch (err) {
    logger.error("Failed to invalidate permission cache after SSO migration", {
      error: err,
      userId: newUserId
    });
  }

  return {
    data: { userId: newUserId, alreadyAccepted: false },
    error: null
  };
}
