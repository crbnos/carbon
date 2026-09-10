import { assertIsPost, error, RATE_LIMIT, safeRedirect } from "@carbon/auth";
import { userHasVerifiedTotpFactor } from "@carbon/auth/mfa.server";
import {
  completeMfaChallenge,
  flash,
  getAuthSession,
  getPendingMfaSession
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
import { useEffect, useRef } from "react";
import { LuCircleAlert } from "react-icons/lu";
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
  return [{ title: "Carbon | Two-Factor Authentication" }];
};

const mfaValidator = z.object({
  code: z.string().length(6),
  redirectTo: z.string().optional()
});

export async function loader({ request }: LoaderFunctionArgs) {
  const pending = await getPendingMfaSession(request);
  if (pending) return null;

  const authSession = await getAuthSession(request);
  if (!authSession) throw redirect(path.to.login);

  // Only a session bounced here by the active MFA re-check should stay — an
  // already-verified session (or one with no factor) has nothing to prove.
  if (
    authSession.mfaVerified ||
    !(await userHasVerifiedTotpFactor(authSession.userId))
  ) {
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

  const validation = await validator(mfaValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return error(validation.error, "Invalid code");
  }

  const { code, redirectTo } = validation.data;

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
      headers: [["Set-Cookie", result.sessionCookie]]
    }
  );
}

type MfaResult = { success: boolean; message?: string };

/**
 * Lives inside ValidatedForm so it can reach the shared `code` field state.
 * A rejected code must be cleared: the field would otherwise still hold six
 * digits, the auto-submit effect (which fires on length === 6) would not
 * re-run, and the user would be staring at a full input that does nothing.
 */
function MfaCodeField({ result }: { result?: MfaResult }) {
  const [, setCode] = useControlField<string>("code");
  const lastResult = useRef(result);

  useEffect(() => {
    if (result === lastResult.current) return;
    lastResult.current = result;
    if (result?.success === false) setCode("");
  }, [result, setCode]);

  return <InputOTP name="code" label="" />;
}

export default function MfaRoute() {
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") ?? undefined;

  const fetcher = useFetcher<MfaResult>();

  return (
    <>
      <div className="flex justify-center mb-8">
        <img
          src="/carbon-mark-light.svg"
          alt="Carbon Logo"
          className="w-24 dark:hidden"
        />
        <img
          src="/carbon-mark-dark.svg"
          alt="Carbon Logo"
          className="w-24 hidden dark:block"
        />
      </div>
      <div className="rounded-lg p-8 w-[380px]">
        <ValidatedForm fetcher={fetcher} validator={mfaValidator} method="post">
          <Hidden name="redirectTo" value={redirectTo} />
          <VStack spacing={4} className="items-center">
            <Heading size="h3">Two-factor authentication</Heading>
            <p className="text-muted-foreground tracking-tight text-sm text-center">
              Enter the 6-digit code from your authenticator app
            </p>

            {fetcher.data?.success === false && fetcher.data?.message && (
              <Alert variant="destructive">
                <LuCircleAlert className="w-4 h-4" />
                <AlertTitle>Authentication Error</AlertTitle>
                <AlertDescription>{fetcher.data?.message}</AlertDescription>
              </Alert>
            )}

            <MfaCodeField result={fetcher.data} />

            <Submit
              size="lg"
              className="w-full"
              withBlocker={false}
              isDisabled={fetcher.state !== "idle"}
            >
              Verify
            </Submit>
          </VStack>
        </ValidatedForm>
        <Form
          method="post"
          action={path.to.logout}
          className="flex justify-center mt-4"
        >
          <Button type="submit" variant="link" size="sm">
            Use a different account
          </Button>
        </Form>
      </div>
    </>
  );
}
