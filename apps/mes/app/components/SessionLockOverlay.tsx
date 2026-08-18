import { Button, Card, CardContent, Heading, VStack } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuLock } from "react-icons/lu";
import { Link, useLocation } from "react-router";

/**
 * Full-screen pattern-hiding lock overlay (NIST 800-171 3.1.10 / AC-11(1)).
 * Shown by the shell when `useIdle` reports inactivity. It CONCEALS all page
 * content (opaque `bg-background`, top z-index) and funnels to /unlock, where the
 * user re-authenticates (TOTP) to resume the SAME session. The server is the real
 * boundary (requireAuthSession redirects idle requests to /unlock); this overlay
 * is the immediate concealment so CUI never lingers on an unattended screen.
 */
export default function SessionLockOverlay() {
  const location = useLocation();
  const redirectTo = `${location.pathname}${location.search}`;

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
                Your session was locked after a period of inactivity.
                Re-authenticate to continue where you left off.
              </Trans>
            </p>
          </VStack>
          <Button asChild size="lg" className="w-full">
            <Link to={`/unlock?redirectTo=${encodeURIComponent(redirectTo)}`}>
              <Trans>Unlock</Trans>
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
