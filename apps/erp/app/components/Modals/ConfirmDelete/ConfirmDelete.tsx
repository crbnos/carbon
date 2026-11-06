// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { actionOutcome, useAction } from "@carbon/query";
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
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useRef } from "react";

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
  title,
  fields,
  isDisabled = false,
  onCancel,
  onSubmit
}: ConfirmDeleteProps) => {
  const { t } = useLingui();
  // The dialog stays mounted between opens, and so does its action: the
  // request outlives a close, as it did before. Each open has an id, so a
  // request from an earlier open does not close a later one on settling.
  const { openCount: opens } = useDisclosure({ isOpen });
  const latest = useRef({ isOpen, opens });
  latest.current = { isOpen, opens };
  const submittedIn = useRef<number | null>(null);
  const fetcher = useAction<{}>({
    onSettled: (data) => {
      const from = submittedIn.current;
      submittedIn.current = null;
      if (from === null) return;
      // A later open is on screen: this request was for an earlier one.
      if (latest.current.isOpen && from !== latest.current.opens) return;
      // Cancelled while the request ran: act on it only if it went through.
      if (!latest.current.isOpen && actionOutcome(data) !== "success") return;
      onSubmit?.();
    }
  });
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
            onSubmit={() => (submittedIn.current = opens)}
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
              isLoading={!isDisabled && fetcher.state !== "idle"}
              isDisabled={isDisabled || fetcher.state !== "idle"}
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
