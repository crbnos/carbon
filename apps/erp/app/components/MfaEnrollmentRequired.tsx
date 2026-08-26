import {
  Alert,
  AlertDescription,
  AlertTitle,
  Avatar,
  Button,
  Card,
  CardContent,
  Heading,
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { IconType } from "react-icons";
import {
  LuCircleAlert,
  LuKeyRound,
  LuShieldOff,
  LuSmartphone
} from "react-icons/lu";
import { Form } from "react-router";
import { OtpInput, useTotpEnrollment } from "~/components/TotpEnrollment";

type MfaEnrollmentRequiredProps = {
  enrollAction: string;
  verifyAction: string;
  logoutAction: string;
  /** Set when the deployment forces MFA rather than the company toggling it. */
  controlledEnvironment?: boolean;
  userName?: string;
  avatarUrl?: string | null;
};

const Benefit = ({
  icon: Icon,
  title,
  description
}: {
  icon: IconType;
  title: React.ReactNode;
  description: React.ReactNode;
}) => (
  <div className="flex items-start gap-4 rounded-lg bg-muted/50 p-4 w-full">
    <div className="flex items-center justify-center size-10 shrink-0 rounded-md bg-background">
      <Icon className="size-4 text-muted-foreground" />
    </div>
    <div className="flex flex-col gap-0.5">
      <p className="text-sm font-medium text-pretty">{title}</p>
      <p className="text-sm text-muted-foreground text-pretty">{description}</p>
    </div>
  </div>
);

/**
 * Blocking full-screen gate shown when the company (or a controlled
 * deployment) requires two-factor authentication and the user has not enrolled.
 *
 * Rendered IN PLACE of the app shell rather than redirected to, mirroring the
 * ITAR certification gate: a redirect would have to whitelist the very API
 * routes used to escape it, and any gap in that whitelist is either a lockout
 * or a hole. Nothing here is skippable client-side — the loader decides.
 */
const MfaEnrollmentRequired = ({
  enrollAction,
  verifyAction,
  logoutAction,
  controlledEnvironment = false,
  userName,
  avatarUrl
}: MfaEnrollmentRequiredProps) => {
  const { t } = useLingui();
  const {
    enrollment,
    starting,
    verifying,
    error,
    code,
    setCode,
    start: onStart,
    verify: onVerify
  } = useTotpEnrollment({
    enrollAction,
    verifyAction,
    // Full reload so the shell loader re-runs and the gate clears.
    onVerified: () => {
      toast.success("Two-factor authentication enabled");
      window.location.reload();
    }
  });

  return (
    <div className="flex flex-col items-center justify-center h-full w-full p-6 overflow-y-auto">
      <Card className="w-[480px] max-w-full">
        <CardContent className="flex flex-col items-center gap-6 p-8">
          <div className="relative">
            <Avatar size="xl" name={userName} src={avatarUrl ?? undefined} />
            <span className="absolute -bottom-1 -right-1 flex items-center justify-center size-8 rounded-full bg-muted ring-4 ring-card">
              <LuShieldOff className="size-4 text-muted-foreground" />
            </span>
          </div>

          <Heading size="h2" className="text-center text-balance">
            <Trans>Secure your account with 2FA</Trans>
          </Heading>

          {!enrollment ? (
            <>
              <VStack spacing={2} className="w-full">
                <Benefit
                  icon={LuKeyRound}
                  title={
                    <Trans>
                      Your account stays safe even if your login is stolen
                    </Trans>
                  }
                  description={
                    <Trans>
                      Signing in also requires a one-time code from your
                      authenticator app
                    </Trans>
                  }
                />
                <Benefit
                  icon={LuSmartphone}
                  title={<Trans>Protects your company's data</Trans>}
                  description={
                    <Trans>
                      Keeps orders, quotes, and settings behind a second check
                    </Trans>
                  }
                />
              </VStack>

              {error && (
                <Alert variant="destructive">
                  <LuCircleAlert className="w-4 h-4" />
                  <AlertTitle>
                    <Trans>Setup failed</Trans>
                  </AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <VStack spacing={2} className="w-full items-center">
                <p className="text-sm text-muted-foreground text-center text-pretty">
                  {controlledEnvironment ? (
                    <span className="text-xs">
                      <Trans>
                        This is a controlled environment, so an authenticator
                        app is required.
                      </Trans>
                    </span>
                  ) : (
                    <Trans>
                      Your organization requires an authenticator app.
                    </Trans>
                  )}
                </p>

                <Button
                  type="button"
                  size="lg"
                  className="w-full"
                  onClick={onStart}
                  isDisabled={starting}
                  isLoading={starting}
                >
                  <Trans>Set up authenticator app</Trans>
                </Button>

                {/* The gate replaces the whole app shell, so there is no
                    nav behind it — without this, someone who cannot complete
                    setup has no way to leave or switch accounts. */}
                <Form method="post" action={logoutAction} className="w-full">
                  <Button
                    type="submit"
                    variant="ghost"
                    size="md"
                    className="w-full text-muted-foreground"
                  >
                    <Trans>Sign out</Trans>
                  </Button>
                </Form>
              </VStack>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground text-center text-pretty">
                <Trans>
                  Scan this with your authenticator app, then enter the 6-digit
                  code it shows.
                </Trans>
              </p>

              <img
                src={enrollment.qrCode}
                alt={t`Authenticator QR code`}
                className="size-44 rounded-md bg-white p-2"
              />

              <button
                type="button"
                className="font-mono text-xs break-all text-center cursor-pointer text-muted-foreground hover:text-foreground"
                onClick={() => {
                  navigator.clipboard.writeText(enrollment.secret);
                  toast.success("Secret copied to clipboard");
                }}
              >
                {enrollment.secret}
              </button>

              <OtpInput value={code} onChange={setCode} />

              {error && (
                <Alert variant="destructive">
                  <LuCircleAlert className="w-4 h-4" />
                  <AlertTitle>
                    <Trans>Verification failed</Trans>
                  </AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button
                type="button"
                size="lg"
                className="w-full"
                onClick={onVerify}
                isDisabled={code.length !== 6 || verifying}
                isLoading={verifying}
              >
                <Trans>Verify and continue</Trans>
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default MfaEnrollmentRequired;
