import {
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from "@carbon/react";

import { Form, useNavigation } from "@remix-run/react";
import { path } from "~/utils/path";

type PurchaseInvoicePostModalProps = {
  isOpen: boolean;
  onClose: () => void;
  invoiceId: string;
  linesToReceive: {
    itemId: string | null;
    itemReadableId: string | null;
    quantity: number;
  }[];
};

const PurchaseInvoicePostModal = ({
  isOpen,
  onClose,
  invoiceId,
  linesToReceive,
}: PurchaseInvoicePostModalProps) => {
  const hasLinesToReceive = linesToReceive.length > 0;
  const navigation = useNavigation();

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Post Invoice</ModalTitle>
        </ModalHeader>
        <ModalBody>
          {hasLinesToReceive ? (
            <>
              <p>
                Are you sure you want to post this invoice? A receipt will be
                automatically created and posted for:
              </p>
              <ul className="mt-2">
                {linesToReceive.map((line) => (
                  <li key={line.itemId}>
                    {`${line.itemReadableId} (${line.quantity})`}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>Are you sure you want to post this invoice?</p>
          )}
        </ModalBody>
        <ModalFooter>
          <HStack>
            <Button variant="solid" onClick={onClose}>
              Cancel
            </Button>
            <Form method="post" action={path.to.purchaseInvoicePost(invoiceId)}>
              <Button isDisabled={navigation.state !== "idle"} type="submit">
                {hasLinesToReceive
                  ? "Post and Receive Invoice"
                  : "Post Invoice"}
              </Button>
            </Form>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default PurchaseInvoicePostModal;
