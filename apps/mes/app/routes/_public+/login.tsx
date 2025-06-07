import type { Result } from "@carbon/auth";
import {
  assertIsPost,
  error,
  loginValidator,
  safeRedirect,
} from "@carbon/auth";
import { signInWithEmail, verifyAuthSession } from "@carbon/auth/auth.server";
import { setCompanyId } from "@carbon/auth/company.server";
import { getAuthSession, setAuthSession } from "@carbon/auth/session.server";
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
import { LuCircleAlert } from "react-icons/lu";

import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon MES | Login" }];
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

  const sessionCookie = await setAuthSession(request, {
    authSession,
  });
  const companyIdCookie = setCompanyId(authSession.companyId);

  throw redirect(safeRedirect(redirectTo), {
    headers: [
      ["Set-Cookie", sessionCookie],
      ["Set-Cookie", companyIdCookie],
    ],
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
      <div className="flex justify-center mb-4">
        <img src="/carbon-logo-mark.svg" alt="Carbon Logo" className="w-36" />
      </div>
      <div className="rounded-lg md:bg-card md:border md:border-border md:shadow-lg p-8 w-[380px]">
        <ValidatedForm
          validator={loginValidator}
          defaultValues={{ redirectTo }}
          method="post"
        >
          <VStack spacing={4}>
            {result && result?.message && (
              <Alert variant="destructive">
                <LuCircleAlert className="w-4 h-4" />
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
      <div className="text-sm text-muted-foreground w-[380px] mt-4">
        <p>
          By signing in, you agree to the{" "}
          <a
            href="https://carbon.ms/terms"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            Terms of Service
          </a>{" "}
          and{" "}
          <a
            href="https://carbon.ms/privacy"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            Privacy Policy.
          </a>
        </p>
      </div>
    </>
  );
}
