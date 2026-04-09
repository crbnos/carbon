import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  VStack
} from "@carbon/react";
import { getPreferenceHeaders } from "@carbon/remix";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData } from "react-router";
import {
  accountLanguageValidator,
  accountProfileValidator,
  getAccount,
  updateAvatar,
  updatePublicAccount
} from "~/modules/account";
import {
  ProfileForm,
  ProfileLanguageForm,
  ProfilePhotoForm
} from "~/modules/account/ui/Profile";
import { setLocale } from "~/services/locale.server";
import { getRequestI18n } from "~/services/request-i18n.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Profile",
  to: path.to.profile
};

export async function loader({ request }: LoaderFunctionArgs) {
  const i18n = await getRequestI18n(request);
  const { client, userId } = await requirePermissions(request, {});

  const [user] = await Promise.all([getAccount(client, userId)]);

  if (user.error || !user.data) {
    throw redirect(
      path.to.authenticatedRoot,
      await flash(request, error(user.error, i18n._(msg`Failed to get user`)))
    );
  }

  return { user: user.data, locale: getPreferenceHeaders(request).locale };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const i18n = await getRequestI18n(request);
  const { client, userId } = await requirePermissions(request, {});
  const formData = await request.formData();

  if (formData.get("intent") === "about") {
    const validation = await validator(accountProfileValidator).validate(
      formData
    );

    if (validation.error) {
      return validationError(validation.error);
    }

    const { firstName, lastName, about } = validation.data;

    const updateAccount = await updatePublicAccount(client, {
      id: userId,
      firstName,
      lastName,
      about
    });
    if (updateAccount.error)
      return data(
        {},
        await flash(
          request,
          error(updateAccount.error, i18n._(msg`Failed to update profile`))
        )
      );

    return data(
      {},
      await flash(request, success(i18n._(msg`Updated profile`)))
    );
  }

  if (formData.get("intent") === "locale") {
    const validation = await validator(accountLanguageValidator).validate(
      formData
    );

    if (validation.error) {
      return validationError(validation.error);
    }

    const localeCookie = setLocale(validation.data.locale);
    const flashHeaders = await flash(
      request,
      success(i18n._(msg`Updated language`))
    );

    return data(
      {},
      {
        headers: [
          ["Set-Cookie", localeCookie],
          ["Set-Cookie", flashHeaders.headers["Set-Cookie"]]
        ]
      }
    );
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
            error(avatarUpdate.error, i18n._(msg`Failed to update avatar`))
          )
        );
      }

      throw redirect(
        path.to.profile,
        await flash(
          request,
          success(
            photoPath === null
              ? i18n._(msg`Removed avatar`)
              : i18n._(msg`Updated avatar`)
          )
        )
      );
    } else {
      throw redirect(
        path.to.profile,
        await flash(request, error(null, i18n._(msg`Invalid avatar path`)))
      );
    }
  }

  return null;
}

export default function AccountProfile() {
  const { user, locale } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={2}>
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Profile</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              This information will be visible to all users, so be careful what
              you share.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 w-full mb-8">
            {/* @ts-expect-error TS2322 */}
            <ProfileForm user={user} />
            <ProfilePhotoForm user={user} />
          </div>

          <ProfileLanguageForm locale={locale} />
        </CardContent>
      </Card>
    </VStack>
  );
}
