import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
} from "@carbon/react";
import { Form } from "@remix-run/react";

type ConfirmDeleteProps = {
  action?: string;
  isOpen?: boolean;
  name: string;
  text: string;
  onCancel: () => void;
  onSubmit?: () => void;
};

const ConfirmDelete = ({
  action,
  isOpen = true,
  name,
  text,
  onCancel,
  onSubmit,
}: ConfirmDeleteProps) => {
  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Delete {name}</ModalTitle>
        </ModalHeader>

        <ModalBody>{text}</ModalBody>

        <ModalFooter>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Form method="post" action={action} onSubmit={onSubmit}>
            <Button variant="destructive" type="submit">
              Delete
            </Button>
          </Form>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default ConfirmDelete;
