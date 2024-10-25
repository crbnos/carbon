import type { Result } from "@carbon/auth";
import {
  assertIsPost,
  error,
  loginValidator,
  safeRedirect,
} from "@carbon/auth";
import { signInWithEmail, verifyAuthSession } from "@carbon/auth/auth.server";
import { commitAuthSession, getAuthSession } from "@carbon/auth/session.server";
import {
  Hidden,
  Input,
  Password,
  Submit,
  ValidatedForm,
  validationError,
  validator,
} from "@carbon/form";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  VStack,
} from "@carbon/react";
import { Link, useActionData, useSearchParams } from "@remix-run/react";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import posthog from "posthog-js";
import { LuAlertCircle } from "react-icons/lu";

import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon Developers | Login" }];
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
      <div className="flex flex-col items-center justify-center">
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
        <h3 className="font-mono font-bold leading-loose uppercase text-xl">
          Developers
        </h3>
      </div>
      <div className="p-8 w-[380px]">
        <ValidatedForm
          validator={loginValidator}
          defaultValues={{ redirectTo }}
          method="post"
        >
          <VStack spacing={4}>
            {result && result?.message && (
              <Alert variant="destructive">
                <LuAlertCircle className="w-4 h-4" />
                <AlertTitle>Authentication Error</AlertTitle>
                <AlertDescription>{result?.message}</AlertDescription>
              </Alert>
            )}

            <Input name="email" label="Email" />
            <Password name="password" label="Password" type="password" />
            <Hidden name="redirectTo" value={redirectTo} type="hidden" />
            <Submit
              size="lg"
              className="w-full"
              onClick={handleClick}
              withBlocker={false}
            >
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
