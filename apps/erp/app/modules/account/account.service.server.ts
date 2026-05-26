import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  AuthContextHolder,
  getAuthClient,
  mcpTool
} from "~/services/mcp/index.server";
import { sanitize } from "~/utils/supabase";
export const deleteUserAttributeValue = mcpTool(
  {
    classification: "DESTRUCTIVE",
    schema: z.object({
      args: z.object({
        userAttributeId: z.string(),
        userAttributeValueId: z.string()
      })
    })
  },
  async function deleteUserAttributeValue(args: {
    userAttributeId: string;
    userAttributeValueId: string;
  }) {
    const { userId } = AuthContextHolder.get();
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("userAttributeValue")
      .delete()
      .eq("id", args.userAttributeValueId)
      .eq("userAttributeId", args.userAttributeId)
      .eq("userId", userId);
  }
);

export const getAccount = mcpTool(
  {
    classification: "READ"
  },
  async function getAccount(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("user").select("*").eq("id", id).single();
  }
);

export const getAttributes = mcpTool(
  {
    classification: "READ"
  },
  async function getAttributes(isPublic: boolean) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { userId, companyId } = AuthContextHolder.get();
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
);

export const getPrivateAttributes = mcpTool(
  {
    classification: "READ"
  },
  async function getPrivateAttributes() {
    // getAttributes reads identity from ALS itself; no destructure needed.
    return getAttributes(false);
  }
);

export const getPublicAttributes = mcpTool(
  {
    classification: "READ"
  },
  async function getPublicAttributes() {
    // getAttributes reads identity from ALS itself; no destructure needed.
    return getAttributes(true);
  }
);

export const getAllAttributeCategories = mcpTool(
  {
    classification: "READ"
  },
  async function getAllAttributeCategories() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { userId, companyId } = AuthContextHolder.get();
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
);

export const getAttributeCategoryWithValues = mcpTool(
  {
    classification: "READ"
  },
  async function getAttributeCategoryWithValues(categoryId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { userId, companyId } = AuthContextHolder.get();
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
);

export const updateAvatar = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateAvatar(avatarUrl: string | null) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { userId } = AuthContextHolder.get();
    return client
      .from("user")
      .update(
        sanitize({
          avatarUrl
        })
      )
      .eq("id", userId);
  }
);

export const updatePublicAccount = mcpTool(
  {
    classification: "WRITE"
  },
  async function updatePublicAccount(account: {
    id: string;
    firstName: string;
    lastName: string;
    about?: string;
    phone?: string;
  }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("user").update(sanitize(account)).eq("id", account.id);
  }
);

export const upsertUserAttributeValue = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertUserAttributeValue(update: {
    userAttributeValueId?: string | undefined;
    userAttributeId: string;
    value: boolean | string | number;
    type: string;
  }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    // BUG 5 fix: userId is server identity (ALS), NOT from `update` (whose
    // type has no userId/updatedBy — the old executor used to inject them).
    // Audit column uses the server user, mirroring the prior executor
    // (updatedBy := userId).
    const { userId } = AuthContextHolder.get();
    const updatedBy = userId;
    const { userAttributeValueId, userAttributeId, value, type } = update;

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
);
