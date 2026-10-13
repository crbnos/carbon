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
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useRef } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import { useNavigation, useParams } from "react-router";
import { path } from "~/utils/path";

const PurchaseInvoiceVoidModal = ({ onClose }: { onClose: () => void }) => {
  const { invoiceId } = useParams();
  if (!invoiceId) throw new Error("invoiceId not found");

  const navigation = useNavigation();
  const fetcher = useAction<{}>({
    onSettled: () => {
      if (submitted.current) {
        onClose();
      }
    }
  });
  const submitted = useRef(false);

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
            <Trans>Void Purchase Invoice</Trans>
          </ModalTitle>
          <ModalDescription>
            <Trans>
              Are you sure you want to void this purchase invoice? This action
              will reverse all financial transactions and cannot be undone.
            </Trans>
          </ModalDescription>
        </ModalHeader>
        <ModalBody>
          <Alert variant="destructive">
            <LuTriangleAlert className="h-4 w-4" />
            <AlertTitle>
              <Trans>Warning</Trans>
            </AlertTitle>
            <AlertDescription>
              <Trans>Voiding this purchase invoice will:</Trans>
              <ul className="list-disc pl-4 mt-2 space-y-1">
                <li>
                  <Trans>Reverse all journal and cost ledger entries</Trans>
                </li>
                <li>
                  <Trans>
                    Reverse any item ledger entries from this invoice
                  </Trans>
                </li>
                <li>
                  <Trans>Update the purchase order quantities</Trans>
                </li>
                <li>
                  <Trans>Leave any related receipts untouched</Trans>
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
              action={path.to.purchaseInvoiceVoid(invoiceId)}
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
                <Trans>Void Invoice</Trans>
              </Button>
            </fetcher.Form>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default PurchaseInvoiceVoidModal;
