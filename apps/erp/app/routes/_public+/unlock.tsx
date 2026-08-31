import {
  assertIsPost,
  error,
  isAuthProviderEnabled,
  RATE_LIMIT,
  safeRedirect
} from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { userHasVerifiedTotpFactor } from "@carbon/auth/mfa.server";
import { verifyPasskeyAuthentication } from "@carbon/auth/passkey.server";
import {
  completeMfaChallenge,
  destroyAuthSession,
  flash,
  getAuthSession,
  isSessionExpiredAbsolute,
  isSessionIdleLocked,
  setAuthSession
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
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { WebAuthnCredential } from "@simplewebauthn/browser";
import {
  browserSupportsWebAuthn,
  startAuthentication
} from "@simplewebauthn/browser";
import { useEffect, useRef, useState } from "react";
import { LuFingerprint, LuLock } from "react-icons/lu";
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
  useLoaderData,
  useSearchParams
} from "react-router";
import { z } from "zod";

import type { Result } from "~/types";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Session Locked" }];
};

const unlockValidator = z.object({
  code: z.string().length(6),
  redirectTo: z.string().optional(),
  // "true" when submitted from the in-app SessionLockOverlay: re-auth resumes the
  // session IN PLACE (rotated cookie returned as data), so the overlay can clear
  // its lock without a full navigation. A full-page /unlock submit omits it and
  // gets the redirect back to `redirectTo` instead.
  inline: z.string().optional()
});

/** Does this user have at least one registered passkey? (Cheap count, head-only.) */
async function userHasPasskey(userId: string): Promise<boolean> {
  const serviceRole = getCarbonServiceRole();
  const { count, error: countError } = await (serviceRole as any)
    .from("passkeyCredential")
    .select("id", { count: "exact", head: true })
    .eq("userId", userId);
  if (countError) return false;
  return (count ?? 0) > 0;
}

export async function loader({ request }: LoaderFunctionArgs) {
  // Read the session DIRECTLY (never requireAuthSession — that is what redirects
  // here, which would loop). Only a genuinely idle-locked session stays.
  const authSession = await getAuthSession(request);
  if (!authSession) throw redirect(path.to.login);

  const redirectTo =
    new URL(request.url).searchParams.get("redirectTo") ?? undefined;

  // Absolute cap already passed → termination wins over lock; force full re-login.
  // DESTROY the session (not a bare redirect): the tokens are still valid, so
  // /login would just bounce an authenticated user straight back to the app and
  // /unlock would relock them — an ERR_TOO_MANY_REDIRECTS loop. Clearing the
  // cookie makes /login render its form.
  if (isSessionExpiredAbsolute(authSession)) {
    throw await destroyAuthSession(request);
  }
  // Not actually locked → nothing to unlock, send them where they were going.
  if (!isSessionIdleLocked(authSession)) {
    throw redirect(safeRedirect(redirectTo, path.to.authenticatedRoot));
  }

  // Unlock credentials: a verified TOTP factor and/or a registered passkey.
  // Either can re-establish access here; a session with neither cannot unlock
  // (happens on FIRST-RUN enterprise: a user who idle-locks before enrolling
  // MFA has nothing to present) — DESTROY the session and force a full re-login.
  // A bare redirect(login) would loop: the tokens are still valid, so /login
  // sends them back to the app, /x relocks, /unlock lands here again.
  const [hasTotp, hasPasskey] = await Promise.all([
    userHasVerifiedTotpFactor(authSession.userId),
    isAuthProviderEnabled("passkey")
      ? userHasPasskey(authSession.userId)
      : Promise.resolve(false)
  ]);

  if (!hasTotp && !hasPasskey) {
    throw await destroyAuthSession(request);
  }

  return { hasTotp, hasPasskey };
}

/**
 * Passkey unlock. Unlike a login, this RESUMES the existing locked session in
 * place — it never mints a new one. The presented passkey must belong to the
 * locked session's user, or another user's passkey could unlock this session.
 */
