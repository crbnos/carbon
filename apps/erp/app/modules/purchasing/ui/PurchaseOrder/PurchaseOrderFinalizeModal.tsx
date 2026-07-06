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
import { useState } from "react";
import type { FetcherWithComponents } from "react-router";
import { useParams } from "react-router";
import AttachmentsList, {
  type ResolvedAttachmentItem
} from "~/components/AttachmentsList";
import {
  EmailRecipients,
  SelectControlled,
  SupplierContact
} from "~/components/Form";
import { useIntegrations } from "~/hooks/useIntegrations";
import { path } from "~/utils/path";
import { purchaseOrderFinalizeValidator } from "../../purchasing.models";
import type { PurchaseOrder } from "../../types";

type PurchaseOrderFinalizeModalProps = {
  purchaseOrder?: PurchaseOrder;
  fetcher: FetcherWithComponents<unknown>;
  onClose: () => void;
  defaultCc?: string[];
  resolvedAttachments?: ResolvedAttachmentItem[];
};

const PurchaseOrderFinalizeModal = ({
  purchaseOrder,
  onClose,
  fetcher,
  defaultCc = [],
  resolvedAttachments = []
}: PurchaseOrderFinalizeModalProps) => {
  const { orderId } = useParams();
  if (!orderId) throw new Error("orderId not found");

  const { t } = useLingui();
  const integrations = useIntegrations();
  const canEmail = integrations.has("email");

  const [notificationType, setNotificationType] = useState(
    canEmail ? "Email" : "Download"
  );

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <ModalContent>
        <ValidatedForm
          method="post"
          validator={purchaseOrderFinalizeValidator}
          action={path.to.purchaseOrderFinalize(orderId)}
          onSubmit={onClose}
          defaultValues={{
            notification: notificationType as "Email" | "None",
            supplierContact: purchaseOrder?.supplierContactId ?? undefined,
            cc: defaultCc
          }}
          fetcher={fetcher}
        >
          <ModalHeader>
            <ModalTitle>{`Finalize ${purchaseOrder?.purchaseOrderId}`}</ModalTitle>
            <ModalDescription>
              Are you sure you want to finalize the purchase order? Finalizing
              the order will affect on order quantities used to calculate supply
              and demand.
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              {canEmail && (
                <SelectControlled
                  label={t`Send Via`}
                  name="notification"
                  options={[
                    {
                      label: t`None`,
                      value: "None"
                    },
                    {
                      label: t`Email`,
                      value: "Email"
                    }
                  ]}
                  value={notificationType}
                  onChange={(t) => {
                    if (t) setNotificationType(t.value);
                  }}
                />
              )}
              {notificationType === "Email" && (
                <>
                  <SupplierContact
                    isOptional={false}
                    name="supplierContact"
                    supplier={purchaseOrder?.supplierId ?? undefined}
                  />
                  <EmailRecipients
                    name="cc"
                    label={t`CC`}
                    type="supplier"
                    helperText={t`Type an email and press Enter to add an external recipient`}
                  />
                  <AttachmentsList
                    supplierInteractionId={
                      purchaseOrder?.supplierInteractionId ?? null
                    }
                    attachments={resolvedAttachments}
                  />
                </>
              )}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Button type="submit">
              <Trans>Finalize</Trans>
            </Button>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
};

export default PurchaseOrderFinalizeModal;
