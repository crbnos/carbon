import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuTriangleAlert } from "react-icons/lu";
import type { FetcherWithComponents } from "react-router";
import { useDateFormatter } from "~/hooks";
import { isApiKeyExpired } from "~/modules/settings";

type RegenerateApiKeyModalProps = {
  action: string;
  name: string;
  lastUsedAt?: string | null;
  expiresAt?: string | null;
  // Owned by the caller so it can read the new key out of the response — the
  // key comes back from this submission and is never retrievable again.
  fetcher: FetcherWithComponents<{ key?: string }>;
  onCancel: () => void;
};

const RegenerateApiKeyModal = ({
  action,
  name,
  lastUsedAt,
  expiresAt,
  fetcher,
  onCancel
}: RegenerateApiKeyModalProps) => {
  const { formatTimeAgo } = useDateFormatter();
  // A new secret on an expired row is rejected on its first request, so the
  // action refuses it too — this just says so before the button is pressed.
  const isExpired = isApiKeyExpired(expiresAt);

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            <Trans>Regenerate {name}</Trans>
          </ModalTitle>
        </ModalHeader>

        <ModalBody>
          <VStack spacing={4}>
            {isExpired && (
              <Alert variant="destructive">
                <LuTriangleAlert className="w-4 h-4" />
                <AlertTitle>
                  <Trans>This key has expired</Trans>
                </AlertTitle>
                <AlertDescription>
                  <Trans>
                    A regenerated secret would be rejected as expired on its
                    first request. Extend or clear the expiration on the key
                    first, then regenerate.
                  </Trans>
                </AlertDescription>
              </Alert>
            )}
            <Alert variant="destructive">
              <LuTriangleAlert className="w-4 h-4" />
              <AlertTitle>
                <Trans>
                  The current key stops working the moment you confirm
                </Trans>
              </AlertTitle>
              <AlertDescription>
                <Trans>
                  Every integration still sending it will start failing until
                  you give it the new key. The new key is shown once.
                </Trans>
              </AlertDescription>
            </Alert>
            <p className="text-sm text-muted-foreground">
              {lastUsedAt ? (
                <Trans>
                  This key last authenticated a request{" "}
                  {formatTimeAgo(lastUsedAt)}. Its name, scopes and expiration
                  are unchanged — only the secret is replaced.
                </Trans>
              ) : (
                <Trans>
                  This key has never authenticated a request. Its name, scopes
                  and expiration are unchanged — only the secret is replaced.
                </Trans>
              )}
            </p>
          </VStack>
        </ModalBody>

        <ModalFooter>
          <Button variant="secondary" onClick={onCancel}>
            <Trans>Cancel</Trans>
          </Button>
          <fetcher.Form method="post" action={action}>
            <Button
              variant="destructive"
              isLoading={fetcher.state !== "idle"}
              isDisabled={isExpired || fetcher.state !== "idle"}
              type="submit"
            >
              <Trans>Regenerate Key</Trans>
            </Button>
          </fetcher.Form>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default RegenerateApiKeyModal;
