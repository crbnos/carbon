// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/**
 * The admin side of SCIM provisioning — Settings → Security → Provisioning.
 * Mirrors `connections.server.ts` (SAML SSO). Every authoring write embeds
 * `requireEntitlement(…, "SCIM")`; turning SCIM off does not, so a company
 * that lost the plan can still stop its IdP.
 *
 * The bearer token copies the API-key pattern: only its SHA-256 hash
 * (`hashApiKey`) and last 4 characters are stored, and the raw token is
 * returned once, to the action that made it.
 */

import { hashApiKey } from "@carbon/auth/auth.server";
import type { Database } from "@carbon/database";
import type { KyselyDatabase } from "@carbon/database/client";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Kysely, sql } from "kysely";
import { customAlphabet } from "nanoid";
import { requireEntitlement } from "../entitlements.server";
import { reconcileEmployeeTypes } from "./scim.server";
import {
  compareGroupPrecedence,
  type GroupMappingChoice,
  planGroupMappingSave
} from "./scim-mapping";

const logger = getLogger("ee", "scim-connections");

const tokenBody = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  32
);

type Result<T> = { data: T | null; error: string | null };

export function generateScimToken(): {
  token: string;
  tokenHash: string;
  tokenPreview: string;
} {
  const token = `scim_${tokenBody()}`;
  return {
    token,
    tokenHash: hashApiKey(token),
    tokenPreview: token.slice(-4)
  };
}

/**
 * What the Provisioning card shows: the connection (never its token hash),
 * the pushed groups with their mappings and member counts, and how many
 * provisioned people are active. `data` is null when SCIM is not set up or
 * is turned off (no token).
 */
export async function getScimConnection(
  client: SupabaseClient<Database>,
  companyId: string
) {
  const connection = await client
    .from("scimConnection")
    .select(
      "id, tokenPreview, defaultEmployeeTypeId, defaultLocationId, lastRequestAt, createdAt"
    )
    .eq("companyId", companyId)
    .not("tokenHash", "is", null)
    .maybeSingle();
  if (connection.error) return { data: null, error: connection.error };
  if (!connection.data) return { data: null, error: null };

  const [groups, active] = await Promise.all([
    client
      .from("scimGroup")
      .select(
        "id, displayName, employeeTypeId, priority, scimGroupMember(count)"
      )
      .eq("companyId", companyId),
    client
      .from("scimUser")
      .select("id", { count: "exact", head: true })
      .eq("companyId", companyId)
      .eq("active", true)
  ]);
  if (groups.error) return { data: null, error: groups.error };
  if (active.error) return { data: null, error: active.error };

  return {
    data: {
      connection: connection.data,
      // In the order they win: the list shows the winning group first.
      groups: (groups.data ?? [])
        .map(({ scimGroupMember, ...group }) => ({
          ...group,
          memberCount: scimGroupMember?.[0]?.count ?? 0
        }))
        .sort(compareGroupPrecedence),
      activeCount: active.count ?? 0
    },
    error: null
  };
}

/** Both defaults must belong to the company: their tables have single-column keys. */
async function checkDefaults(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  {
    defaultEmployeeTypeId,
    defaultLocationId
  }: { defaultEmployeeTypeId: string; defaultLocationId: string }
): Promise<string | null> {
  const [type, location] = await Promise.all([
    serviceRole
      .from("employeeType")
      .select("id")
      .eq("id", defaultEmployeeTypeId)
      .eq("companyId", companyId)
      .maybeSingle(),
    serviceRole
      .from("location")
      .select("id")
      .eq("id", defaultLocationId)
      .eq("companyId", companyId)
      .maybeSingle()
  ]);
  if (type.error || !type.data) return "Employee type not found";
  if (location.error || !location.data) return "Location not found";
  return null;
}

/**
 * Set SCIM up, or turn it back on. A connection that was turned off is
 * resumed with a new token and the new defaults, so the SCIM people and
 * groups it kept, and the ids the IdP holds for them, still work.
 */
