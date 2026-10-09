// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { NotificationPreferenceChannel } from "@carbon/notifications";
import { datetime } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitize } from "~/utils/supabase";

export type ChangelogPanelEntry = {
  guid: string;
  slug: string;
  title: string;
  description: string | null;
};

// The newest entry in the dispatch ledger (service-role only). `slug` is the
// last segment of the guid permalink and keys the dismissal flag.
export async function getChangelogPanelEntry(
  serviceRole: SupabaseClient<Database>
): Promise<ChangelogPanelEntry | null> {
  const latest = await serviceRole
    .from("changelogDispatch")
    .select("guid, title, description")
    .order("dispatchedAt", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latest.data?.title) return null;
  const slug = latest.data.guid.split("/").filter(Boolean).pop() ?? "";
  if (!slug) return null;
  return {
    guid: latest.data.guid,
    slug,
    title: latest.data.title,
    description: latest.data.description
  };
}

/** @mcp read */
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

/** @mcp upsert */
export async function upsertNotificationPreference(
  client: SupabaseClient<Database>,
  preference: {
    userId: string;
    companyId: string;
    topic: string;
    channel: NotificationPreferenceChannel;
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

/** Reads this browser's push subscription for the user. */
export async function getPushSubscription(
  client: SupabaseClient<Database>,
  args: { userId: string; endpoint: string }
) {
  return client
    .from("pushSubscription")
    .select("id")
    .eq("userId", args.userId)
    .eq("endpoint", args.endpoint)
    .maybeSingle();
}

/** Saves this browser's push subscription for the user. One row per browser;
 * companyId is the company it was enabled from. */
export async function upsertPushSubscription(
  client: SupabaseClient<Database>,
  subscription: {
    userId: string;
    companyId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent: string | null;
  }
) {
  return client
    .from("pushSubscription")
    .upsert(
      { ...subscription, updatedAt: datetime.timestamp() },
      { onConflict: "endpoint" }
    )
    .select("id")
    .single();
}

/** Removes every user's push subscription for a browser endpoint, or every
 * user's but one with `exceptUserId`. Pass the service-role client: RLS shows
 * a user only their own rows. */
export async function deleteBrowserPushSubscriptions(
  client: SupabaseClient<Database>,
  args: { endpoint: string; exceptUserId?: string }
) {
  const query = client
    .from("pushSubscription")
    .delete()
    .eq("endpoint", args.endpoint);
  return args.exceptUserId ? query.neq("userId", args.exceptUserId) : query;
}

/** Removes this browser's push subscription for the user. */
export async function deletePushSubscription(
  client: SupabaseClient<Database>,
  args: { userId: string; endpoint: string }
) {
  return client
    .from("pushSubscription")
    .delete()
    .eq("userId", args.userId)
    .eq("endpoint", args.endpoint);
}

/** @mcp delete */
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

/** @mcp read */
export async function getAccount(client: SupabaseClient<Database>, id: string) {
  return client.from("user").select("*").eq("id", id).single();
}

/**
 * Return the connected user's own profile (id, email, name). `userId` is injected by the MCP
 * executor from the OAuth token, so this always resolves to the caller — it is the identity source
 * an OS deployment can use for sign-in (a user who completed Carbon's OAuth has proven control of
 * this account, so its email is a verified sign-in identity).
 * @mcp read
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

/** @mcp read */
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

/** @mcp read */
export async function getPrivateAttributes(
  client: SupabaseClient<Database>,
  userId: string,
  companyId: string
) {
  return getAttributes(client, userId, companyId, false);
}

/** @mcp read */
export async function getPublicAttributes(
  client: SupabaseClient<Database>,
  userId: string,
  companyId: string
) {
  return getAttributes(client, userId, companyId, true);
}

/** @mcp read */
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

/** @mcp read */
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

/** @mcp update */
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

/** @mcp update */
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

/** @mcp upsert */
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
