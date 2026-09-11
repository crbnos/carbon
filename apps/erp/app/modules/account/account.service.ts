import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sql } from "kysely";
import { sanitize } from "~/utils/supabase";

// ── GoTrue session access ─────────────────────────────────────────────────
// GoTrue's auth schema is not in the generated types and its admin REST API
// has no endpoint for these two operations, so they use the sql template
// against auth.sessions directly. This is the ONE place that reaches into
// that schema — if a Supabase upgrade moves auth.sessions, fix it here.
// (Revoking the CURRENT session and "sign out others" use the official
// admin.signOut API instead; see x+/account+/security.tsx.)

export type ActiveSession = {
  id: string;
  createdAt: string;
  refreshedAt: string | null;
  userAgent: string | null;
  ip: string | null;
};

export async function getActiveSessions(
  db: Kysely<KyselyDatabase>,
  userId: string
): Promise<ActiveSession[]> {
  // to_jsonb #>> '{}' emits ISO-8601 with offset (what <DateTime> parses);
  // refreshed_at is a bare timestamp GoTrue writes in UTC, so anchor it there.
  const { rows } = await sql<ActiveSession>`
    SELECT id::text AS id,
           to_jsonb(created_at) #>> '{}' AS "createdAt",
           to_jsonb(refreshed_at AT TIME ZONE 'UTC') #>> '{}' AS "refreshedAt",
           user_agent AS "userAgent",
           host(ip) AS ip
    FROM auth.sessions
    WHERE user_id::text = ${userId}
  `.execute(db);
  return rows;
}

/**
 * Deletes one of the user's OWN GoTrue sessions; its refresh tokens cascade
 * away (FK ON DELETE CASCADE), and the device is bounced to login at its next
 * shell navigation. The user_id constraint makes a forged session id a no-op.
 * Returns the affected count so callers can tell "signed out" from "was
 * already signed out". Text comparison on purpose: a malformed id must
 * compare false, not throw a uuid cast error.
 */
export async function revokeSession(
  db: Kysely<KyselyDatabase>,
  userId: string,
  sessionId: string
): Promise<number> {
  const result = await sql`
    DELETE FROM auth.sessions
    WHERE id::text = ${sessionId} AND user_id::text = ${userId}
  `.execute(db);
  return Number(result.numAffectedRows ?? 0);
}

export async function getLoginHistory(
  client: SupabaseClient<Database>,
  userId: string,
  limit = 20
) {
  // RLS restricts reads to the owner; the userId filter is belt-and-braces.
  return client
    .from("userLogin")
    .select(
      "id, sessionId, method, app, ipAddress, city, country, userAgent, createdAt"
    )
    .eq("userId", userId)
    .order("createdAt", { ascending: false })
    .limit(limit);
}

/**
 * When this device was FIRST seen for this user, or null if never.
 *
 * This is the device's age, and the whole basis of the revoke gate: a device
 * may only end sessions that began after it first appeared. Null means
 * unrecognised — no cookie, a tampered one, or a genuinely new browser — which
 * can revoke nothing but itself.
 */
