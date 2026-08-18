import { assertIsPost, error, RATE_LIMIT, safeRedirect } from "@carbon/auth";
import { setCompanyId } from "@carbon/auth/company.server";
import { userHasVerifiedTotpFactor } from "@carbon/auth/mfa.server";
import {
  completeMfaChallenge,
  flash,
  getAuthSession,
  isSessionExpiredAbsolute,
  isSessionIdleLocked
} from "@carbon/auth/session.server";
import {
  Hidden,
  InputOTP,
  Submit,
  useControlField,
  ValidatedForm,
  validator
} from "@carbon/form";
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
import { useEffect, useRef } from "react";
import { LuLock } from "react-icons/lu";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction
} from "react-router";
import {
  data,
  Form,
  redirect,
  useFetcher,
  useSearchParams
} from "react-router";
import { z } from "zod";

import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Session Locked" }];
};

const unlockValidator = z.object({
  code: z.string().length(6),
  redirectTo: z.string().optional()
});

export async function loader({ request }: LoaderFunctionArgs) {
  // Read the session DIRECTLY (never requireAuthSession — that is what redirects
  // here, which would loop). Only a genuinely idle-locked session stays. Console
  // DEVICE sessions never reach here (they are exempt in requireAuthSession).
  const authSession = await getAuthSession(request);
  if (!authSession) throw redirect(path.to.login);

  const redirectTo =
    new URL(request.url).searchParams.get("redirectTo") ?? undefined;

  if (isSessionExpiredAbsolute(authSession)) {
    throw redirect(path.to.login);
  }
  if (!isSessionIdleLocked(authSession)) {
    throw redirect(safeRedirect(redirectTo, path.to.authenticatedRoot));
  }
  if (!(await userHasVerifiedTotpFactor(authSession.userId))) {
    throw redirect(path.to.login);
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

  const validation = await validator(unlockValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return error(validation.error, "Invalid code");
  }

  const { code, redirectTo } = validation.data;

  // Re-auth in place: completeMfaChallenge rotates tokens in the same cookie and
  // (via makeAuthSession) re-stamps createdAt/lastActiveAt = now.
  const result = await completeMfaChallenge(request, code);

  if (!result.success) {
    if (result.reason === "no-session") {
      throw redirect(path.to.login);
    }
    return data(
      error(null, "Invalid or expired code"),
      await flash(request, error(null, "Invalid or expired code"))
    );
  }

  return redirect(
    safeRedirect(result.redirectTo ?? redirectTo, path.to.authenticatedRoot),
    {
      headers: [
        ["Set-Cookie", result.sessionCookie],
        ["Set-Cookie", setCompanyId(result.authSession.companyId)]
      ]
    }
  );
}

type UnlockResult = { success: boolean; message?: string };

function UnlockCodeField({ result }: { result?: UnlockResult }) {
  const [, setCode] = useControlField<string>("code");
  const lastResult = useRef(result);

  useEffect(() => {
    if (result === lastResult.current) return;
    lastResult.current = result;
    if (result?.success === false) setCode("");
  }, [result, setCode]);

  return <InputOTP name="code" label="" />;
}

export default function UnlockRoute() {
  const { t } = useLingui();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") ?? undefined;

  const fetcher = useFetcher<UnlockResult>();

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
          validator={unlockValidator}
          method="post"
        >
          <Hidden name="redirectTo" value={redirectTo} />
          <VStack spacing={4} className="items-center">
            <LuLock className="w-8 h-8 text-muted-foreground" />
            <Heading size="h3">
              <Trans>Session locked</Trans>
            </Heading>
            <p className="text-muted-foreground tracking-tight text-sm text-center">
              <Trans>
                Your session was locked after inactivity. Enter the 6-digit code
                from your authenticator app to resume.
              </Trans>
            </p>

            {fetcher.data?.success === false && fetcher.data?.message && (
              <Alert variant="destructive">
                <LuLock className="w-4 h-4" />
                <AlertTitle>
                  <Trans>Unable to unlock</Trans>
                </AlertTitle>
                <AlertDescription>{fetcher.data?.message}</AlertDescription>
              </Alert>
            )}

            <UnlockCodeField result={fetcher.data} />

            <Submit
              size="lg"
              className="w-full"
              withBlocker={false}
              isDisabled={fetcher.state !== "idle"}
            >
              <Trans>Unlock</Trans>
            </Submit>
          </VStack>
        </ValidatedForm>
        <Form
          method="post"
          action={path.to.logout}
          className="flex justify-center mt-4"
        >
          <Button type="submit" variant="link" size="sm">
            <Trans>Sign out instead</Trans>
          </Button>
        </Form>
      </div>
    </>
  );
}
