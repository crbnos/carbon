import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitize } from "~/utils/supabase";

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

export async function getAttributes(
  client: SupabaseClient<Database>,
  userId: string,
  companyId: string,
  isPublic: boolean
) {
  return client
    .from("userAttributeCategory")
    .select(
      `id, name, companyId, 
      userAttribute(id, name, listOptions, canSelfManage,
        attributeDataType(id, isBoolean, isDate, isNumeric, isText, isUser),
        userAttributeValue(
          id, valueBoolean, valueDate, valueNumeric, valueText, valueUser
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

export async function updateAvatar(
  client: SupabaseClient<Database>,
  userId: string,
  avatarUrl: string | null
) {
  return client
    .from("user")
    .update(
      sanitize({
        avatarUrl,
      })
    )
    .eq("id", userId);
}

export async function updatePublicAccount(
  client: SupabaseClient<Database>,
  account: {
    id: string;
    email?: string;
    firstName: string;
    lastName: string;
    about: string;
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
    updatedBy,
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

  if (userAttributeValueId) {
    return client
      .from("userAttributeValue")
      .update({
        ...valueUpdate,
        updatedBy,
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
        createdBy: updatedBy,
      })
      .select("id")
      .single();
  }
}
