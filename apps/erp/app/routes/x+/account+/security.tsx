import {
  assertIsPost,
  error,
  isAuthProviderEnabled,
  success
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { TotpFactor } from "@carbon/auth/mfa.server";
import { getTotpFactors } from "@carbon/auth/mfa.server";
import { flash } from "@carbon/auth/session.server";
import {
  Alert,
  AlertDescription,
  AlertTitle,
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
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { startRegistration } from "@simplewebauthn/browser";
import { useState } from "react";
import {
  LuCircleAlert,
  LuFingerprint,
  LuShieldCheck,
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

export async function loader({ request }: LoaderFunctionArgs) {
  const { userId } = await requirePermissions(request, {});
  const serviceRole = getCarbonServiceRole();
  const [passkeysResult, totpFactors] = await Promise.all([
    (serviceRole as any)
      .from("passkeyCredential")
      .select("id, credentialName, createdAt, lastUsedAt, backedUp")
      .eq("userId", userId)
      .order("createdAt", { ascending: false }),
    getTotpFactors(userId)
  ]);

  return {
    passkeys: (passkeysResult.data ?? []) as Passkey[],
    totpFactors: totpFactors.filter((f) => f.status === "verified")
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId } = await requirePermissions(request, {});
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
      .eq("userId", userId);

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
      .eq("userId", userId);

    if (dbError) {
      return data(
        error(dbError, "Failed to rename passkey"),
        await flash(request, error(dbError, "Failed to rename passkey"))
      );
    }

    return data(success("Passkey renamed"));
  }

  return null;
}

export default function AccountSecurity() {
  const { t } = useLingui();
  const { passkeys, totpFactors } = useLoaderData<typeof loader>();
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
              onClick={onStartMfaEnrollment}
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
