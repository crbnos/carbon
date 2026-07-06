import {
  assertIsPost,
  error,
  isAuthProviderEnabled,
  success
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import {
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
import { LuFingerprint, LuTrash2 } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  redirect,
  useFetcher,
  useLoaderData,
  useRevalidator
} from "react-router";
import {
  accountProfileValidator,
  getAccount,
  updateAvatar,
  updatePublicAccount
} from "~/modules/account";
import { ProfileForm } from "~/modules/account/ui/Profile";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Profile`,
  to: path.to.profile
};

type Passkey = {
  id: string;
  credentialName: string;
  createdAt: string;
  lastUsedAt: string | null;
  backedUp: boolean;
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, userId } = await requirePermissions(request, {});
  const serviceRole = getCarbonServiceRole();
  const [user, passkeysResult] = await Promise.all([
    getAccount(client, userId),
    (serviceRole as any)
      .from("passkeyCredential")
      .select("id, credentialName, createdAt, lastUsedAt, backedUp")
      .eq("userId", userId)
      .order("createdAt", { ascending: false })
  ]);

  if (user.error || !user.data) {
    throw redirect(
      path.to.authenticatedRoot,
      await flash(request, error(user.error, "Failed to get user"))
    );
  }

  return {
    user: user.data,
    passkeys: (passkeysResult.data ?? []) as Passkey[]
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {});
  const formData = await request.formData();

  if (formData.get("intent") === "about") {
    const validation = await validator(accountProfileValidator).validate(
      formData
    );

    if (validation.error) {
      return validationError(validation.error);
    }

    const { firstName, lastName, about, phone } = validation.data;

    const updateAccount = await updatePublicAccount(client, {
      id: userId,
      firstName,
      lastName,
      about,
      phone
    });
    if (updateAccount.error)
      return data(
        {},
        await flash(
          request,
          error(updateAccount.error, "Failed to update profile")
        )
      );

    return data({}, await flash(request, success("Updated profile")));
  }

  if (formData.get("intent") === "photo") {
    const photoPath = formData.get("path");
    if (photoPath === null || typeof photoPath === "string") {
      const avatarUpdate = await updateAvatar(client, userId, photoPath);
      if (avatarUpdate.error) {
        throw redirect(
          path.to.profile,
          await flash(
            request,
            error(avatarUpdate.error, "Failed to update avatar")
          )
        );
      }

      throw redirect(
        path.to.profile,
        await flash(
          request,
          success(photoPath === null ? "Removed avatar" : "Updated avatar")
        )
      );
    } else {
      throw redirect(
        path.to.profile,
        await flash(request, error(null, "Invalid avatar path"))
      );
    }
  }

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

export default function AccountProfile() {
  const { user, passkeys } = useLoaderData<typeof loader>();
  const deleteFetcher = useFetcher();
  const renameFetcher = useFetcher();
  const { revalidate } = useRevalidator();
  const passkeysEnabled = isAuthProviderEnabled("passkey");
  const [registering, setRegistering] = useState(false);
  const [selectedPasskey, setSelectedPasskey] = useState<Passkey | null>(null);
  const [editedName, setEditedName] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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
      <ProfileForm user={user} />

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
                          Added{" "}
                          {new Date(pk.createdAt).toLocaleDateString(
                            undefined,
                            {
                              year: "numeric",
                              month: "short",
                              day: "numeric"
                            }
                          )}
                          {pk.lastUsedAt && (
                            <>
                              {" · "}Last used{" "}
                              {new Date(pk.lastUsedAt).toLocaleDateString(
                                undefined,
                                {
                                  year: "numeric",
                                  month: "short",
                                  day: "numeric"
                                }
                              )}
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
                    {new Date(selectedPasskey.createdAt).toLocaleDateString(
                      undefined,
                      { year: "numeric", month: "long", day: "numeric" }
                    )}
                  </p>
                  {selectedPasskey.lastUsedAt && (
                    <p className="text-xs text-muted-foreground">
                      Last used{" "}
                      {new Date(selectedPasskey.lastUsedAt).toLocaleDateString(
                        undefined,
                        { year: "numeric", month: "long", day: "numeric" }
                      )}
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
