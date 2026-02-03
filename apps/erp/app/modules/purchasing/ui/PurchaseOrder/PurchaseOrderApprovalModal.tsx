import { Hidden, ValidatedForm } from "@carbon/form";
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
import { useState } from "react";
import type { FetcherWithComponents } from "react-router";
import { useParams } from "react-router";
import { SelectControlled, SupplierContact } from "~/components/Form";
import { useIntegrations } from "~/hooks/useIntegrations";
import type { ApprovalDecision } from "~/modules/shared/types";
import { path } from "~/utils/path";
import { purchaseOrderApprovalValidator } from "../../purchasing.models";
import type { PurchaseOrder } from "../../types";

type PurchaseOrderApprovalModalProps = {
  purchaseOrder?: PurchaseOrder;
  approvalRequestId: string;
  decision: ApprovalDecision;
  fetcher: FetcherWithComponents<unknown>;
  onClose: () => void;
};

const PurchaseOrderApprovalModal = ({
  purchaseOrder,
  approvalRequestId,
  decision,
  onClose,
  fetcher
}: PurchaseOrderApprovalModalProps) => {
  const { orderId } = useParams();
  if (!orderId) throw new Error("orderId not found");

  const integrations = useIntegrations();
  const canEmail = integrations.has("resend");
  const isApproving = decision === "Approved";

  const [notificationType, setNotificationType] = useState(
    canEmail && isApproving ? "Email" : "None"
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
          validator={purchaseOrderApprovalValidator}
          action={path.to.purchaseOrder(orderId)}
          onSubmit={onClose}
          defaultValues={{
            approvalRequestId,
            decision,
            notification: notificationType as "Email" | "None",
            supplierContact: purchaseOrder?.supplierContactId ?? undefined
          }}
          fetcher={fetcher}
        >
          <ModalHeader>
            <ModalTitle>
              {isApproving ? "Approve" : "Reject"}{" "}
              {purchaseOrder?.purchaseOrderId}
            </ModalTitle>
            <ModalDescription>
              {isApproving
                ? "Are you sure you want to approve this purchase order? This will allow the order to proceed."
                : "Are you sure you want to reject this purchase order? The requester will be notified."}
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Hidden name="approvalRequestId" />
            <Hidden name="decision" />
            <VStack spacing={4}>
              {isApproving && canEmail && (
                <SelectControlled
                  label="Send Via"
                  name="notification"
                  options={[
                    {
                      label: "None",
                      value: "None"
                    },
                    {
                      label: "Email",
                      value: "Email"
                    }
                  ]}
                  value={notificationType}
                  onChange={(t) => {
                    if (t) setNotificationType(t.value);
                  }}
                />
              )}
              {isApproving && notificationType === "Email" && (
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
            <Button
              type="submit"
              variant={isApproving ? "primary" : "destructive"}
            >
              {isApproving ? "Approve" : "Reject"}
            </Button>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
};

export default PurchaseOrderApprovalModal;
