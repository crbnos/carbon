import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useEffect, useRef } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import { useFetcher, useNavigation, useParams } from "react-router";
import { path } from "~/utils/path";

const ReceiptVoidModal = ({ onClose }: { onClose: () => void }) => {
  const { receiptId } = useParams();
  if (!receiptId) throw new Error("receiptId not found");

  const navigation = useNavigation();
  const fetcher = useFetcher<{}>();
  const submitted = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (fetcher.state === "idle" && submitted.current) {
      onClose();
    }
  }, [fetcher.state]);

  return (
    <Modal
      open={true}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            <Trans>Void Receipt</Trans>
          </ModalTitle>
        </ModalHeader>
        <ModalBody>
          <p className="text-sm text-muted-foreground mb-4">
            <Trans>
              Are you sure you want to void this receipt? This action will
              reverse all inventory transactions and cannot be undone.
            </Trans>
          </p>
          <Alert variant="destructive">
            <LuTriangleAlert className="h-4 w-4" />
            <AlertTitle>
              <Trans>Warning</Trans>
            </AlertTitle>
            <AlertDescription>
              <Trans>Voiding this receipt will:</Trans>
              <ul className="list-disc pl-4 mt-2 space-y-1">
                <li>
                  <Trans>Reverse all inventory adjustments</Trans>
                </li>
                <li>
                  <Trans>Reverse the related journal entries</Trans>
                </li>
                <li>
                  <Trans>Restore tracked entities to available</Trans>
                </li>
                <li>
                  <Trans>Update the purchase order quantities</Trans>
                </li>
              </ul>
            </AlertDescription>
          </Alert>
        </ModalBody>
        <ModalFooter>
          <HStack>
            <Button variant="solid" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <fetcher.Form
              action={path.to.receiptVoid(receiptId)}
              method="post"
              onSubmit={() => {
                submitted.current = true;
              }}
            >
              <Button
                variant="destructive"
                isLoading={fetcher.state !== "idle"}
                isDisabled={
                  fetcher.state !== "idle" || navigation.state !== "idle"
                }
                type="submit"
              >
                <Trans>Void Receipt</Trans>
              </Button>
            </fetcher.Form>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default ReceiptVoidModal;
