import {
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
} from "@carbon/react";
import { Form, useNavigation, useParams } from "@remix-run/react";
import { path } from "~/utils/path";

const ReceiptPostModal = ({ onClose }: { onClose: () => void }) => {
  const { receiptId } = useParams();
  if (!receiptId) throw new Error("receiptId not found");

  const navigation = useNavigation();

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
          <ModalTitle>Post Receipt</ModalTitle>
        </ModalHeader>
        <ModalBody>Are you sure you want to post this receipt?</ModalBody>
        <ModalFooter>
          <HStack>
            <Button variant="solid" onClick={onClose}>
              Cancel
            </Button>
            <Form action={path.to.receiptPost(receiptId)} method="post">
              <Button isDisabled={navigation.state !== "idle"} type="submit">
                Post Receipt
              </Button>
            </Form>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default ReceiptPostModal;
