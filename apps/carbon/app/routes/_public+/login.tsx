import { ValidatedForm, validationError, validator } from "@carbon/form";
import { Alert, AlertTitle, Button, VStack } from "@carbon/react";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Link, useActionData, useSearchParams } from "@remix-run/react";
import posthog from "posthog-js";
import { LuAlertCircle } from "react-icons/lu";

import { Hidden, Input, Password, Submit } from "~/components/Form";
import { loginValidator } from "~/services/auth";
import {
  signInWithEmail,
  verifyAuthSession,
} from "~/services/auth/auth.server";
import { commitAuthSession, getAuthSession } from "~/services/session.server";
import type { Result } from "~/types";
import { assertIsPost, safeRedirect } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Login" }];
};

export async function loader({ request }: LoaderFunctionArgs) {
  const authSession = await getAuthSession(request);
  if (authSession && (await verifyAuthSession(authSession))) {
    if (authSession) throw redirect(path.to.authenticatedRoot);
  }

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const validation = await validator(loginValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { email, password, redirectTo } = validation.data;

  const authSession = await signInWithEmail(email, password);

  if (!authSession) {
    // delay on incorrect password as minimal brute force protection
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return json(error(authSession, "Invalid email/password"), {
      status: 500,
    });
  }

  throw redirect(safeRedirect(redirectTo), {
    headers: {
      "Set-Cookie": await commitAuthSession(request, {
        authSession,
      }),
    },
  });
}

export default function LoginRoute() {
  const result = useActionData<Result>();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") ?? undefined;

  const handleClick = () => {
    posthog.capture("sign_in_clicked");
  };

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
          validator={loginValidator}
          defaultValues={{ redirectTo }}
          method="post"
        >
          <VStack spacing={4}>
            {result && result?.message && (
              <Alert variant="destructive">
                <LuAlertCircle className="w-4 h-4" />
                <AlertTitle>{result?.message}</AlertTitle>
              </Alert>
            )}

            <Input name="email" label="Email" />
            <Password name="password" label="Password" type="password" />
            <Hidden name="redirectTo" value={redirectTo} type="hidden" />
            <Submit size="lg" className="w-full" onClick={handleClick}>
              Sign In
            </Submit>
            <Button variant="link" asChild className="w-full">
              <Link to={path.to.forgotPassword}>Forgot Password</Link>
            </Button>
          </VStack>
        </ValidatedForm>
      </div>
    </>
  );
}
