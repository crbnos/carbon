import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  toast,
} from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import { useEffect, useRef } from "react";

type ConfirmProps = {
  action?: string;
  isOpen?: boolean;
  title: string;
  text: string;
  confirmText: string;
  onCancel: () => void;
  onSubmit?: () => void;
};

const Confirm = ({
  action,
  isOpen = true,
  title,
  text,
  confirmText = "Confirm",
  onCancel,
  onSubmit,
}: ConfirmProps) => {
  const fetcher = useFetcher<{ success: boolean; message: string }>();
  const submitted = useRef(false);

  useEffect(() => {
    if (fetcher.state === "idle" && submitted.current) {
      onSubmit?.();
      submitted.current = false;
    }
  }, [fetcher.state, onSubmit]);

  useEffect(() => {
    if (fetcher.data?.success === true && fetcher?.data?.message) {
      toast.success(fetcher.data.message);
    }

    if (fetcher.data?.success === false && fetcher?.data?.message) {
      toast.error(fetcher.data.message);
    }
  }, [fetcher.data?.message, fetcher.data?.success]);

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
          <ModalTitle>{title}</ModalTitle>
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
              isLoading={fetcher.state !== "idle"}
              isDisabled={fetcher.state !== "idle"}
              type="submit"
            >
              {confirmText}
            </Button>
          </fetcher.Form>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default Confirm;