export async function createScimConnection(
  serviceRole: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  input: {
    companyId: string;
    userId: string;
    defaultEmployeeTypeId: string;
    defaultLocationId: string;
  }
): Promise<Result<{ token: string }>> {
  await requireEntitlement(serviceRole, input.companyId, "SCIM");

  const refusal = await checkDefaults(serviceRole, input.companyId, input);
  if (refusal) return { data: null, error: refusal };

  const { token, tokenHash, tokenPreview } = generateScimToken();
  const resumed = await serviceRole
    .from("scimConnection")
    .update({
      tokenHash,
      tokenPreview,
      defaultEmployeeTypeId: input.defaultEmployeeTypeId,
      defaultLocationId: input.defaultLocationId,
      updatedBy: input.userId,
      updatedAt: datetime.timestamp()
    })
    .eq("companyId", input.companyId)
    .is("tokenHash", null)
    .select("*")
    .maybeSingle();
  if (resumed.error) {
    logger.error("Failed to turn the SCIM connection back on", {
      companyId: input.companyId,
      error: resumed.error
    });
    return { data: null, error: "Failed to set up SCIM" };
  }
  if (resumed.data) {
    // The default type may have changed while SCIM was off.
    await reconcileEmployeeTypes(db, serviceRole, {
      connection: resumed.data
    });
    return { data: { token }, error: null };
  }

  const inserted = await serviceRole.from("scimConnection").insert({
    companyId: input.companyId,
    defaultEmployeeTypeId: input.defaultEmployeeTypeId,
    defaultLocationId: input.defaultLocationId,
    tokenHash,
    tokenPreview,
    createdBy: input.userId
  });
  if (inserted.error) {
    if (inserted.error.code === "23505") {
      return { data: null, error: "SCIM is already set up for this company." };
    }
    logger.error("Failed to create the SCIM connection", {
      companyId: input.companyId,
      error: inserted.error
    });
    return { data: null, error: "Failed to set up SCIM" };
  }

  return { data: { token }, error: null };
}

export async function updateScimConnection(
  serviceRole: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  input: {
    companyId: string;
    userId: string;
    defaultEmployeeTypeId: string;
    defaultLocationId: string;
  }
): Promise<Result<{ changed: number }>> {
  await requireEntitlement(serviceRole, input.companyId, "SCIM");

  const refusal = await checkDefaults(serviceRole, input.companyId, input);
  if (refusal) return { data: null, error: refusal };

  const updated = await serviceRole
    .from("scimConnection")
    .update({
      defaultEmployeeTypeId: input.defaultEmployeeTypeId,
      defaultLocationId: input.defaultLocationId,
      updatedBy: input.userId,
      updatedAt: datetime.timestamp()
    })
    .eq("companyId", input.companyId)
    .not("tokenHash", "is", null)
    .select("*")
    .maybeSingle();
  if (updated.error || !updated.data) {
    logger.error("Failed to update the SCIM connection", {
      companyId: input.companyId,
      error: updated.error
    });
    return { data: null, error: "Failed to update SCIM" };
  }

  // A new default type moves everyone in no mapped group.
  const reconciled = await reconcileEmployeeTypes(db, serviceRole, {
    connection: updated.data
  });
  return { data: reconciled, error: null };
}

export async function regenerateScimToken(
  serviceRole: SupabaseClient<Database>,
  input: { companyId: string; userId: string }
): Promise<Result<{ token: string }>> {
  await requireEntitlement(serviceRole, input.companyId, "SCIM");

  const { token, tokenHash, tokenPreview } = generateScimToken();
  const updated = await serviceRole
    .from("scimConnection")
    .update({
      tokenHash,
      tokenPreview,
      updatedBy: input.userId,
      updatedAt: datetime.timestamp()
    })
    .eq("companyId", input.companyId)
    // A connection that is turned off is turned on by a new setup only.
    .not("tokenHash", "is", null)
    .select("id")
    .maybeSingle();
  if (updated.error || !updated.data) {
    logger.error("Failed to regenerate the SCIM token", {
      companyId: input.companyId,
      error: updated.error
    });
    return { data: null, error: "Failed to regenerate the SCIM token" };
  }

  return { data: { token }, error: null };
}

/**
 * Turn SCIM off: the token goes, so every `/scim/v2` request is refused. The
 * connection row, the SCIM people and groups and the group mappings stay, so
 * a new setup resumes them and the ids the IdP holds still work. Every Carbon
 * user, membership and employee stays as it is. Not gated, so a company that
 * lost the plan can still stop its IdP.
 */