async function unlockWithPasskey(request: Request) {
  if (!isAuthProviderEnabled("passkey")) {
    return data(error(null, "Passkeys are disabled"), { status: 404 });
  }

  // The session we are resuming. If there is none, there is nothing to unlock.
  const authSession = await getAuthSession(request);
  if (!authSession?.accessToken || !authSession?.refreshToken) {
    return data(error(null, "Your session has ended. Please sign in again."), {
      status: 401
    });
  }

  let body: {
    credential?: any;
    challengeId?: string;
    redirectTo?: string;
    inline?: string;
  };
  try {
    body = await request.json();
  } catch {
    return data(error(null, "Unable to unlock. Please try again."), {
      status: 400
    });
  }

  const {
    credential: webAuthnResponse,
    challengeId,
    redirectTo,
    inline
  } = body;
  if (!webAuthnResponse?.id || !challengeId) {
    return data(error(null, "Unable to unlock. Please try again."), {
      status: 400
    });
  }

  const serviceRole = getCarbonServiceRole();

  const { data: credRow, error: credError } = await (serviceRole as any)
    .from("passkeyCredential")
    .select("id, userId, publicKey, counter, transports")
    .eq("id", webAuthnResponse.id)
    .maybeSingle();

  if (credError || !credRow) {
    return data(error(null, "Unable to unlock. Please try again."), {
      status: 404
    });
  }

  // SECURITY: the passkey MUST belong to the locked session's user. Otherwise a
  // different user's passkey could resume this session in place.
  if (credRow.userId !== authSession.userId) {
    return data(error(null, "That passkey does not match this session."), {
      status: 403
    });
  }

  const storedCredential: WebAuthnCredential = {
    id: credRow.id,
    publicKey: new Uint8Array(Buffer.from(credRow.publicKey, "base64url")),
    counter: credRow.counter,
    transports: credRow.transports ?? null
  };

  try {
    const { newCounter } = await verifyPasskeyAuthentication(
      challengeId,
      webAuthnResponse,
      storedCredential
    );

    const returnedHandle = webAuthnResponse.response?.userHandle;
    if (returnedHandle) {
      const expectedHandle = Buffer.from(
        new TextEncoder().encode(credRow.userId)
      ).toString("base64url");
      if (returnedHandle !== expectedHandle) {
        return data(error(null, "Unable to unlock. Please try again."), {
          status: 401
        });
      }
    }

    const { error: counterError } = await (serviceRole as any)
      .from("passkeyCredential")
      .update({ counter: newCounter, lastUsedAt: new Date().toISOString() })
      .eq("id", credRow.id);

    if (counterError) {
      return data(error(null, "Unable to unlock. Please try again."), {
        status: 500
      });
    }

    // Resume in place: clear the idle-lock clock, and reset the absolute-cap
    // clock (a passkey re-auth is a fresh authentication, matching the TOTP
    // unlock via makeAuthSession). mfaVerified/console are preserved by spread.
    const resumed = {
      ...authSession,
      createdAt: Date.now(),
      lastActiveAt: Date.now()
    };
    const sessionCookie = await setAuthSession(request, {
      authSession: resumed
    });

    // In-app overlay: return the rotated cookie as data (no navigation) so the
    // overlay clears its lock in place and React Router revalidates with the
    // fresh session. Full-page submit: redirect back to where the lock hit.
    if (inline === "true") {
      return data<Result>(
        { success: true },
        { headers: [["Set-Cookie", sessionCookie]] }
      );
    }

    return redirect(safeRedirect(redirectTo, path.to.authenticatedRoot), {
      headers: [["Set-Cookie", sessionCookie]]
    });
  } catch {
    return data(error(null, "Unable to unlock. Please try again."), {
      status: 401
    });
  }
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

  // Passkey unlock arrives as JSON (the credential assertion); TOTP unlock is a
  // form POST. Branch on content type — the TOTP path below is unchanged.
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return unlockWithPasskey(request);
  }

  const validation = await validator(unlockValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return error(validation.error, "Invalid code");
  }

  const { code, redirectTo, inline } = validation.data;

  // Re-auth in place: completeMfaChallenge rotates tokens in the same cookie and
  // (via makeAuthSession) re-stamps createdAt/lastActiveAt = now, so the unlocked
  // session is neither locked nor expired.
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

  // In-app overlay: return the rotated cookie as data (no navigation) so the
  // overlay clears its lock in place and React Router revalidates with the fresh
  // session. Full-page submit: redirect back to where the lock interrupted.
  if (inline === "true") {
    return data<Result>(
      { success: true },
      { headers: [["Set-Cookie", result.sessionCookie]] }
    );
  }

  return redirect(
    safeRedirect(result.redirectTo ?? redirectTo, path.to.authenticatedRoot),
    { headers: [["Set-Cookie", result.sessionCookie]] }
  );
}

