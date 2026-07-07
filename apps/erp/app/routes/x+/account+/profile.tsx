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
import { LuExternalLink, LuFingerprint, LuTrash2 } from "react-icons/lu";
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

  const handleConnectClaude = () => {
    window.open(
      "https://claude.ai/settings/connectors?action=add_custom&name=Carbon&url=https%3A%2F%2Fapp.carbon.ms%2Fapi%2Fmcp",
      "_blank",
      "noopener,noreferrer"
    );
  };

  return (
    <VStack spacing={4} className="pb-6">
      <ProfileForm user={user} />

      <Card>
        <CardHeader>
          <HStack className="justify-between">
            <HStack spacing={3}>
              <ClaudeLogo className="size-7 shrink-0" />
              <div>
                <CardTitle>Claude</CardTitle>
                <CardDescription>
                  Connect Carbon to Claude so you can use your data directly
                  from any conversation.
                </CardDescription>
              </div>
            </HStack>
            <Button
              type="button"
              variant="secondary"
              onClick={handleConnectClaude}
              leftIcon={<LuExternalLink className="size-4" />}
            >
              Connect
            </Button>
          </HStack>
        </CardHeader>
      </Card>

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

function ClaudeLogo(props: React.ComponentProps<"svg">) {
  return (
    <svg
      {...props}
      viewBox="0 0 46 46"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Anthropic's official Claude logomark */}
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M22.735 3.578c-1.91 0-3.674.447-5.178 1.222L5.75 17.557A11.137 11.137 0 0 0 4 23.002c0 2.07.566 3.997 1.55 5.637l.2.32 11.734 12.686a11.09 11.09 0 0 0 5.25 1.777l.001.001h.002l.215.004c.063.001.125.002.188.002h.003a10.984 10.984 0 0 0 5.178-1.222l11.807-12.757A11.138 11.138 0 0 0 42 23.003c0-2.07-.566-3.998-1.55-5.637l-.2-.32L28.516 4.36a11.09 11.09 0 0 0-5.25-1.778l-.001-.001h-.002l-.215-.003A5.77 5.77 0 0 0 22.86 2.5h-.003c-.042 0-.082.077-.122.078Zm0 1.5c.04 0 .08-.001.121-.001h.002c.062 0 .123.001.184.003l.205.003a9.59 9.59 0 0 1 4.544 1.537L39.097 19.05A9.635 9.635 0 0 1 40.5 23c0 1.793-.49 3.468-1.343 4.9L27.35 40.38a9.486 9.486 0 0 1-4.394 1.619l-.221.003a9.49 9.49 0 0 1-4.544-1.537L6.885 27.95A9.635 9.635 0 0 1 5.5 24c0-1.793.49-3.468 1.343-4.9L18.65 6.62A9.486 9.486 0 0 1 23.048 5h-.313ZM23 14a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 1.5a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15Z"
        fill="currentColor"
      />
    </svg>
  );
}
