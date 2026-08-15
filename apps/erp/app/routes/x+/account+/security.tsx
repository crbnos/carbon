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
      toast.success("Two-factor authentication enabled");
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
      toast.success("Two-factor authentication disabled");
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
      toast.error("Passkeys are disabled");
      return;
    }
    setRegistering(true);
    try {
      const optRes = await fetch("/api/passkey/register/options", {
        method: "POST"
      });

      if (!optRes.ok) throw new Error("Failed to get options");
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
        throw new Error(body.message ?? "Registration failed");
      }

      const result = await verifyRes.json();
      toast.success(`${result.credentialName ?? "Passkey"} registered`);
      revalidate();
    } catch (e: any) {
      if (e?.name !== "NotAllowedError" && e?.name !== "AbortError") {
        toast.error(e.message ?? "Failed to register passkey");
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
                <CardTitle>Passkeys</CardTitle>
                <CardDescription>
                  Sign in with biometrics instead of a magic link. Passkeys are
                  secured by Face ID, Touch ID, or your device PIN.
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
                Add Passkey
              </Button>
            </HStack>
          </CardHeader>
          <CardContent>
            {passkeys.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No passkeys registered yet.
              </p>
            ) : (
              <HStack spacing={2}>
                {passkeys.map((pk) => (
                  <HStack
                    key={pk.id}
                    className="justify-between p-3 rounded-md border border-border space-x-4 cursor-pointer hover:bg-muted/40 transition-colors"
                    onClick={() => openPasskeyDrawer(pk)}
                  >
                    <HStack spacing={3} className="items-start">
                      <LuFingerprint className="size-4 text-muted-foreground shrink-0 mt-1" />
                      <VStack spacing={0}>
                        <p className="text-sm font-medium">
                          {pk.credentialName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Added <DateTime value={pk.createdAt} variant="date" />
                          {pk.lastUsedAt && (
                            <>
                              {" · "}Last used{" "}
                              <DateTime value={pk.lastUsedAt} variant="date" />
                            </>
                          )}
                          {pk.backedUp && " · Synced"}
                        </p>
                      </VStack>
                    </HStack>

                    <IconButton
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDeleteId(pk.id);
                      }}
                      aria-label="Delete passkey"
                      type="button"
                      variant="ghost"
                      icon={<LuTrash2 />}
                      className="cursor-pointer"
                    />
                  </HStack>
                ))}
              </HStack>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <HStack className="justify-between">
            <div>
              <CardTitle>Two-factor authentication</CardTitle>
              <CardDescription>
                Require a 6-digit code from an authenticator app when signing
                in.
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
              Add Authenticator App
            </Button>
          </HStack>
        </CardHeader>
        <CardContent>
          {totpFactors.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Two-factor authentication is not enabled.
            </p>
          ) : (
            <HStack spacing={2}>
              {totpFactors.map((factor) => (
                <HStack
                  key={factor.id}
                  className="justify-between p-3 rounded-md border border-border space-x-4"
                >
                  <HStack spacing={3} className="items-start">
                    <LuShieldCheck className="size-4 text-muted-foreground shrink-0 mt-1" />
                    <VStack spacing={0}>
                      <p className="text-sm font-medium">
                        {factor.friendlyName ?? "Authenticator app"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Added{" "}
                        <DateTime value={factor.createdAt} variant="date" />
                      </p>
                    </VStack>
                  </HStack>

                  <IconButton
                    onClick={() => {
                      setRemoveCode("");
                      setRemoveFactor(factor);
                    }}
                    aria-label="Remove authenticator app"
                    type="button"
                    variant="ghost"
                    icon={<LuTrash2 />}
                    className="cursor-pointer"
                  />
                </HStack>
              ))}
            </HStack>
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
            <ModalTitle>Set up two-factor authentication</ModalTitle>
          </ModalHeader>
          <ModalBody>
            {mfaEnrollment && (
              <VStack spacing={4} className="w-full items-center">
                <p className="text-sm text-muted-foreground">
                  Scan this QR code with your authenticator app (e.g. Google
                  Authenticator or 1Password), then enter the 6-digit code it
                  shows.
                </p>
                <img
                  src={mfaEnrollment.qrCode}
                  alt="Authenticator QR code"
                  className="size-44 rounded-md bg-white p-2"
                />
                <VStack spacing={1} className="w-full items-center">
                  <p className="text-xs text-muted-foreground">
                    Or enter this secret manually:
                  </p>
                  <button
                    type="button"
                    className="font-mono text-xs break-all text-center cursor-pointer hover:text-foreground text-muted-foreground"
                    onClick={() => {
                      navigator.clipboard.writeText(mfaEnrollment.secret);
                      toast.success("Secret copied to clipboard");
                    }}
                  >
                    {mfaEnrollment.secret}
                  </button>
                </VStack>
                <OtpInput value={mfaCode} onChange={setMfaCode} />
                {mfaError && (
                  <Alert variant="destructive">
                    <LuCircleAlert className="w-4 h-4" />
                    <AlertTitle>Verification failed</AlertTitle>
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
              Cancel
            </Button>
            <Button
              type="button"
              onClick={onVerifyMfaEnrollment}
              isDisabled={mfaCode.length !== 6 || mfaVerifying}
              isLoading={mfaVerifying}
            >
              Verify
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
            <ModalTitle>Remove two-factor authentication</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4} className="w-full">
              <p className="text-sm text-muted-foreground">
                Signing in will no longer require a code. Enter the current
                6-digit code from your authenticator app to confirm.
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
                  <AlertTitle>Verification failed</AlertTitle>
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
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={onRemoveMfaFactor}
              isDisabled={removeCode.length !== 6 || removing}
              isLoading={removing}
            >
              Remove
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
            <ModalTitle>Edit Passkey</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4} className="w-full">
              <VStack className="w-full" spacing={0}>
                <label className="text-sm font-medium mb-1 block">Name</label>
                <Input
                  value={editedName}
                  onChange={(e) => setEditedName(e.target.value)}
                  placeholder="Passkey name"
                />
              </VStack>
              {selectedPasskey && (
                <VStack spacing={1} className="w-full">
                  <p className="text-xs text-muted-foreground">
                    Added{" "}
                    <DateTime
                      value={selectedPasskey.createdAt}
                      variant="date"
                    />
                  </p>
                  {selectedPasskey.lastUsedAt && (
                    <p className="text-xs text-muted-foreground">
                      Last used{" "}
                      <DateTime
                        value={selectedPasskey.lastUsedAt}
                        variant="date"
                      />
                    </p>
                  )}
                  {selectedPasskey.backedUp && (
                    <p className="text-xs text-muted-foreground">Synced</p>
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
              Cancel
            </Button>
            <Button
              type="button"
              onClick={onRenamePasskey}
              isDisabled={
                !editedName.trim() ||
                editedName === selectedPasskey?.credentialName
              }
            >
              Save
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
            <ModalTitle>Delete Passkey</ModalTitle>
          </ModalHeader>
          <ModalBody>
            Are you sure you want to delete this passkey? You won't be able to
            use it to sign in anymore.
          </ModalBody>
          <ModalFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setConfirmDeleteId(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={onConfirmDelete}
              isLoading={deleteFetcher.state !== "idle"}
              isDisabled={deleteFetcher.state !== "idle"}
            >
              Delete
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </VStack>
  );
}
