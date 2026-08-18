import {
  Hidden,
  InputOTP,
  Submit,
  useControlField,
  ValidatedForm
} from "@carbon/form";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  Heading,
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  browserSupportsWebAuthn,
  startAuthentication
} from "@simplewebauthn/browser";
import { useEffect, useRef, useState } from "react";
import { LuFingerprint, LuLock } from "react-icons/lu";
import { Form, useFetcher, useLocation } from "react-router";
import { z } from "zod";

import type { Result } from "~/types";
import { path } from "~/utils/path";

/**
 * Full-screen pattern-hiding lock overlay + in-place re-auth (NIST 800-171
 * 3.1.10 / AC-11(1)). Shown by the shell when `useIdle` reports inactivity: it
 * CONCEALS all page content (opaque `bg-background`, top z-index) AND carries the
 * re-auth controls itself, so unlocking is a single screen. TOTP posts a form to
 * the `/unlock` action; a passkey posts the WebAuthn assertion as JSON. Both use
 * `inline=true`: on success the action resumes the SAME session in place (rotated
 * cookie returned as data, no navigation), the overlay calls `onUnlocked` to
 * clear the client lock, and React Router revalidates with the fresh session.
 * The server is still the real boundary (requireAuthSession redirects idle
 * requests to the full-page /unlock route); this overlay is the immediate
 * concealment + fast path.
 */
const overlayValidator = z.object({
  code: z.string().length(6),
  redirectTo: z.string().optional(),
  inline: z.string().optional()
});

/**
 * Lives inside ValidatedForm so it can reach the shared `code` field state. A
 * rejected code is cleared so the user can retype without stale digits.
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

export default function SessionLockOverlay({
  onUnlocked,
  hasPasskeyAuth = false
}: {
  onUnlocked?: () => void;
  hasPasskeyAuth?: boolean;
}) {
  const { t } = useLingui();
  const location = useLocation();
  const redirectTo = `${location.pathname}${location.search}`;

  const fetcher = useFetcher<Result>();

  const [passkeySupported, setPasskeySupported] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);

  useEffect(() => {
    if (hasPasskeyAuth && browserSupportsWebAuthn()) setPasskeySupported(true);
  }, [hasPasskeyAuth]);

  // A successful in-place unlock (TOTP or passkey) rotated the cookie already;
  // clear the client lock so the overlay unmounts and the app (revalidated with
  // the fresh session) shows through.
  useEffect(() => {
    if (fetcher.data?.success === true) onUnlocked?.();
  }, [fetcher.data, onUnlocked]);

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

      // inline=true → the action returns data (no navigation); the fetcher's
      // success effect above clears the lock in place.
      fetcher.submit({ credential, challengeId, inline: "true" } as any, {
        method: "post",
        action: "/unlock",
        encType: "application/json"
      });
    } catch (e: any) {
      if (e?.name !== "NotAllowedError" && e?.name !== "AbortError") {
        toast.error(t`Passkey unlock failed`);
      }
    } finally {
      setPasskeyLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background p-6">
      <Card className="w-[420px] max-w-full">
        <CardContent className="flex flex-col items-center gap-6 p-8 text-center">
          <span className="flex items-center justify-center size-14 rounded-full bg-muted">
            <LuLock className="size-6 text-muted-foreground" />
          </span>
          <VStack spacing={2} className="items-center">
            <Heading size="h2" className="text-balance">
              <Trans>Session locked</Trans>
            </Heading>
            <p className="text-sm text-muted-foreground text-pretty">
              <Trans>Your session was locked after inactivity.</Trans>
            </p>
          </VStack>

          <VStack spacing={4} className="items-center w-full">
            {fetcher.data?.success === false && fetcher.data?.message && (
              <Alert variant="destructive">
                <LuLock className="w-4 h-4" />
                <AlertTitle>
                  <Trans>Unable to unlock</Trans>
                </AlertTitle>
                <AlertDescription>{fetcher.data.message}</AlertDescription>
              </Alert>
            )}

            {hasPasskeyAuth && passkeySupported && (
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

            {hasPasskeyAuth && passkeySupported && (
              <div className="flex items-center gap-3 w-full">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground uppercase">
                  <Trans>or</Trans>
                </span>
                <div className="h-px flex-1 bg-border" />
              </div>
            )}

            <ValidatedForm
              fetcher={fetcher}
              validator={overlayValidator}
              method="post"
              action="/unlock"
              className="w-full"
            >
              <Hidden name="redirectTo" value={redirectTo} />
              <Hidden name="inline" value="true" />
              <VStack spacing={4} className="items-center">
                <p className="text-sm text-muted-foreground text-pretty">
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
          </VStack>

          <Form method="post" action={path.to.logout}>
            <Button
              type="submit"
              variant="link"
              size="sm"
              className="text-muted-foreground"
            >
              <Trans>Sign out instead</Trans>
            </Button>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
