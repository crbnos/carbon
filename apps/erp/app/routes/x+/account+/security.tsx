import {
  assertIsPost,
  CONTROLLED_ENVIRONMENT,
  error,
  isAuthProviderEnabled,
  success
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getDeviceId } from "@carbon/auth/device.server";
import { getSessionId } from "@carbon/auth/login-history.server";
import type { TotpFactor } from "@carbon/auth/mfa.server";
import { getTotpFactors } from "@carbon/auth/mfa.server";
import { flash, getAuthSession } from "@carbon/auth/session.server";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  HStack,
  IconButton,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  toast,
  VStack
} from "@carbon/react";
import { isPrivateIp, normalizeIp, parseUserAgent } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { startRegistration } from "@simplewebauthn/browser";
import { useState } from "react";
import {
  LuCircleAlert,
  LuFingerprint,
  LuLogOut,
  LuMonitor,
  LuShieldCheck,
  LuSmartphone,
  LuTrash2
} from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useFetcher, useLoaderData, useRevalidator } from "react-router";
import { DateTime } from "~/components";
import {
  INVALID_CODE_MESSAGE,
  OtpInput,
  useTotpEnrollment
} from "~/components/TotpEnrollment";
import { usePlanGate } from "~/hooks/usePlanGate";
import {
  getActiveSessions,
  getDeviceFirstSeenAt,
  getLoginHistory,
  revokeSession
} from "~/modules/account";
import { TwoFactorUpgradeDialog } from "~/modules/settings";
import { getDatabaseClient } from "~/services/database.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Security`,
  to: path.to.accountSecurity
};

type Passkey = {
  id: string;
  credentialName: string;
  createdAt: string;
  lastUsedAt: string | null;
  backedUp: boolean;
};

/**
 * The live sessions on this account, each annotated with when it began and
 * whether the CALLING device is old enough to end it.
 *
 * Shared by the loader and the action so the gate is computed once: two copies
 * of this join would drift, and the action's copy is the one that actually
 * enforces anything.
 */
async function getDevices(request: Request, sessionUserId: string) {
  const client = getCarbonServiceRole();
  const authSession = await getAuthSession(request);
  const currentSessionId = authSession
    ? getSessionId(authSession.accessToken)
    : null;

  const [loginsResult, activeSessions, deviceFirstSeenAt] = await Promise.all([
    // History rows are the JOIN SOURCE for device/location detail, not a
    // displayed list — fetch enough to cover every live session's login.
    getLoginHistory(client as any, sessionUserId, 100),
    getActiveSessions(getDatabaseClient(), sessionUserId),
    getDeviceFirstSeenAt(
      client as any,
      sessionUserId,
      await getDeviceId(request)
    )
  ]);

  const loginBySession = new Map(
    (loginsResult.data ?? [])
      .filter((login) => login.sessionId)
      .map((login) => [login.sessionId as string, login])
  );

  // One entry per LIVE session ("where you're signed in"). Sessions without a
  // login row (minted before sessionId capture) fall back to what GoTrue
  // recorded on the session itself.
  const devices = activeSessions
    .map((session) => {
      const login = loginBySession.get(session.id);
      const startedAt = login?.createdAt ?? session.createdAt;
      return {
        sessionId: session.id,
        isCurrent: session.id === currentSessionId,
        userAgent: login?.userAgent ?? session.userAgent,
        ipAddress: login?.ipAddress ?? session.ip,
        city: login?.city ?? null,
        country: login?.country ?? null,
        app: login?.app ?? null,
        startedAt,
        lastActiveAt: session.refreshedAt ?? session.createdAt,
        // The gate: this device may only end sessions that began AFTER it
        // first appeared. An attacker's fresh browser is always newer than the
        // owner's established one, and cannot become older by waiting.
        canRevoke:
          deviceFirstSeenAt !== null &&
          Date.parse(deviceFirstSeenAt) < Date.parse(startedAt)
      };
    })
    .sort((a, b) =>
      a.isCurrent !== b.isCurrent
        ? a.isCurrent
          ? -1
          : 1
        : Date.parse(b.lastActiveAt) - Date.parse(a.lastActiveAt)
    );

  return { devices, currentSessionId, deviceFirstSeenAt };
}

