import {
  assertIsPost,
  error,
  resetPasswordValidator,
  success,
} from "@carbon/auth";
import { flash, requireAuthSession } from "@carbon/auth/session.server";
import { ValidatedForm, validationError, validator } from "@carbon/form";
import { Button, HStack, VStack } from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { resetPassword } from "~/modules/users/users.server";

import { Password, Submit } from "~/components/Form";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAuthSession(request);
  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const validation = await validator(resetPasswordValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { password } = validation.data;

  const { userId } = await requireAuthSession(request, { verify: true });

  const updatePassword = await resetPassword(userId, password);

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
    await flash(request, success("Password updated"))
  );
}

export default function ResetPasswordRoute() {
  const navigate = useNavigate();

  return (
    <>
      <div>
        <img
          src="/carbon-logo-dark.png"
          alt="Carbon Logo"
          className="block dark:hidden max-w-[100px] mb-3"
        />
        <img
          src="/carbon-logo-light.png"
          alt="Carbon Logo"
          className="hidden dark:block max-w-[100px] mb-3"
        />
      </div>
      <div className="rounded-lg bg-card border border-border shadow-lg p-8 w-[380px]">
        <ValidatedForm
          method="post"
          action={path.to.resetPassword}
          validator={resetPasswordValidator}
        >
          <VStack spacing={4}>
            <p>Please select a new password.</p>

            <Password name="password" label="New Password" />
            <HStack spacing={4}>
              <Submit>Reset Password</Submit>
              <Button
                variant="secondary"
                onClick={() => navigate(path.to.authenticatedRoot)}
              >
                Skip
              </Button>
            </HStack>
          </VStack>
        </ValidatedForm>
      </div>
    </>
  );
}
