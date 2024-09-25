import {
  assertIsPost,
  error,
  getCarbonServiceRole,
  success,
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { PasswordForm, accountPasswordValidator } from "~/modules/account";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Password",
  to: path.to.accountPassword,
};

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { email, userId } = await requirePermissions(request, {});

  const validation = await validator(accountPasswordValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { currentPassword, password } = validation.data;

  const confirmPassword = await getCarbonServiceRole().auth.signInWithPassword({
    email,
    password: currentPassword,
  });

  if (confirmPassword.error || !("user" in confirmPassword.data)) {
    return json(
      {},
      await flash(request, error(null, "Current password is invalid"))
    );
  }

  const updatePassword = await getCarbonServiceRole().auth.admin.updateUserById(
    userId,
    {
      password,
    }
  );

  if (updatePassword.error) {
    return json(
      {},
      await flash(
        request,
        error(updatePassword.error, "Failed to update password")
      )
    );
  }

  throw redirect(
    path.to.authenticatedRoot,
    await flash(request, success("Updated password"))
  );
}

export default function AccountPassword() {
  return <PasswordForm />;
}