/**
 * Lives inside ValidatedForm so it can reach the shared `code` field state. A
 * rejected code must be cleared so the auto-submit effect (fires on length === 6)
 * can run again. Mirrors MfaRoute's MfaCodeField.
 */
function UnlockCodeField({ result }: { result?: Result }) {
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
  const { hasTotp, hasPasskey } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") ?? undefined;

  const fetcher = useFetcher<Result>();

  const [passkeySupported, setPasskeySupported] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);

  useEffect(() => {
    if (hasPasskey && browserSupportsWebAuthn()) setPasskeySupported(true);
  }, [hasPasskey]);

  const onUnlockWithPasskey = async () => {
    setPasskeyLoading(true);
    try {
      const optRes = await fetch("/api/passkey/authenticate/options", {
        method: "POST"
      });
      if (!optRes.ok) throw new Error("Failed to get options");
      const { challengeId, ...options } = await optRes.json();

      const credential = await startAuthentication({
        optionsJSON: options
      } as any);

      // No `inline` → the action redirects; the fetcher follows it and navigates
      // back to where the lock interrupted, with the resumed session cookie.
      fetcher.submit(
        { credential, challengeId, redirectTo: redirectTo ?? null } as any,
        { method: "post", action: "/unlock", encType: "application/json" }
      );
    } catch (e: any) {
      if (e?.name !== "NotAllowedError" && e?.name !== "AbortError") {
        toast.error(t`Passkey unlock failed`);
      }
      setPasskeyLoading(false);
    }
  };

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
      <div className="rounded-lg p-8 w-[380px]">
        <VStack spacing={4} className="items-center">
          <LuLock className="w-8 h-8 text-muted-foreground" />
          <Heading size="h3">
            <Trans>Session locked</Trans>
          </Heading>
          <p className="text-muted-foreground tracking-tight text-sm text-center">
            <Trans>Your session was locked after inactivity.</Trans>
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

          {hasPasskey && passkeySupported && (
            <Button
              type="button"
              size="lg"
              variant="secondary"
              className="w-full"
              leftIcon={<LuFingerprint />}
              onClick={onUnlockWithPasskey}
              isDisabled={passkeyLoading || fetcher.state !== "idle"}
              isLoading={passkeyLoading}
            >
              <Trans>Unlock with passkey</Trans>
            </Button>
          )}

          {hasTotp && hasPasskey && passkeySupported && (
            <div className="flex items-center gap-3 w-full">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground uppercase">
                <Trans>or</Trans>
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>
          )}

          {hasTotp && (
            <ValidatedForm
              fetcher={fetcher}
              validator={unlockValidator}
              method="post"
              className="w-full"
            >
              <Hidden name="redirectTo" value={redirectTo} />
              <VStack spacing={4} className="items-center">
                <p className="text-muted-foreground tracking-tight text-sm text-center">
                  <Trans>
                    Enter the 6-digit code from your authenticator app to
                    resume.
                  </Trans>
                </p>
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
          )}
        </VStack>
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
