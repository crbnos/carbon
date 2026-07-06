import crypto from "node:crypto";
import { assertIsPost, error, RATE_LIMIT } from "@carbon/auth";
import {
  createEmailAuthAccount,
  signInWithEmail
} from "@carbon/auth/auth.server";
import {
  flash,
  getAuthSession,
  setAuthSession
} from "@carbon/auth/session.server";
import { verifyEmailCode } from "@carbon/auth/verification.server";
import { Hidden, InputOTP, ValidatedForm, validator } from "@carbon/form";
import { Ratelimit, redis } from "@carbon/kv";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Heading,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuCircleAlert } from "react-icons/lu";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction
} from "react-router";
import {
  data,
  Link,
  redirect,
  useFetcher,
  useSearchParams
} from "react-router";
import { z } from "zod";

import type { Result } from "~/types";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Verify Email" }];
};

const verifyValidator = z.object({
  email: z.string().email(),
  code: z.string().length(6),
  redirectTo: z.string().optional()
});

export async function loader({ request }: LoaderFunctionArgs) {
  const authSession = await getAuthSession(request);
  if (authSession) {
    throw redirect(path.to.authenticatedRoot);
  }

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const ip = request.headers.get("x-forwarded-for") ?? "127.0.0.1";

  const ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(RATE_LIMIT, "1 h"),
    analytics: true
  });

  const { success } = await ratelimit.limit(ip);

  if (!success) {
    return data(
      error(null, "Rate limit exceeded"),
      await flash(request, error(null, "Rate limit exceeded"))
    );
  }

  const validation = await validator(verifyValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return error(validation.error, "Invalid verification code");
  }

  const { email, code, redirectTo } = validation.data;

  // Verify the email code
  const isCodeValid = await verifyEmailCode(email, code);

  if (!isCodeValid) {
    return data(
      error(null, "Invalid or expired verification code"),
      await flash(request, error(null, "Invalid or expired verification code"))
    );
  }

  // Create the user account with a temporary password
  const temporaryPassword = crypto.randomBytes(16).toString("hex");

  const user = await createEmailAuthAccount(email, temporaryPassword);

  if (!user) {
    return data(
      error(null, "Failed to create user account"),
      await flash(request, error(null, "Failed to create user account"))
    );
  }

  // Sign in the user to create an authentication session
  const authSession = await signInWithEmail(email, temporaryPassword);

  if (!authSession) {
    return data(
      error(null, "Failed to sign in user"),
      await flash(request, error(null, "Failed to sign in user"))
    );
  }

  const sessionCookie = await setAuthSession(request, {
    authSession
  });

  // Set the authentication session
  const onboardingUrl = redirectTo || path.to.onboarding.root;

  return redirect(onboardingUrl, {
    headers: [["Set-Cookie", sessionCookie]]
  });
}

export default function VerifyRoute() {
  const { t } = useLingui();
  const [searchParams] = useSearchParams();
  const email = searchParams.get("email") ?? "";
  const redirectTo = searchParams.get("redirectTo") ?? undefined;

  const fetcher = useFetcher<Result>();

  return (
    <>
      <div className="flex justify-center mb-8">
        <img
          src="/carbon-mark-light.svg"
          alt={t`Carbon Logo`}
          className="w-24 dark:hidden"
        />
        <img
          src="/carbon-mark-dark.svg"
          alt={t`Carbon Logo`}
          className="w-24 hidden dark:block"
        />
      </div>
      <div className="rounded-lg md:bg-card md:border md:border-border md:shadow-lg p-8 w-[380px]">
        <ValidatedForm
          fetcher={fetcher}
          validator={verifyValidator}
          defaultValues={{ email, redirectTo }}
          method="post"
        >
          <Hidden name="email" value={email} />
          <Hidden name="redirectTo" value={redirectTo} />
          <VStack spacing={4} className="items-center">
            <Heading size="h3">
              <Trans>Verify your email</Trans>
            </Heading>
            <p className="text-muted-foreground tracking-tight text-sm text-center">
              <Trans>We've sent a verification code to {email}</Trans>
            </p>

            {fetcher.data?.success === false && fetcher.data?.message && (
              <Alert variant="destructive">
                <LuCircleAlert className="w-4 h-4" />
                <AlertTitle>
                  <Trans>Verification Error</Trans>
                </AlertTitle>
                <AlertDescription>{fetcher.data?.message}</AlertDescription>
              </Alert>
            )}

            <InputOTP name="code" label="" />

            <Button type="button" variant="link" size="sm" asChild>
              <Link to="/login">
                <Trans>Use a different email</Trans>
              </Link>
            </Button>
          </VStack>
        </ValidatedForm>
      </div>
    </>
  );
}
