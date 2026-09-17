import { Hidden, TextArea, ValidatedForm } from "@carbon/form";
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useParams } from "react-router";
import { supplierApprovalDecisionValidator } from "~/modules/purchasing";
import type { ApprovalDecision } from "~/modules/shared/types";
import { path } from "~/utils/path";

type SupplierApprovalModalProps = {
  supplierName?: string;
  approvalRequestId: string;
  decision: ApprovalDecision;
  onClose: () => void;
};

const SupplierApprovalModal = ({
  supplierName,
  approvalRequestId,
  decision,
  onClose
}: SupplierApprovalModalProps) => {
  const { t } = useLingui();
  const { supplierId } = useParams();
  if (!supplierId) throw new Error("supplierId not found");

  const isApproving = decision === "Approved";

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
          validator={supplierApprovalDecisionValidator}
          action={path.to.supplierApproval(supplierId)}
          onSubmit={onClose}
          defaultValues={{
            approvalRequestId,
            decision,
            notes: undefined
          }}
        >
          <ModalHeader>
            <ModalTitle>
              {isApproving ? "Approve" : "Reject"} {supplierName}
            </ModalTitle>
          </ModalHeader>
          <ModalBody>
            <Hidden name="approvalRequestId" />
            <Hidden name="decision" />
            <p className="text-sm text-muted-foreground mb-4">
              {isApproving
                ? "Are you sure you want to approve this supplier? This will make it active."
                : "Are you sure you want to reject this supplier?"}
            </p>
            <TextArea
              name="notes"
              label={t`Notes (optional)`}
              placeholder={t`Add any notes about your decision...`}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
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

export default SupplierApprovalModal;
