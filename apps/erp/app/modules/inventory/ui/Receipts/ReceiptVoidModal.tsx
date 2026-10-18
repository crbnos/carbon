// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
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
  ModalTitle,
  toast
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useRef } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import { useNavigation, useParams } from "react-router";
import type { action as voidAction } from "~/routes/x+/receipt+/$receiptId.void";
import { path } from "~/utils/path";

const ReceiptVoidModal = ({
  isSalesReturn,
  onClose
}: {
  isSalesReturn: boolean;
  onClose: () => void;
}) => {
  const { receiptId } = useParams();
  if (!receiptId) throw new Error("receiptId not found");

  const { t } = useLingui();
  const navigation = useNavigation();
  const fetcher = useAction<typeof voidAction>({
    onSuccess: () => {
      toast.success(t`Receipt voided`);
      if (submitted.current) onClose();
    },
    onError: () => {
      // No toast: a refused void keeps the modal open and shows the reason in place.
    }
  });
  const submitted = useRef(false);
  const refusal =
    fetcher.state === "idle" && fetcher.data && "error" in fetcher.data
      ? (fetcher.data.error?.message ?? null)
      : null;

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
                  <Trans>
                    Remove the received serial and batch numbers from stock
                  </Trans>
                </li>
                <li>
                  {isSalesReturn ? (
                    <Trans>Update the return order quantities</Trans>
                  ) : (
                    <Trans>Update the purchase order quantities</Trans>
                  )}
                </li>
              </ul>
            </AlertDescription>
          </Alert>
          {refusal && (
            <Alert variant="destructive" className="mt-4">
              <LuTriangleAlert className="h-4 w-4" />
              <AlertTitle>
                <Trans>The receipt was not voided</Trans>
              </AlertTitle>
              <AlertDescription>{refusal}</AlertDescription>
            </Alert>
          )}
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
