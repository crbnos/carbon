import {
  DatePicker,
  Hidden,
  Submit,
  TextArea,
  ValidatedForm
} from "@carbon/form";
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { trackedEntityExpiryValidator } from "~/modules/inventory";
import { path } from "~/utils/path";

type EditExpiryModalProps = {
  trackedEntityId: string;
  /** Existing expirationDate (YYYY-MM-DD) — used to pre-fill the date input. */
  expirationDate?: string | null;
  /** Optional readable label for the entity, shown in the modal header. */
  label?: string | null;
  open: boolean;
  onClose: () => void;
};

/**
 * Manual override of a tracked entity's expirationDate. The submission
 * goes through `path.to.trackedEntityExpiry`, which records the prior
 * value, the new value, and the reason on the entity's attributes JSONB
 * (under `expiryOverrides`). The trace popover can surface that history
 * later.
 */
export function EditExpiryModal({
  trackedEntityId,
  expirationDate,
  label,
  open,
  onClose
}: EditExpiryModalProps) {
  const { t } = useLingui();

  return (
    <Modal open={open} onOpenChange={(v) => !v && onClose()}>
      <ModalContent>
        <ValidatedForm
          method="post"
          action={path.to.trackedEntityExpiry}
          validator={trackedEntityExpiryValidator}
          defaultValues={{
            trackedEntityId,
            expirationDate: expirationDate ?? "",
            reason: ""
          }}
          onSubmit={onClose}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Edit expiration date</Trans>
            </ModalTitle>
            {label && (
              <ModalDescription>
                <Trans>Override the expiration on {label}.</Trans>
              </ModalDescription>
            )}
          </ModalHeader>
          <ModalBody>
            <Hidden name="trackedEntityId" />
            <div className="flex flex-col gap-4">
              <DatePicker
                name="expirationDate"
                label={t`New expiration date`}
                termId="shelf-life"
                helperText={t`Pick a date or leave blank to clear it.`}
              />
              <TextArea
                name="reason"
                label={t`Reason`}
                placeholder={t`Why is the expiration being changed?`}
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit>
              <Trans>Save</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
