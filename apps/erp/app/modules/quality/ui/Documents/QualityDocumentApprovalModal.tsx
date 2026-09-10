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
import type { FetcherWithComponents } from "react-router";
import { useParams } from "react-router";
import type { ApprovalDecision } from "~/modules/shared/types";
import { path } from "~/utils/path";
import { qualityDocumentApprovalValidator } from "../../quality.models";
import type { QualityDocument } from "../../types";

type QualityDocumentApprovalModalProps = {
  qualityDocument?: QualityDocument;
  approvalRequestId: string;
  decision: ApprovalDecision;
  fetcher: FetcherWithComponents<unknown>;
  onClose: () => void;
};

const QualityDocumentApprovalModal = ({
  qualityDocument,
  approvalRequestId,
  decision,
  onClose,
  fetcher
}: QualityDocumentApprovalModalProps) => {
  const { t } = useLingui();
  const { id } = useParams();
  if (!id) throw new Error("id not found");

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
          validator={qualityDocumentApprovalValidator}
          action={path.to.qualityDocument(id)}
          onSubmit={onClose}
          defaultValues={{
            approvalRequestId,
            decision,
            notes: undefined
          }}
          fetcher={fetcher}
        >
          <ModalHeader>
            <ModalTitle>
              {isApproving ? "Approve" : "Reject"} {qualityDocument?.name}
            </ModalTitle>
          </ModalHeader>
          <ModalBody>
            <Hidden name="approvalRequestId" />
            <Hidden name="decision" />
            <p className="text-sm text-muted-foreground mb-4">
              {isApproving
                ? "Are you sure you want to approve this quality document? This will make it active."
                : "Are you sure you want to reject this quality document? The document will remain in draft status."}
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

export default QualityDocumentApprovalModal;