export async function getDeviceFirstSeenAt(
  client: SupabaseClient<Database>,
  userId: string,
  deviceId: string | null
): Promise<string | null> {
  if (!deviceId) return null;
  // mfaPending rows are excluded: a login that never cleared its second factor
  // must not age the device, or failing MFA once would be enough to make an
  // attacker's browser look older than the owner's sessions.
  const { data } = await client
    .from("userLogin")
    .select("createdAt")
    .eq("userId", userId)
    .eq("deviceId", deviceId)
    .eq("mfaPending", false)
    .order("createdAt", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.createdAt ?? null;
}

export async function getNotificationPreferences(
  client: SupabaseClient<Database>,
  userId: string,
  companyId: string
) {
  return client
    .from("notificationPreference")
    .select("topic, channel, enabled")
    .eq("userId", userId)
    .eq("companyId", companyId);
}

export async function upsertNotificationPreference(
  client: SupabaseClient<Database>,
  preference: {
    userId: string;
    companyId: string;
    topic: string;
    channel: "email" | "slack";
    enabled: boolean;
  }
) {
  return client.from("notificationPreference").upsert(
    {
      ...preference,
      updatedAt: new Date().toISOString()
    },
    { onConflict: "userId,companyId,channel,topic" }
  );
}

export async function deleteUserAttributeValue(
  client: SupabaseClient<Database>,
  args: {
    userId: string;
    userAttributeId: string;
    userAttributeValueId: string;
  }
) {
  return client
    .from("userAttributeValue")
    .delete()
    .eq("id", args.userAttributeValueId)
    .eq("userAttributeId", args.userAttributeId)
    .eq("userId", args.userId);
}

export async function getAccount(client: SupabaseClient<Database>, id: string) {
  return client.from("user").select("*").eq("id", id).single();
}

/**
 * Return the connected user's own profile (id, email, name). `userId` is injected by the MCP
 * executor from the OAuth token, so this always resolves to the caller — it is the identity source
 * an OS deployment can use for sign-in (a user who completed Carbon's OAuth has proven control of
 * this account, so its email is a verified sign-in identity).
 */
export async function getCurrentUser(
  client: SupabaseClient<Database>,
  userId: string
) {
  return client
    .from("user")
    .select("id, email, firstName, lastName, fullName, avatarUrl")
    .eq("id", userId)
    .single();
}

export async function getAttributes(
  client: SupabaseClient<Database>,
  userId: string,
  companyId: string,
  isPublic: boolean
) {
  return client
    .from("userAttributeCategory")
    .select(
      `id, name, emoji, companyId,
      userAttribute(id, name, listOptions, canSelfManage,
        attributeDataType(id, isBoolean, isDate, isNumeric, isText, isUser, isFile),
        userAttributeValue(
          id, valueBoolean, valueDate, valueNumeric, valueText, valueUser, valueFile
        )
      )`
    )
    .eq("companyId", companyId)
    .eq("public", isPublic)
    .eq("active", true)
    .eq("userAttribute.active", true)
    .eq("userAttribute.userAttributeValue.userId", userId)
    .order("sortOrder", { foreignTable: "userAttribute", ascending: true });
}

export async function getPrivateAttributes(
  client: SupabaseClient<Database>,
  userId: string,
  companyId: string
) {
  return getAttributes(client, userId, companyId, false);
}

export async function getPublicAttributes(
  client: SupabaseClient<Database>,
  userId: string,
  companyId: string
) {
  return getAttributes(client, userId, companyId, true);
}

export async function getAllAttributeCategories(
  client: SupabaseClient<Database>,
  userId: string,
  companyId: string
) {
  return client
    .from("userAttributeCategory")
    .select(
      `id, name, emoji, companyId,
      userAttribute(id, name, listOptions, canSelfManage,
        attributeDataType(id, isBoolean, isDate, isNumeric, isText, isUser, isFile),
        userAttributeValue(
          id, valueBoolean, valueDate, valueNumeric, valueText, valueUser, valueFile
        )
      )`
    )
    .eq("companyId", companyId)
    .eq("active", true)
    .eq("userAttribute.active", true)
    .eq("userAttribute.userAttributeValue.userId", userId)
    .order("sortOrder", { foreignTable: "userAttribute", ascending: true });
}

export async function getAttributeCategoryWithValues(
  client: SupabaseClient<Database>,
  categoryId: string,
  userId: string,
  companyId: string
) {
  return client
    .from("userAttributeCategory")
    .select(
      `id, name, emoji, companyId, public,
      userAttribute(id, name, listOptions, canSelfManage,
        attributeDataType(id, isBoolean, isDate, isNumeric, isText, isUser, isFile),
        userAttributeValue(
          id, valueBoolean, valueDate, valueNumeric, valueText, valueUser, valueFile
        )
      )`
    )
    .eq("id", categoryId)
    .eq("companyId", companyId)
    .eq("active", true)
    .eq("userAttribute.active", true)
    .eq("userAttribute.userAttributeValue.userId", userId)
    .order("sortOrder", { foreignTable: "userAttribute", ascending: true })
    .single();
}

export async function updateAvatar(
  client: SupabaseClient<Database>,
  userId: string,
  avatarUrl: string | null
) {
  return client
    .from("user")
    .update(
      sanitize({
        avatarUrl
      })
    )
    .eq("id", userId);
}

export async function updatePublicAccount(
  client: SupabaseClient<Database>,
  account: {
    id: string;
    firstName: string;
    lastName: string;
    about?: string;
    phone?: string;
  }
) {
  return client.from("user").update(sanitize(account)).eq("id", account.id);
}

export async function upsertUserAttributeValue(
  client: SupabaseClient<Database>,
  update: {
    userAttributeValueId?: string | undefined;
    userAttributeId: string;
    value: boolean | string | number;
    type: string;
    userId: string;
    updatedBy: string;
  }
) {
  const {
    userAttributeValueId,
    userAttributeId,
    value,
    type,
    userId,
    updatedBy
  } = update;

  let valueUpdate: Record<string, number | string | boolean> = {};

  if (type === "boolean" && typeof value === "boolean") {
    valueUpdate = { valueBoolean: value };
  }

  if (type === "date" && typeof value === "string") {
    valueUpdate = { valueDate: value };
  }

  if (type === "list" && typeof value === "string") {
    valueUpdate = { valueText: value };
  }

  if (type === "numeric" && typeof value === "number") {
    valueUpdate = { valueNumeric: value };
  }

  if (type === "text" && typeof value === "string") {
    valueUpdate = { valueText: value };
  }

  if (type === "user" && typeof value === "string") {
    valueUpdate = { valueUser: value };
  }

  if (type === "customer" && typeof value === "string") {
    valueUpdate = { valueText: value };
  }

  if (type === "supplier" && typeof value === "string") {
    valueUpdate = { valueText: value };
  }

  if (type === "file" && typeof value === "string") {
    valueUpdate = { valueFile: value };
  }

  if (userAttributeValueId) {
    return client
      .from("userAttributeValue")
      .update({
        ...valueUpdate,
        updatedBy
      })
      .eq("id", userAttributeValueId)
      .select("id")
      .single();
  } else {
    return client
      .from("userAttributeValue")
      .insert({
        userAttributeId,
        ...valueUpdate,
        userId,
        createdBy: updatedBy
      })
      .select("id")
      .single();
  }
}
