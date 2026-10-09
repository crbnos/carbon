// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { VStack } from "@carbon/react";
import {
  isAllowedAvatarValue,
  isOwnAvatarUpload,
  redirect
} from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import {
  accountProfileValidator,
  getAccount,
  getCurrentUser,
  updateAvatar,
  updatePublicAccount
} from "~/modules/account";
import { ProfileForm } from "~/modules/account/ui/Profile";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "account-profile");

export const handle: Handle = {
  breadcrumb: msg`Profile`,
  to: path.to.profile
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, userId } = await requirePermissions(request, {});
  const user = await getAccount(client, userId);

  if (user.error || !user.data) {
    throw redirect(
      path.to.authenticatedRoot,
      await flash(request, error(user.error, "Failed to get user"))
    );
  }

  return { user: user.data };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {});
  const formData = await request.formData();

  if (formData.get("intent") === "about") {
    const validation = await validator(accountProfileValidator).validate(
      formData
    );

    if (validation.error) {
      return validationError(validation.error);
    }

    const { firstName, lastName, about, phone } = validation.data;

    const updateAccount = await updatePublicAccount(client, {
      id: userId,
      firstName,
      lastName,
      about,
      phone
    });
    if (updateAccount.error)
      return data(
        {},
        await flash(
          request,
          error(updateAccount.error, "Failed to update profile")
        )
      );

    return data({}, await flash(request, success("Updated profile")));
  }

  if (formData.get("intent") === "photo") {
    const pathValue = formData.get("path");
    const photoPath = typeof pathValue === "string" ? pathValue : null;
    // A generated avatar, or the user's own upload. Anything else could point
    // at another user's file.
    if (!isAllowedAvatarValue(userId, photoPath)) {
      throw redirect(
        path.to.profile,
        await flash(request, error(null, "Invalid avatar path"))
      );
    }

    // Only the replaced avatar is needed: the narrow reader, not `select("*")`.
    const previous = await getCurrentUser(client, userId);
    if (previous.error) {
      logger.error("Failed to read the avatar being replaced", {
        userId,
        error: previous.error
      });
    }
    const avatarUpdate = await updateAvatar(client, userId, photoPath);
    if (avatarUpdate.error) {
      throw redirect(
        path.to.profile,
        await flash(
          request,
          error(avatarUpdate.error, "Failed to update avatar")
        )
      );
    }

    // Only after the new value is saved: drop the photo it replaced, so a
    // failed save never leaves avatarUrl pointing at a deleted file. A failed
    // delete only leaves an orphan file, so it is logged, not surfaced.
    const previousPath = previous.data?.avatarUrl;
    if (isOwnAvatarUpload(userId, previousPath) && previousPath !== photoPath) {
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

    throw redirect(
      path.to.profile,
      await flash(request, success("Updated avatar"))
    );
  }

  return null;
}

export default function AccountProfile() {
  const { user } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={4} className="pb-6">
      <ProfileForm user={user} />
    </VStack>
  );
}
