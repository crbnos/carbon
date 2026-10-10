// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { CONTROLLED_ENVIRONMENT, isAuthProviderEnabled } from "@carbon/auth";
import { useLoaderQuery } from "@carbon/query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  DateTime,
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
import { Trans, useLingui } from "@lingui/react/macro";
import { startRegistration } from "@simplewebauthn/browser";
import { useState } from "react";
import {
  LuCircleAlert,
  LuFingerprint,
  LuShieldCheck,
  LuTrash2
} from "react-icons/lu";
import { useFetcher } from "react-router";
import type { AccountSecurityData, AccountTotpFactor, Passkey } from "../types";
import {
  AccountSettingsPane,
  AccountSettingsSection
} from "./AccountSettingsLayout";
import AccountSettingsSkeleton from "./AccountSettingsSkeleton";
import { useAccountEndpoints, useAccountSettingsConfig } from "./context";
import {
  INVALID_CODE_MESSAGE,
  OtpInput,
  useTotpEnrollment
} from "./TotpEnrollment";

export default function SecuritySettings() {
  const endpoints = useAccountEndpoints();
  const { data, refetch } = useLoaderQuery<AccountSecurityData>(
    endpoints.security
  );

  return (
    <AccountSettingsPane
      title={<Trans>Security</Trans>}
      description={<Trans>Manage how you sign in to Carbon.</Trans>}
    >
      {data ? (
        // Enrolling and removing a factor or a passkey go through plain
        // fetch() to their own API routes, which the cache's action
        // invalidation never sees.
        <SecuritySettingsForm {...data} reload={() => refetch()} />
      ) : (
        <AccountSettingsSkeleton />
      )}
    </AccountSettingsPane>
  );
}

function SecuritySettingsForm({
  passkeys,
  totpFactors,
  reload
}: AccountSecurityData & { reload: () => void }) {
  const { t } = useLingui();
  const endpoints = useAccountEndpoints();
  const { twoFactor } = useAccountSettingsConfig();
  const deleteFetcher = useFetcher();
  const renameFetcher = useFetcher();
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
    enrollAction: endpoints.mfaEnroll,
    verifyAction: endpoints.mfaVerify,
    onVerified: () => {
      toast.success(t`Two-factor authentication enabled`);
      resetMfaEnrollment();
      reload();
    }
  });

  const mfaGated = (twoFactor?.isGated ?? false) && !CONTROLLED_ENVIRONMENT;
  const [showUpgrade, setShowUpgrade] = useState(false);

  const [removeFactor, setRemoveFactor] = useState<AccountTotpFactor | null>(
    null
  );
  const [removeCode, setRemoveCode] = useState("");
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const onRemoveMfaFactor = async () => {
    if (!removeFactor) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      const res = await fetch(endpoints.mfaUnenroll, {
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
      reload();
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
      const optRes = await fetch(endpoints.passkeyRegisterOptions, {
        method: "POST"
      });

      if (!optRes.ok) throw new Error(t`Failed to get options`);
      const options = await optRes.json();

      const credential = await startRegistration({
        optionsJSON: options
      } as any);

      const verifyRes = await fetch(endpoints.passkeyRegisterVerify, {
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
      reload();
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
    renameFetcher.submit(formData, {
      method: "post",
      action: endpoints.security
    });
    closePasskeyDrawer();
  };

  const onConfirmDelete = () => {
    if (!confirmDeleteId) return;
    const formData = new FormData();
    formData.append("intent", "deletePasskey");
    formData.append("credentialId", confirmDeleteId);
    deleteFetcher.submit(formData, {
      method: "post",
      action: endpoints.security
    });
    setConfirmDeleteId(null);
    closePasskeyDrawer();
  };

  return (
    <>
      {passkeysEnabled && (
        <AccountSettingsSection
          title={<Trans>Passkeys</Trans>}
          description={
            <Trans>
              Sign in with biometrics instead of a magic link. Passkeys are
              secured by Face ID, Touch ID, or your device PIN.
            </Trans>
          }
          action={
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
          }
        >
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
                  className="w-full justify-between p-3 rounded-lg border border-border cursor-pointer transition-colors hover:bg-muted/40 max-md:border-0 max-md:p-0 max-md:rounded-none"
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
        </AccountSettingsSection>
      )}

      <AccountSettingsSection
        title={<Trans>Two-factor authentication</Trans>}
        description={
          <Trans>
            Require a 6-digit code from an authenticator app when signing in.
          </Trans>
        }
        action={
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
        }
      >
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
                className="w-full justify-between p-3 rounded-lg border border-border max-md:border-0 max-md:p-0 max-md:rounded-none"
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
      </AccountSettingsSection>

      {twoFactor?.renderUpgrade({
        open: showUpgrade,
        onOpenChange: setShowUpgrade
      })}

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
    </>
  );
}
