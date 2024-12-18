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
  VStack,
} from "@carbon/react";
import { useParams } from "@remix-run/react";
import { useState } from "react";
import { SelectControlled, SupplierContact } from "~/components/Form";
import { useIntegrations } from "~/hooks/useIntegrations";
import { path } from "~/utils/path";
import { purchaseOrderFinalizeValidator } from "../../purchasing.models";
import type { PurchaseOrder } from "../../types";

type PurchaseOrderFinalizeModalProps = {
  onClose: () => void;
  purchaseOrder?: PurchaseOrder;
};

const PurchaseOrderFinalizeModal = ({
  purchaseOrder,
  onClose,
}: PurchaseOrderFinalizeModalProps) => {
  const { orderId } = useParams();
  if (!orderId) throw new Error("orderId not found");

  const integrations = useIntegrations();
  const canEmail = integrations.has("resend");

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
          }}
        >
          <ModalHeader>
            <ModalTitle>{`Finalize ${purchaseOrder?.purchaseOrderId}`}</ModalTitle>
            <ModalDescription>
              Are you sure you want to finalize the purchase order? Releasing
              the order will affect on order quantities used to calculate supply
              and demand.
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              {canEmail && (
                <SelectControlled
                  label="Send Via"
                  name="notification"
                  options={[
                    {
                      label: "None",
                      value: "None",
                    },
                    {
                      label: "Email",
                      value: "Email",
                    },
                  ]}
                  value={notificationType}
                  onChange={(t) => {
                    if (t) setNotificationType(t.value);
                  }}
                />
              )}
              {notificationType === "Email" && (
                <SupplierContact
                  name="supplierContact"
                  supplier={purchaseOrder?.supplierId ?? undefined}
                />
              )}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Finalize</Button>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
};

export default PurchaseOrderFinalizeModal;
