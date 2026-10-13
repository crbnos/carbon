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

const SalesInvoiceVoidModal = ({ onClose }: { onClose: () => void }) => {
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
            <Trans>Void Sales Invoice</Trans>
          </ModalTitle>
          <ModalDescription>
            <Trans>
              Are you sure you want to void this sales invoice? This action will
              reverse all financial transactions and cannot be undone.
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
              Voiding this sales invoice will:
              <ul className="list-disc pl-4 mt-2 space-y-1">
                <li>Reverse all journal entries and financial transactions</li>
                <li>Restore inventory quantities if items were shipped</li>
                <li>Update related sales orders and shipments</li>
                <li>Create audit trail entries</li>
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
              action={path.to.salesInvoiceVoid(invoiceId)}
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
                Void Invoice
              </Button>
            </fetcher.Form>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default SalesInvoiceVoidModal;
