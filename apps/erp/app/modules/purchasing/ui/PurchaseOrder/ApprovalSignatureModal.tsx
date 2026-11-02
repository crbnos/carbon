// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAccountSettings } from "@carbon/account";
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
import { Trans } from "@lingui/react/macro";

/**
 * Shown instead of the approval when the company requires a signature to
 * approve purchase orders and the approver has none on file.
 */
export default function ApprovalSignatureModal({
  onClose
}: {
  onClose: () => void;
}) {
  const openAccountSettings = useAccountSettings((s) => s.open);

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            <Trans>Add your signature</Trans>
          </ModalTitle>
        </ModalHeader>
        <ModalBody>
          <p className="text-sm text-muted-foreground">
            <Trans>
              Your company requires a signature to approve purchase orders. Add
              one to your profile, then approve the order. It prints on the
              purchase order you approve.
            </Trans>
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Button
            onClick={() => {
              onClose();
              openAccountSettings("profile");
            }}
          >
            <Trans>Add Signature</Trans>
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
