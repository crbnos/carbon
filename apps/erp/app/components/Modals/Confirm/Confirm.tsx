// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  SHORTCUTS,
  toast,
  useDisclosure
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
  // Read-only content shown under the text (e.g. a posting preview).
  details?: ReactNode;
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
  children,
  details
}: ConfirmProps) => {
  const fetcher = useFetcher<{ success: boolean; message: string }>();
  // The dialog stays mounted between opens, and so does its fetcher: the
  // request outlives a close, as it did before. Each open has an id, so a
  // request from an earlier open does not close a later one on settling.
  const { openCount: opens } = useDisclosure({ isOpen });
  const submittedIn = useRef<number | null>(null);

  useEffect(() => {
    if (fetcher.state !== "idle" || submittedIn.current === null) return;
    const from = submittedIn.current;
    submittedIn.current = null;
    // A later open is on screen: this request was for an earlier one.
    if (isOpen && from !== opens) return;
    // Cancelled while the request ran: act on it only if it went through.
    if (!isOpen && fetcher.data?.success === false) return;
    onSubmit?.();
  }, [fetcher.state, fetcher.data, onSubmit, isOpen, opens]);

  // Keyed on the response, not its message: the fetcher outlives a close, so
  // a later submit with the same message must toast again.
  useEffect(() => {
    if (fetcher.data?.success === true && fetcher?.data?.message) {
      toast.success(fetcher.data.message);
    }

    if (fetcher.data?.success === false && fetcher?.data?.message) {
      toast.error(fetcher.data.message);
    }
  }, [fetcher.data]);

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
          {details}
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onCancel}>
            {cancelText}
          </Button>
          <fetcher.Form
            method="post"
            action={action}
            onSubmit={() => (submittedIn.current = opens)}
          >
            {children}
            {/* Same z-50 tie-break dependency as ConfirmDelete: this modal
                wins over an open drawer only because it mounts later. */}
            <Button
              variant={confirmVariant}
              isLoading={fetcher.state !== "idle"}
              isDisabled={fetcher.state !== "idle"}
              type="submit"
              shortcut={SHORTCUTS.confirm}
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