export async function loader({ request }: LoaderFunctionArgs) {
  // sessionUserId, not userId: the effective user can be a console-pinned
  // operator, and GoTrue sessions/passkeys belong to whoever is actually
  // signed in. Keying these off the effective user would list (and allow
  // revoking) another person's sessions.
  const { sessionUserId } = await requirePermissions(request, {});
  const serviceRole = getCarbonServiceRole();

  const [passkeysResult, totpFactors, deviceState] = await Promise.all([
    (serviceRole as any)
      .from("passkeyCredential")
      .select("id, credentialName, createdAt, lastUsedAt, backedUp")
      .eq("userId", sessionUserId)
      .order("createdAt", { ascending: false }),
    getTotpFactors(sessionUserId),
    getDevices(request, sessionUserId)
  ]);

  return {
    passkeys: (passkeysResult.data ?? []) as Passkey[],
    totpFactors: totpFactors.filter((f) => f.status === "verified"),
    devices: deviceState.devices,
    // "Sign out other devices" ends EVERY other session at once, so it needs
    // to outrank all of them — one session it cannot touch refuses the lot.
    canRevokeAll:
      deviceState.deviceFirstSeenAt !== null &&
      deviceState.devices
        .filter((device) => !device.isCurrent)
        .every((device) => device.canRevoke)
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { sessionUserId } = await requirePermissions(request, {});
  const formData = await request.formData();

  if (formData.get("intent") === "deletePasskey") {
    const credentialId = formData.get("credentialId") as string;
    if (!credentialId) {
      return data(error(null, "Missing credentialId"), { status: 400 });
    }

    const serviceRole = getCarbonServiceRole();
    const { error: dbError } = await (serviceRole as any)
      .from("passkeyCredential")
      .delete()
      .eq("id", credentialId)
      .eq("userId", sessionUserId);

    if (dbError) {
      return data(
        error(dbError, "Failed to delete passkey"),
        await flash(request, error(dbError, "Failed to delete passkey"))
      );
    }

    return data(success("Passkey removed"));
  }

  if (formData.get("intent") === "renamePasskey") {
    const credentialId = formData.get("credentialId") as string;
    const credentialName = (formData.get("credentialName") as string)?.trim();
    if (!credentialId || !credentialName) {
      return data(error(null, "Missing fields"), { status: 400 });
    }
    if (credentialName.length > 100) {
      return data(error(null, "Passkey name must be 100 characters or fewer"), {
        status: 400
      });
    }

    const serviceRole = getCarbonServiceRole();
    const { error: dbError } = await (serviceRole as any)
      .from("passkeyCredential")
      .update({ credentialName })
      .eq("id", credentialId)
      .eq("userId", sessionUserId);

    if (dbError) {
      return data(
        error(dbError, "Failed to rename passkey"),
        await flash(request, error(dbError, "Failed to rename passkey"))
      );
    }

    return data(success("Passkey renamed"));
  }

  if (formData.get("intent") === "revokeSession") {
    const sessionId = formData.get("sessionId") as string;
    if (!sessionId) {
      return data(error(null, "Missing sessionId"), { status: 400 });
    }

    // Refuse the caller's own session even if posted directly — ending the
    // session you are on is logout, not revocation. When the current session
    // id cannot be derived we refuse outright rather than compare against
    // null: every id would differ from null, so the guard would pass for the
    // caller's own session — the exact case it exists to prevent.
    const authSession = await getAuthSession(request);
    const currentSessionId = authSession
      ? getSessionId(authSession.accessToken)
      : null;
    if (!currentSessionId || sessionId === currentSessionId) {
      return data(error(null, "Use log out to end your current session"), {
        status: 400
      });
    }

    // The device gate, enforced here and not only in the UI — a hidden button
    // stops nobody. The caller's device must predate the session it is ending.
    const { devices } = await getDevices(request, sessionUserId);
    const target = devices.find((device) => device.sessionId === sessionId);
    if (!target?.canRevoke) {
      return data(
        error(null, "Sign out from a device you've used for longer"),
        { status: 403 }
      );
    }

    const revoked = await revokeSession(
      getDatabaseClient(),
      sessionUserId,
      sessionId
    );
    return data(
      success(
        revoked > 0 ? "Device signed out" : "That session had already ended"
      )
    );
  }

  if (formData.get("intent") === "revokeOtherSessions") {
    const authSession = await getAuthSession(request);
    if (!authSession?.accessToken) {
      return data(error(null, "No active session"), { status: 400 });
    }

    // All-or-nothing: this ends EVERY other session, so the caller's device
    // must outrank all of them. One session it cannot touch refuses the lot,
    // rather than partially applying.
    const { devices } = await getDevices(request, sessionUserId);
    const others = devices.filter((device) => !device.isCurrent);
    if (!others.every((device) => device.canRevoke)) {
      return data(
        error(null, "Sign out from a device you've used for longer"),
        { status: 403 }
      );
    }

    const serviceRole = getCarbonServiceRole();
    const { error: signOutError } = await serviceRole.auth.admin.signOut(
      authSession.accessToken,
      "others"
    );
    if (signOutError) {
      return data(
        error(signOutError, "Failed to sign out other devices"),
        await flash(
          request,
          error(signOutError, "Failed to sign out other devices")
        )
      );
    }

    return data(success("Signed out all other devices"));
  }

  return null;
}

export default function AccountSecurity() {
  const { t } = useLingui();
  const { passkeys, totpFactors, devices, canRevokeAll } =
    useLoaderData<typeof loader>();
  const deleteFetcher = useFetcher();
  const renameFetcher = useFetcher();
  const { revalidate } = useRevalidator();
  const passkeysEnabled = isAuthProviderEnabled("passkey");
  const [registering, setRegistering] = useState(false);
  const [selectedPasskey, setSelectedPasskey] = useState<Passkey | null>(null);
  const [editedName, setEditedName] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const {
    enrollment: mfaEnrollment,
    starting: mfaStarting,
    verifying: mfaVerifying,
    error: mfaError,
    code: mfaCode,
    setCode: setMfaCode,
    start: onStartMfaEnrollment,
    verify: onVerifyMfaEnrollment,
    reset: resetMfaEnrollment
  } = useTotpEnrollment({
    enrollAction: path.to.mfaEnroll,
    verifyAction: path.to.mfaVerify,
    onVerified: () => {
      toast.success(t`Two-factor authentication enabled`);
      resetMfaEnrollment();
      revalidate();
    }
  });

  const { isGated } = usePlanGate({ feature: "TWO_FACTOR" });
  const mfaGated = isGated && !CONTROLLED_ENVIRONMENT;
  const [showUpgrade, setShowUpgrade] = useState(false);

  const [removeFactor, setRemoveFactor] = useState<TotpFactor | null>(null);
  const [removeCode, setRemoveCode] = useState("");
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const onRemoveMfaFactor = async () => {
    if (!removeFactor) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      const res = await fetch(path.to.mfaUnenroll, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ factorId: removeFactor.id, code: removeCode })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? INVALID_CODE_MESSAGE);
      }
      toast.success(t`Two-factor authentication disabled`);
      setRemoveFactor(null);
      setRemoveCode("");
      revalidate();
    } catch (e: any) {
      setRemoveError((e as Error).message ?? INVALID_CODE_MESSAGE);
      setRemoveCode("");
    } finally {
      setRemoving(false);
    }
  };

  const onAddPasskey = async () => {
    if (!passkeysEnabled) {
      toast.error(t`Passkeys are disabled`);
      return;
    }
    setRegistering(true);
    try {
      const optRes = await fetch("/api/passkey/register/options", {
        method: "POST"
      });

      if (!optRes.ok) throw new Error(t`Failed to get options`);
      const options = await optRes.json();

      const credential = await startRegistration({
        optionsJSON: options
      } as any);

      const verifyRes = await fetch("/api/passkey/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credential)
      });

      if (!verifyRes.ok) {
        const body = await verifyRes.json().catch(() => ({}));
        throw new Error(body.message ?? t`Registration failed`);
      }

      const result = await verifyRes.json();
      toast.success(t`${result.credentialName ?? "Passkey"} registered`);
      revalidate();
    } catch (e: any) {
      if (e?.name !== "NotAllowedError" && e?.name !== "AbortError") {
        toast.error(e.message ?? t`Failed to register passkey`);
      }
    } finally {
      setRegistering(false);
    }
  };

  const openPasskeyDrawer = (pk: Passkey) => {
    setSelectedPasskey(pk);
    setEditedName(pk.credentialName);
  };

  const closePasskeyDrawer = () => {
    setSelectedPasskey(null);
    setEditedName("");
  };

  const onRenamePasskey = () => {
    if (!selectedPasskey) return;
    const formData = new FormData();
    formData.append("intent", "renamePasskey");
    formData.append("credentialId", selectedPasskey.id);
    formData.append("credentialName", editedName);
    renameFetcher.submit(formData, { method: "post" });
    closePasskeyDrawer();
    revalidate();
  };

  const onConfirmDelete = () => {
    if (!confirmDeleteId) return;
    const formData = new FormData();
    formData.append("intent", "deletePasskey");
    formData.append("credentialId", confirmDeleteId);
    deleteFetcher.submit(formData, { method: "post" });
    setConfirmDeleteId(null);
    closePasskeyDrawer();
  };

  const revokeFetcher = useFetcher();
  const [confirmRevoke, setConfirmRevoke] = useState<
    (typeof devices)[number] | null
  >(null);
  const [confirmRevokeAll, setConfirmRevokeAll] = useState(false);
  const hasOtherDevices =
    canRevokeAll && devices.some((device) => !device.isCurrent);

  const describeDevice = (device: (typeof devices)[number]) => {
    const { browser, os } = parseUserAgent(device.userAgent);
    const title =
      browser && os
        ? t`${browser} on ${os}`
        : (browser ?? os ?? t`Unknown device`);
    const location = [device.city, device.country].filter(Boolean).join(", ");
    return location ? `${title} · ${location}` : title;
  };

  const onConfirmRevoke = () => {
    if (!confirmRevoke?.sessionId) return;
    const formData = new FormData();
    formData.append("intent", "revokeSession");
    formData.append("sessionId", confirmRevoke.sessionId);
    revokeFetcher.submit(formData, { method: "post" });
    setConfirmRevoke(null);
  };

  const onConfirmRevokeAll = () => {
    const formData = new FormData();
    formData.append("intent", "revokeOtherSessions");
    revokeFetcher.submit(formData, { method: "post" });
    setConfirmRevokeAll(false);
  };

  return (
    <VStack spacing={4} className="pb-6">
      {passkeysEnabled && (
        <Card>
          <CardHeader>
            <HStack className="justify-between">
              <div>
                <CardTitle>
                  <Trans>Passkeys</Trans>
                </CardTitle>
                <CardDescription>
                  <Trans>
                    Sign in with biometrics instead of a magic link. Passkeys
                    are secured by Face ID, Touch ID, or your device PIN.
                  </Trans>
                </CardDescription>
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={onAddPasskey}
                isDisabled={registering}
                isLoading={registering}
                leftIcon={<LuFingerprint className="size-4" />}
              >
                <Trans>Add Passkey</Trans>
              </Button>
            </HStack>
          </CardHeader>
          <CardContent>
            {passkeys.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                <Trans>No passkeys registered yet.</Trans>
              </p>
            ) : (
              <VStack spacing={2}>
                {passkeys.map((pk) => (
                  <HStack
                    key={pk.id}
                    spacing={4}
                    className="w-full justify-between p-3 rounded-lg border border-border cursor-pointer transition-colors hover:bg-muted/40"
                    onClick={() => openPasskeyDrawer(pk)}
                  >
                    <HStack spacing={3} className="min-w-0">
                      <span className="flex items-center justify-center size-9 rounded-lg bg-muted shrink-0">
                        <LuFingerprint className="size-4 text-muted-foreground" />
                      </span>
                      <VStack spacing={0} className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {pk.credentialName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          <Trans>Added</Trans>{" "}
                          <DateTime value={pk.createdAt} variant="date" />
                          {pk.lastUsedAt && (
                            <>
                              {" · "}
                              <Trans>Last used</Trans>{" "}
                              <DateTime value={pk.lastUsedAt} variant="date" />
                            </>
                          )}
                          {pk.backedUp && (
                            <>
                              {" · "}
                              <Trans>Synced</Trans>
                            </>
                          )}
                        </p>
                      </VStack>
                    </HStack>

                    <IconButton
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDeleteId(pk.id);
                      }}
                      aria-label={t`Delete passkey`}
                      type="button"
                      variant="ghost"
                      icon={<LuTrash2 />}
                      className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
                    />
                  </HStack>
                ))}
              </VStack>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <HStack className="justify-between">
            <div>
              <CardTitle>
                <Trans>Two-factor authentication</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  Require a 6-digit code from an authenticator app when signing
                  in.
                </Trans>
              </CardDescription>
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                if (mfaGated) {
                  setShowUpgrade(true);
                  return;
                }
                onStartMfaEnrollment();
              }}
              isDisabled={mfaStarting}
              isLoading={mfaStarting}
              leftIcon={<LuShieldCheck className="size-4" />}
            >
              <Trans>Add Authenticator App</Trans>
            </Button>
          </HStack>
        </CardHeader>
        <CardContent>
          {totpFactors.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              <Trans>Two-factor authentication is not enabled.</Trans>
            </p>
          ) : (
            <VStack spacing={2}>
              {totpFactors.map((factor) => (
                <HStack
                  key={factor.id}
                  spacing={4}
                  className="w-full justify-between p-3 rounded-lg border border-border"
                >
                  <HStack spacing={3} className="min-w-0">
                    <span className="flex items-center justify-center size-9 rounded-lg bg-muted shrink-0">
                      <LuShieldCheck className="size-4 text-muted-foreground" />
                    </span>
                    <VStack spacing={0} className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {factor.friendlyName ?? t`Authenticator app`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        <Trans>Added</Trans>{" "}
                        <DateTime value={factor.createdAt} variant="date" />
                      </p>
                    </VStack>
                  </HStack>

                  <IconButton
                    onClick={() => {
                      setRemoveCode("");
                      setRemoveFactor(factor);
                    }}
                    aria-label={t`Remove authenticator app`}
                    type="button"
                    variant="ghost"
                    icon={<LuTrash2 />}
                    className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
                  />
                </HStack>
              ))}
            </VStack>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <HStack className="justify-between">
            <div>
              <CardTitle>
                <Trans>Your devices</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  Where you're signed in. Sign out of any device you don't
                  recognize — from a device you've used for longer than that
                  session.
                </Trans>
              </CardDescription>
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setConfirmRevokeAll(true)}
              isDisabled={!hasOtherDevices}
              leftIcon={<LuLogOut className="size-4" />}
            >
              <Trans>Sign out other devices</Trans>
            </Button>
          </HStack>
        </CardHeader>
        <CardContent>
          {devices.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              <Trans>No signed-in devices found.</Trans>
            </p>
          ) : (
            <VStack spacing={2}>
              {devices.map((device) => {
                const { browser, os } = parseUserAgent(device.userAgent);
                const title =
                  browser && os
                    ? t`${browser} on ${os}`
                    : (browser ?? os ?? t`Unknown device`);
                // Normalize at display too, so sessions recorded before
                // normalization ("::ffff:127.0.0.1") still render cleanly.
                const ipAddress = normalizeIp(device.ipAddress);
                const location =
                  [device.city, device.country].filter(Boolean).join(", ") ||
                  (isPrivateIp(ipAddress)
                    ? t`Local network`
                    : t`Unknown location`);
                const DeviceIcon =
                  os === "iOS" || os === "Android" ? LuSmartphone : LuMonitor;
                return (
                  <HStack
                    key={device.sessionId}
                    spacing={4}
                    className="w-full justify-between p-3 rounded-lg border border-border"
                  >
                    <HStack spacing={3} className="min-w-0">
                      <span className="flex items-center justify-center size-9 rounded-lg bg-muted shrink-0">
                        <DeviceIcon className="size-4 text-muted-foreground" />
                      </span>
                      <VStack spacing={0} className="min-w-0">
                        <p className="text-sm font-medium truncate">{title}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {location}
                          {ipAddress && (
                            <>
                              {" · "}
                              {ipAddress}
                            </>
                          )}
                          {" · "}
                          <Trans>Last active</Trans>{" "}
                          <DateTime
                            value={device.lastActiveAt}
                            variant="relative"
                          />
                        </p>
                      </VStack>
                    </HStack>
                    <HStack spacing={3} className="shrink-0">
                      {device.app && (
                        <Badge variant="secondary" className="uppercase">
                          {device.app}
                        </Badge>
                      )}
                      {device.isCurrent ? (
                        <Badge variant="green">
                          <Trans>This device</Trans>
                        </Badge>
                      ) : device.canRevoke ? (
                        <IconButton
                          onClick={() => setConfirmRevoke(device)}
                          aria-label={t`Sign out device`}
                          type="button"
                          variant="ghost"
                          icon={<LuLogOut />}
                          className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          <Trans>Newer device</Trans>
                        </span>
                      )}
                    </HStack>
                  </HStack>
                );
              })}
            </VStack>
          )}
        </CardContent>
      </Card>

      <TwoFactorUpgradeDialog
        open={showUpgrade}
        onOpenChange={setShowUpgrade}
      />

      <Modal
        open={!!mfaEnrollment}
        onOpenChange={(open) => {
          if (!open) resetMfaEnrollment();
        }}
      >
        <ModalContent size="small">
          <ModalHeader>
            <ModalTitle>
              <Trans>Set up two-factor authentication</Trans>
            </ModalTitle>
          </ModalHeader>
          <ModalBody>
            {mfaEnrollment && (
              <VStack spacing={4} className="w-full items-center">
                <p className="text-sm text-muted-foreground">
                  <Trans>
                    Scan this QR code with your authenticator app (e.g. Google
                    Authenticator or 1Password), then enter the 6-digit code it
                    shows.
                  </Trans>
                </p>
                <img
                  src={mfaEnrollment.qrCode}
                  alt={t`Authenticator QR code`}
                  className="size-44 rounded-md bg-white p-2"
                />
                <VStack spacing={1} className="w-full items-center">
                  <p className="text-xs text-muted-foreground">
                    <Trans>Or enter this secret manually:</Trans>
                  </p>
                  <button
                    type="button"
                    className="font-mono text-xs break-all text-center cursor-pointer hover:text-foreground text-muted-foreground"
                    onClick={() => {
                      navigator.clipboard.writeText(mfaEnrollment.secret);
                      toast.success(t`Secret copied to clipboard`);
                    }}
                  >
                    {mfaEnrollment.secret}
                  </button>
                </VStack>
                <OtpInput value={mfaCode} onChange={setMfaCode} />
                {mfaError && (
                  <Alert variant="destructive">
                    <LuCircleAlert className="w-4 h-4" />
                    <AlertTitle>
                      <Trans>Verification failed</Trans>
                    </AlertTitle>
                    <AlertDescription>{mfaError}</AlertDescription>
                  </Alert>
                )}
              </VStack>
            )}
          </ModalBody>
          <ModalFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={resetMfaEnrollment}
            >
              <Trans>Cancel</Trans>
            </Button>
            <Button
              type="button"
              onClick={onVerifyMfaEnrollment}
              isDisabled={mfaCode.length !== 6 || mfaVerifying}
              isLoading={mfaVerifying}
            >
              <Trans>Verify</Trans>
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal
        open={!!removeFactor}
        onOpenChange={(open) => {
          if (!open) {
            setRemoveFactor(null);
            setRemoveCode("");
          }
        }}
      >
        <ModalContent size="small">
          <ModalHeader>
            <ModalTitle>
              <Trans>Remove two-factor authentication</Trans>
            </ModalTitle>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4} className="w-full">
              <p className="text-sm text-muted-foreground">
                <Trans>
                  Signing in will no longer require a code. Enter the current
                  6-digit code from your authenticator app to confirm.
                </Trans>
              </p>
              <OtpInput
                value={removeCode}
                onChange={(value) => {
                  setRemoveCode(value);
                  if (removeError) setRemoveError(null);
                }}
              />
              {removeError && (
                <Alert variant="destructive">
                  <LuCircleAlert className="w-4 h-4" />
                  <AlertTitle>
                    <Trans>Verification failed</Trans>
                  </AlertTitle>
                  <AlertDescription>{removeError}</AlertDescription>
                </Alert>
              )}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setRemoveFactor(null);
                setRemoveCode("");
              }}
            >
              <Trans>Cancel</Trans>
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={onRemoveMfaFactor}
              isDisabled={removeCode.length !== 6 || removing}
              isLoading={removing}
            >
              <Trans>Remove</Trans>
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal
        open={!!selectedPasskey}
        onOpenChange={(open) => {
          if (!open) closePasskeyDrawer();
        }}
      >
        <ModalContent size="small">
          <ModalHeader>
            <ModalTitle>
              <Trans>Edit Passkey</Trans>
            </ModalTitle>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4} className="w-full">
              <VStack className="w-full" spacing={0}>
                <label className="text-sm font-medium mb-1 block">
                  <Trans>Name</Trans>
                </label>
                <Input
                  value={editedName}
                  onChange={(e) => setEditedName(e.target.value)}
                  placeholder={t`Passkey name`}
                />
              </VStack>
              {selectedPasskey && (
                <VStack spacing={1} className="w-full">
                  <p className="text-xs text-muted-foreground">
                    <Trans>Added</Trans>{" "}
                    <DateTime
                      value={selectedPasskey.createdAt}
                      variant="date"
                    />
                  </p>
                  {selectedPasskey.lastUsedAt && (
                    <p className="text-xs text-muted-foreground">
                      <Trans>Last used</Trans>{" "}
                      <DateTime
                        value={selectedPasskey.lastUsedAt}
                        variant="date"
                      />
                    </p>
                  )}
                  {selectedPasskey.backedUp && (
                    <p className="text-xs text-muted-foreground">
                      <Trans>Synced</Trans>
                    </p>
                  )}
                </VStack>
              )}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={closePasskeyDrawer}
            >
              <Trans>Cancel</Trans>
            </Button>
            <Button
              type="button"
              onClick={onRenamePasskey}
              isDisabled={
                !editedName.trim() ||
                editedName === selectedPasskey?.credentialName
              }
            >
              <Trans>Save</Trans>
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal
        open={!!confirmRevoke}
        onOpenChange={(open) => {
          if (!open) setConfirmRevoke(null);
        }}
      >
        <ModalContent size="small">
          <ModalHeader>
            <ModalTitle>
              <Trans>Sign out device</Trans>
            </ModalTitle>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={2} className="w-full">
              {confirmRevoke && (
                <p className="text-sm font-medium">
                  {describeDevice(confirmRevoke)}
                </p>
              )}
              <p className="text-sm text-muted-foreground">
                <Trans>
                  This ends that device's session — it can no longer stay signed
                  in and is returned to the login page within a minute of its
                  next page load.
                </Trans>
              </p>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setConfirmRevoke(null)}
            >
              <Trans>Cancel</Trans>
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={onConfirmRevoke}
              isLoading={revokeFetcher.state !== "idle"}
              isDisabled={revokeFetcher.state !== "idle"}
            >
              <Trans>Sign out</Trans>
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal
        open={confirmRevokeAll}
        onOpenChange={(open) => {
          if (!open) setConfirmRevokeAll(false);
        }}
      >
        <ModalContent size="small">
          <ModalHeader>
            <ModalTitle>
              <Trans>Sign out all other devices</Trans>
            </ModalTitle>
          </ModalHeader>
          <ModalBody>
            <Trans>
              Every session except the one you are using now will be signed out.
              Other devices are returned to the login page within a minute of
              their next page load.
            </Trans>
          </ModalBody>
          <ModalFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setConfirmRevokeAll(false)}
            >
              <Trans>Cancel</Trans>
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={onConfirmRevokeAll}
              isLoading={revokeFetcher.state !== "idle"}
              isDisabled={revokeFetcher.state !== "idle"}
            >
              <Trans>Sign out other devices</Trans>
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal
        open={!!confirmDeleteId}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteId(null);
        }}
      >
        <ModalContent size="small">
          <ModalHeader>
            <ModalTitle>
              <Trans>Delete Passkey</Trans>
            </ModalTitle>
          </ModalHeader>
          <ModalBody>
            <Trans>
              Are you sure you want to delete this passkey? You won't be able to
              use it to sign in anymore.
            </Trans>
          </ModalBody>
          <ModalFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setConfirmDeleteId(null)}
            >
              <Trans>Cancel</Trans>
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={onConfirmDelete}
              isLoading={deleteFetcher.state !== "idle"}
              isDisabled={deleteFetcher.state !== "idle"}
            >
              <Trans>Delete</Trans>
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </VStack>
  );
}
