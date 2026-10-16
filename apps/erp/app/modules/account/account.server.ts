// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineServiceFn } from "@carbon/api/service-fn.server";
import { getLogger } from "@carbon/logger";
import { isAllowedAvatarValue, isOwnAvatarUpload } from "@carbon/utils";
import { z } from "zod";
import { userFlagValidator } from "~/modules/users/users.models";
import {
  deleteUserAttributeValue,
  getCurrentUser,
  refuseAttributeValueChange,
  updateAvatar,
  upsertUserAttributeValue
} from "./account.service";

const logger = getLogger("erp", "account");
// The caller's own account. Every operation acts on the signed-in user (an
// API key's creator), so they stay unpublished.

/**
 * Change the caller's avatar to a generated avatar or their own upload.
 *
 * @remarks
 * Refuses any other value: it could point at another user's file. Saves the
 * new value first, then deletes the uploaded photo it replaced, so a failed
 * save never leaves the avatar pointing at a deleted file. A failed delete
 * only leaves an orphan file, so it is logged, not returned.
 */
export const updateOwnAvatar = defineServiceFn({
  input: z.object({ path: z.string() }),
  permission: {},
  async run(ctx, { path }) {
    const userId = ctx.auditUserId;
    if (!isAllowedAvatarValue(userId, path)) {
      return ctx.error("validation", "Invalid avatar path");
    }

    const client = ctx.asCaller.supabase;
    // Only the replaced avatar is needed: the narrow reader, not `select("*")`.
    const previous = await getCurrentUser(client, userId);
    if (previous.error) {
      logger.error("Failed to read the avatar being replaced", {
        userId,
        error: previous.error
      });
    }
    const saved = await updateAvatar(client, userId, path);
    if (saved.error) {
      return ctx.error("internal", "Failed to update avatar", saved.error);
    }

    const previousPath = previous.data?.avatarUrl;
    if (isOwnAvatarUpload(userId, previousPath) && previousPath !== path) {
      const removal = await client.storage
        .from("avatars")
        .remove([previousPath]);
      if (removal.error) {
        logger.error("Failed to remove the replaced avatar photo", {
          userId,
          path: previousPath,
          error: removal.error
        });
      }
    }
    return { avatarUrl: path };
  }
});
/**
 * Set a person's value of an attribute.
 *
 * @remarks
 * Anyone with resources update may set anyone's value. Others may set only
 * their own, of an attribute marked as self-managed. `value` must match
 * `type` (a boolean for `boolean`, a number for `numeric`, else a string),
 * or nothing is stored for it.
 */
export const upsertAttributeValue = defineServiceFn({
  input: z.object({
    userId: z.string().min(1),
    userAttributeId: z.string().min(1),
    userAttributeValueId: z.string().optional(),
    type: z.string().min(1),
    value: z.union([z.boolean(), z.number(), z.string()])
  }),
  permission: {},
  async run(ctx, { userId, ...value }) {
    const refused = await refuseAttributeValueChange(
      ctx,
      userId,
      value.userAttributeId,
      "Unauthorized: Cannot update attribute"
    );
    if (refused) return refused;

    const saved = await upsertUserAttributeValue(ctx.asCaller.supabase, {
      ...value,
      userId,
      updatedBy: ctx.auditUserId
    });
    if (saved.error) {
      return ctx.error(
        "internal",
        "Failed to update attribute value",
        saved.error
      );
    }
    return { userAttributeValueId: saved.data.id };
  }
});

/**
 * Remove a person's value of an attribute.
 *
 * @remarks
 * Allowed as for `upsertAttributeValue`.
 */
export const deleteAttributeValue = defineServiceFn({
  input: z.object({
    userId: z.string().min(1),
    userAttributeId: z.string().min(1),
    userAttributeValueId: z.string().min(1)
  }),
  permission: {},
  async run(ctx, value) {
    const refused = await refuseAttributeValueChange(
      ctx,
      value.userId,
      value.userAttributeId,
      "Unauthorized: Cannot remove attribute"
    );
    if (refused) return refused;

    const deleted = await deleteUserAttributeValue(
      ctx.asCaller.supabase,
      value
    );
    if (deleted.error) {
      return ctx.error(
        "internal",
        "Failed to delete attribute value",
        deleted.error
      );
    }
    return { userAttributeValueId: value.userAttributeValueId, deleted: true };
  }
});

/**
 * Set one of the caller's flags (a dismissed training panel, a changelog
 * entry seen), keeping the others.
 */
export const setOwnFlag = defineServiceFn({
  input: userFlagValidator,
  permission: {},
  async run(ctx, { flag, value }) {
    const userId = ctx.auditUserId;
    const client = ctx.asCaller.supabase;
    const user = await client
      .from("user")
      .select("flags")
      .eq("id", userId)
      .single();
    if (user.error) {
      return ctx.error("internal", "Failed to read user flags", user.error);
    }

    const flags = (user.data?.flags as Record<string, boolean> | null) ?? {};
    const updated = await client
      .from("user")
      .update({ flags: { ...flags, [flag]: value } })
      .eq("id", userId);
    if (updated.error) {
      return ctx.error("internal", "Failed to update flag", updated.error);
    }
    return { flag, value };
  }
});
