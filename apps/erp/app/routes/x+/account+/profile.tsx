import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData } from "react-router";
import {
  accountProfileValidator,
  getAccount,
  updateAvatar,
  updatePublicAccount
} from "~/modules/account";
import { ProfileForm } from "~/modules/account/ui/Profile";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

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
    const photoPath = formData.get("path");
    if (photoPath === null || typeof photoPath === "string") {
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

      throw redirect(
        path.to.profile,
        await flash(
          request,
          success(photoPath === null ? "Removed avatar" : "Updated avatar")
        )
      );
    } else {
      throw redirect(
        path.to.profile,
        await flash(request, error(null, "Invalid avatar path"))
      );
    }
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
