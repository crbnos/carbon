import {
  Button,
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";

/**
 * Asks before an import in progress is thrown away. The wizard holds the
 * uploaded file, the column mappings and the enum mappings in React state, so
 * closing it loses all of them — this dialog is what stands between a
 * mis-clicked × (or a stray Escape) and starting the mapping over.
 *
 * Nested inside the wizard's own modal, the same way FieldMappings opens the
 * payment-term and shipping-method forms.
 */
export function ConfirmDiscardImport({
  onCancel,
  onDiscard
}: {
  onCancel: () => void;
  onDiscard: () => void;
}) {
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <ModalContent size="small">
        <ModalHeader>
          <ModalTitle>
            <Trans>Discard this import?</Trans>
          </ModalTitle>
          <ModalDescription>
            <Trans>
              The file you uploaded and the mappings you've made will be lost.
            </Trans>
          </ModalDescription>
        </ModalHeader>
        <ModalFooter>
          <Button variant="secondary" onClick={onCancel}>
            <Trans>Keep editing</Trans>
          </Button>
          <Button variant="destructive" onClick={onDiscard}>
            <Trans>Discard import</Trans>
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