export async function turnOffScimConnection(
  serviceRole: SupabaseClient<Database>,
  input: { companyId: string; userId: string }
): Promise<Result<true>> {
  const turnedOff = await serviceRole
    .from("scimConnection")
    .update({
      tokenHash: null,
      tokenPreview: null,
      updatedBy: input.userId,
      updatedAt: datetime.timestamp()
    })
    .eq("companyId", input.companyId);
  if (turnedOff.error) {
    logger.error("Failed to turn off SCIM", {
      companyId: input.companyId,
      error: turnedOff.error
    });
    return { data: null, error: "Failed to turn off SCIM" };
  }
  return { data: true, error: null };
}

/**
 * Save the group mappings as the settings card shows them: each group's
 * employee type, and mapped groups in the order they win. One transaction
 * writes every changed group, then everyone's type is reconciled once.
 */
export async function saveScimGroupMappings(
  serviceRole: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  input: {
    companyId: string;
    userId: string;
    groups: GroupMappingChoice[];
  }
): Promise<Result<{ changed: number }>> {
  await requireEntitlement(serviceRole, input.companyId, "SCIM");

  const connection = await serviceRole
    .from("scimConnection")
    .select("*")
    .eq("companyId", input.companyId)
    .not("tokenHash", "is", null)
    .maybeSingle();
  if (connection.error || !connection.data) {
    return { data: null, error: "SCIM is not set up for this company" };
  }

  const typeIds = [
    ...new Set(
      input.groups.flatMap((group) =>
        group.employeeTypeId ? [group.employeeTypeId] : []
      )
    )
  ];
  if (typeIds.length > 0) {
    const types = await serviceRole
      .from("employeeType")
      .select("id")
      .eq("companyId", input.companyId)
      .in("id", typeIds);
    if (types.error || (types.data ?? []).length !== typeIds.length) {
      return { data: null, error: "Employee type not found" };
    }
  }

  const saved = await db.transaction().execute(async (trx) => {
    const current = await trx
      .selectFrom("scimGroup")
      .select(["id", "employeeTypeId", "priority"])
      .where("companyId", "=", input.companyId)
      .where(
        "id",
        "in",
        input.groups.map((group) => group.groupId)
      )
      .forUpdate()
      .execute();
    const plan = planGroupMappingSave(current, input.groups);
    if (plan.unknownGroupIds.length > 0) return null;

    if (plan.updates.length > 0) {
      await sql`
        UPDATE "scimGroup" AS g
        SET "employeeTypeId" = v."employeeTypeId",
            "priority" = v."priority",
            "updatedBy" = ${input.userId},
            "updatedAt" = now()
        FROM (VALUES ${sql.join(
          plan.updates.map(
            (update) =>
              sql`(${update.id}, ${update.employeeTypeId}::text, ${update.priority}::int)`
          )
        )}) AS v("id", "employeeTypeId", "priority")
        WHERE g."id" = v."id" AND g."companyId" = ${input.companyId}
      `.execute(trx);
    }

    const stillMapped = await trx
      .selectFrom("scimGroup")
      .select("id")
      .where("companyId", "=", input.companyId)
      .where("employeeTypeId", "is not", null)
      .limit(1)
      .executeTakeFirst();
    const removedMembers =
      plan.removedGroupIds.length > 0 && !stillMapped
        ? await trx
            .selectFrom("scimGroupMember")
            .select("scimUserId")
            .where("companyId", "=", input.companyId)
            .where("groupId", "in", plan.removedGroupIds)
            .execute()
        : null;
    return { changed: plan.updates.length > 0, removedMembers };
  });
  if (!saved) return { data: null, error: "Group not found" };
  if (!saved.changed) return { data: { changed: 0 }, error: null };

  // With the last mapping gone, only its members still hold its type, and
  // they move to the default. Otherwise any change can move anyone.
  const reconciled = await reconcileEmployeeTypes(
    db,
    serviceRole,
    saved.removedMembers
      ? {
          connection: connection.data,
          scimUserIds: [
            ...new Set(saved.removedMembers.map((member) => member.scimUserId))
          ],
          mappingRemoved: true
        }
      : { connection: connection.data }
  );
  return { data: reconciled, error: null };
}
