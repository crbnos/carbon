import { assertIsPost, error } from "@carbon/auth";
import {
  createEmailAuthAccount,
  signInWithEmail,
} from "@carbon/auth/auth.server";
import {
  flash,
  getAuthSession,
  setAuthSession,
} from "@carbon/auth/session.server";
import { verifyEmailCode } from "@carbon/auth/verification.server";
import { Hidden, InputOTP, ValidatedForm, validator } from "@carbon/form";
import { redis } from "@carbon/kv";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Heading,
  VStack,
} from "@carbon/react";
import { Link, useFetcher, useSearchParams } from "@remix-run/react";
import { Ratelimit } from "@upstash/ratelimit";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import crypto from "node:crypto";
import { LuCircleAlert } from "react-icons/lu";
import { z } from "zod";

import type { FormActionData, Result } from "~/types";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Verify Email" }];
};

export const config = {
  runtime: "nodejs",
};

const verifyValidator = z.object({
  email: z.string().email(),
  code: z.string().length(6),
  redirectTo: z.string().optional(),
});

export async function loader({ request }: LoaderFunctionArgs) {
  const authSession = await getAuthSession(request);
  if (authSession) {
    throw redirect(path.to.authenticatedRoot);
  }

  return null;
}

const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, "1 h"), // 5 submissions per hour
  analytics: true,
});

export async function action({ request }: ActionFunctionArgs): FormActionData {
  assertIsPost(request);
  const ip = request.headers.get("x-forwarded-for") ?? "127.0.0.1";

  const { success } = await ratelimit.limit(ip);

  if (!success) {
    return json(
      error(null, "Rate limit exceeded"),
      await flash(request, error(null, "Rate limit exceeded"))
    );
  }

  const validation = await validator(verifyValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return json(error(validation.error, "Invalid verification code"));
  }

  const { email, code, redirectTo } = validation.data;

  // Verify the email code
  const isCodeValid = await verifyEmailCode(email, code);

  if (!isCodeValid) {
    return json(
      error(null, "Invalid or expired verification code"),
      await flash(request, error(null, "Invalid or expired verification code"))
    );
  }

  // Create the user account with a temporary password
  const temporaryPassword = crypto.randomBytes(16).toString("hex");

  const user = await createEmailAuthAccount(email, temporaryPassword);

  if (!user) {
    return json(
      error(null, "Failed to create user account"),
      await flash(request, error(null, "Failed to create user account"))
    );
  }

  // Sign in the user to create an authentication session
  const authSession = await signInWithEmail(email, temporaryPassword);

  if (!authSession) {
    return json(
      error(null, "Failed to sign in user"),
      await flash(request, error(null, "Failed to sign in user"))
    );
  }

  const sessionCookie = await setAuthSession(request, {
    authSession,
  });

  // Set the authentication session
  const onboardingUrl = redirectTo || path.to.onboarding.root;

  return redirect(onboardingUrl, {
    headers: [["Set-Cookie", sessionCookie]],
  });
}

export default function VerifyRoute() {
  const [searchParams] = useSearchParams();
  const email = searchParams.get("email") ?? "";
  const redirectTo = searchParams.get("redirectTo") ?? undefined;

  const fetcher = useFetcher<Result>();

  return (
    <>
      <div className="flex justify-center mb-4">
        <img src="/carbon-logo-mark.svg" alt="Carbon Logo" className="w-36" />
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
            <Heading size="h3">Verify your email</Heading>
            <p className="text-muted-foreground tracking-tight text-sm text-center">
              We've sent a verification code to {email}
            </p>

            {fetcher.data?.success === false && fetcher.data?.message && (
              <Alert variant="destructive">
                <LuCircleAlert className="w-4 h-4" />
                <AlertTitle>Verification Error</AlertTitle>
                <AlertDescription>{fetcher.data?.message}</AlertDescription>
              </Alert>
            )}

            <InputOTP name="code" label="" />

            <Button type="button" variant="link" size="sm" asChild>
              <Link to="/login">Use a different email</Link>
            </Button>
          </VStack>
        </ValidatedForm>
      </div>
    </>
  );
}
