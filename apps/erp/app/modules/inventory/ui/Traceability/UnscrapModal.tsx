import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Hidden, Submit, TextArea } from "~/components/Form";
import { inventoryAdjustmentValidator } from "~/modules/inventory";
import { path } from "~/utils/path";

type UnscrapModalProps = {
  itemId: string;
  trackedEntityId: string;
  quantity: number;
  /** Optional readable label for the entity, shown in the modal header. */
  label?: string | null;
  open: boolean;
  onClose: () => void;
};

/**
 * Restore a Scrapped tracked entity to Available (Oracle Return-from-Scrap).
 * Reuses the manual-adjustment route; the edge function resolves the original
 * scrap movement (location, bin, and original cost) from the entity, so no
 * location is submitted here — a Scrapped tracked-entity row carries none.
 */
export function UnscrapModal({
  itemId,
  trackedEntityId,
  quantity,
  label,
  open,
  onClose
}: UnscrapModalProps) {
  const { t } = useLingui();

  return (
    <Modal open={open} onOpenChange={(v) => !v && onClose()}>
      <ModalContent>
        <ValidatedForm
          method="post"
          action={path.to.inventoryItemAdjustment(itemId)}
          validator={inventoryAdjustmentValidator}
          defaultValues={{
            itemId,
            trackedEntityId,
            adjustmentType: "Unscrap",
            quantity,
            comment: ""
          }}
          onSubmit={onClose}
        >
          <ModalHeader>
            <ModalTitle>
              {label ? <Trans>Unscrap {label}</Trans> : <Trans>Unscrap</Trans>}
            </ModalTitle>
            <ModalDescription>
              <Trans>
                Restore this entity to available stock at the bin and cost it
                was scrapped from.
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Hidden name="itemId" />
            <Hidden name="trackedEntityId" />
            <Hidden name="adjustmentType" />
            <Hidden name="quantity" />
            <VStack spacing={4}>
              <TextArea name="comment" label={t`Comment`} />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit withBlocker={false}>
              <Trans>Unscrap</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
