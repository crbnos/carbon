import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  SHORTCUTS
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
  /** Overrides the default "Delete {name}" heading (e.g. "Remove from batch"). */
  title?: string;
  /**
   * Extra values posted with the form — hidden inputs, so the modal can drive an
   * intent-based action (`{ intent, batchId, jobOperationIds }`) rather than only
   * a URL-addressable delete route. Array values render one input per entry.
   */
  fields?: Record<string, string | string[]>;
  onCancel: () => void;
  onSubmit?: () => void;
};

const ConfirmDelete = ({
  action,
  isOpen = true,
  name,
  text,
  deleteText = "Delete",
  title,
  fields,
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
          <ModalTitle>{title ?? t`Delete ${name}`}</ModalTitle>
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
            {/* Drawer and Modal are both z-50 (Drawer.tsx:23, Modal.tsx:35), so
                when this modal stacks over a drawer form the topmost-dialog
                guard resolves by "later-mounted wins" (utils/dialog.ts). If
                either z-index ever changes, re-verify ⌘Enter targets this
                modal, not the drawer's Submit. */}
            {fields &&
              Object.entries(fields).flatMap(([key, value]) =>
                (Array.isArray(value) ? value : [value]).map((v, i) => (
                  <input
                    key={`${key}-${i}`}
                    type="hidden"
                    name={key}
                    value={v}
                  />
                ))
              )}
            <Button
              variant="destructive"
              isLoading={fetcher.state !== "idle"}
              isDisabled={fetcher.state !== "idle"}
              type="submit"
              shortcut={SHORTCUTS.confirm}
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
