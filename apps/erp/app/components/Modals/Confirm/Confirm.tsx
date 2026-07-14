import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  toast
} from "@carbon/react";
import type { ComponentProps, ReactNode } from "react";
import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";

type ConfirmProps = {
  action?: string;
  isOpen?: boolean;
  title: string;
  text: string;
  confirmText: string;
  cancelText?: string;
  confirmVariant?: ComponentProps<typeof Button>["variant"];
  onCancel: () => void;
  onSubmit?: () => void;
  // Extra hidden fields posted with the confirmation (e.g. a status value),
  // letting callers reuse this dialog for status changes, not just deletes.
  children?: ReactNode;
};

const Confirm = ({
  action,
  isOpen = true,
  title,
  text,
  confirmText = "Confirm",
  cancelText = "Cancel",
  confirmVariant,
  onCancel,
  onSubmit,
  children
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
        <ModalBody>
          <p className="text-sm text-muted-foreground">{text}</p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onCancel}>
            {cancelText}
          </Button>
          <fetcher.Form
            method="post"
            action={action}
            onSubmit={() => (submitted.current = true)}
          >
            {children}
            <Button
              variant={confirmVariant}
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
