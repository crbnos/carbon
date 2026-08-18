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
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useEffect, useRef } from "react";
import { LuLock } from "react-icons/lu";
import { Form, useFetcher, useLocation } from "react-router";
import { z } from "zod";

import type { Result } from "~/types";
import { path } from "~/utils/path";

/**
 * Full-screen pattern-hiding lock overlay + in-place re-auth (NIST 800-171
 * 3.1.10 / AC-11(1)). Shown by the shell when `useIdle` reports inactivity: it
 * CONCEALS all page content (opaque `bg-background`, top z-index) AND carries the
 * TOTP re-auth form itself, so unlocking is a single screen. It posts to the
 * `/unlock` action with `inline=true`; on success the action rotates the session
 * cookie and returns data (no navigation), the overlay calls `onUnlocked` to
 * clear the client lock, and React Router revalidates with the fresh session —
 * resuming the SAME session exactly where the user left off. The server is still
 * the real boundary (requireAuthSession redirects idle requests to the full-page
 * /unlock route); this overlay is the immediate concealment + fast path.
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
  onUnlocked
}: {
  onUnlocked?: () => void;
}) {
  const location = useLocation();
  const redirectTo = `${location.pathname}${location.search}`;

  const fetcher = useFetcher<Result>();

  // A successful in-place unlock rotated the cookie already; clear the client
  // lock so the overlay unmounts and the app (revalidated with the fresh
  // session) shows through.
  useEffect(() => {
    if (fetcher.data?.success === true) onUnlocked?.();
  }, [fetcher.data, onUnlocked]);

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
              <Trans>
                Your session was locked after inactivity. Enter the 6-digit code
                from your authenticator app to resume.
              </Trans>
            </p>
          </VStack>

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
              {fetcher.data?.success === false && fetcher.data?.message && (
                <Alert variant="destructive">
                  <LuLock className="w-4 h-4" />
                  <AlertTitle>
                    <Trans>Unable to unlock</Trans>
                  </AlertTitle>
                  <AlertDescription>{fetcher.data.message}</AlertDescription>
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
