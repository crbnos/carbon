import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle
} from "@carbon/react";
import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";

type ConfirmDeleteProps = {
  action?: string;
  isOpen?: boolean;
  name: string;
  text: string;
  deleteText?: string;
  onCancel: () => void;
  onSubmit?: () => void;
};

const ConfirmDelete = ({
  action,
  isOpen = true,
  name,
  text,
  deleteText = "Delete",
  onCancel,
  onSubmit
}: ConfirmDeleteProps) => {
  const fetcher = useFetcher<{}>();
  const submitted = useRef(false);
  useEffect(() => {
    if (fetcher.state === "idle" && submitted.current) {
      onSubmit?.();
      submitted.current = false;
    }
  }, [fetcher.state, onSubmit]);
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
          <fetcher.Form
            method="post"
            action={action}
            onSubmit={() => (submitted.current = true)}
          >
            <Button
              variant="destructive"
              isLoading={fetcher.state !== "idle"}
              isDisabled={fetcher.state !== "idle"}
              type="submit"
            >
              {deleteText}
            </Button>
          </fetcher.Form>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default ConfirmDelete;
