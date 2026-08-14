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
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";

type ConfirmDeleteProps = {
  action?: string;
  isOpen?: boolean;
  name: string;
  text: string;
  deleteText?: string;
  /** Blocks the delete while still explaining why in `text`. */
  isDisabled?: boolean;
  onCancel: () => void;
  onSubmit?: () => void;
};

const ConfirmDelete = ({
  action,
  isOpen = true,
  name,
  text,
  deleteText = "Delete",
  isDisabled = false,
  onCancel,
  onSubmit
}: ConfirmDeleteProps) => {
  const { t } = useLingui();
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
          <ModalTitle>{t`Delete ${name}`}</ModalTitle>
        </ModalHeader>

        <ModalBody>
          <p className="text-sm text-muted-foreground">{text}</p>
        </ModalBody>

        <ModalFooter>
          <Button variant="secondary" onClick={onCancel}>
            <Trans>Cancel</Trans>
          </Button>
          <fetcher.Form
            method="post"
            action={action}
            onSubmit={() => (submitted.current = true)}
          >
            <Button
              variant="destructive"
              isLoading={!isDisabled && fetcher.state !== "idle"}
              isDisabled={isDisabled || fetcher.state !== "idle"}
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
