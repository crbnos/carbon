import {
  assertIsPost,
  error,
  forgotPasswordValidator,
  getCarbonServiceRole,
  getCompaniesForUser,
  success,
} from "@carbon/auth";
import { sendMagicLink } from "@carbon/auth/auth.server";
import { getAuthSession } from "@carbon/auth/session.server";
import { getUserByEmail } from "@carbon/auth/users.server";
import { ValidatedForm, validationError, validator } from "@carbon/form";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  VStack,
} from "@carbon/react";
import { Link, useActionData } from "@remix-run/react";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { LuCircleAlert, LuCircleCheck } from "react-icons/lu";

import { Input, Submit } from "~/components/Form";
import type { FormActionData, Result } from "~/types";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [
    {
      title: "Carbon | Forgot Password",
    },
  ];
};

export async function loader({ request }: LoaderFunctionArgs) {
  const authSession = await getAuthSession(request);
  if (authSession) throw redirect(path.to.authenticatedRoot);
  return null;
}

export async function action({ request }: ActionFunctionArgs): FormActionData {
  assertIsPost(request);
  const validation = await validator(forgotPasswordValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { email } = validation.data;
  const user = await getUserByEmail(email);
  console.log({ user });
  if (user.data && user.data.active) {
    const companies = await getCompaniesForUser(
      getCarbonServiceRole(),
      user.data.id
    );
    console.log({ companies });

    if (companies.length > 0) {
      const magicLink = await sendMagicLink(email);
      if (!magicLink) {
        return json(error(magicLink, "Failed to send magic link"), {
          status: 500,
        });
      }
    }
  } else {
    console.error(`No user found for email: ${email}`);
  }

  return json(success());
}

export default function ForgotPasswordRoute() {
  const actionData = useActionData<Result>();

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
      {actionData?.success ? (
        <Alert
          variant="success"
          className="h-[240px] [&>svg]:left-8 [&>svg]:top-8 p-8 w-[380px]"
        >
          <LuCircleCheck className="w-4 h-4" />
          <AlertTitle>Success</AlertTitle>
          <AlertDescription>
            If you have an account, you should receive an email shortly with a
            link to log in.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="rounded-lg bg-card border border-border shadow-lg p-8 w-[380px]">
          <ValidatedForm validator={forgotPasswordValidator} method="post">
            <VStack spacing={4}>
              <p className="w-full px-8 text-center text-sm text-muted-foreground">
                Please enter your email address to search for your account.{" "}
              </p>
              {actionData?.success === false && (
                <Alert variant="destructive">
                  <LuCircleAlert className="w-4 h-4" />
                  <AlertTitle>{actionData?.message}</AlertTitle>
                </Alert>
              )}
              <Input name="email" label="Email" />
              <Submit size="lg" className="w-full" withBlocker={false}>
                Reset Password
              </Submit>
              <Button variant="link" asChild className="w-full">
                <Link to={path.to.login}>Back to login</Link>
              </Button>
            </VStack>
          </ValidatedForm>
        </div>
      )}
    </>
  );
}
