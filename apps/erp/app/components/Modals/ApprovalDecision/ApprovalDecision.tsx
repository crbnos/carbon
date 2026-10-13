// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ApprovalDecision as Decision } from "@carbon/ee/approvals";
import { approvalDecisionValidator } from "@carbon/ee/approvals";
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
import type { ReactNode } from "react";
import type { FetcherWithComponents } from "react-router";

type ApprovalDecisionProps = {
  /** The route action that decides the request (posts `approvalDecisionValidator`). */
  action: string;
  approvalRequestId: string;
  decision: Decision;
  title: ReactNode;
  /** What this decision does to the document. */
  description: ReactNode;
  fetcher: FetcherWithComponents<unknown>;
  onClose: () => void;
};

const ApprovalDecision = ({
  action,
  approvalRequestId,
  decision,
  title,
  description,
  fetcher,
  onClose
}: ApprovalDecisionProps) => {
  const { t } = useLingui();
  const isApproving = decision === "Approved";

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ValidatedForm
          method="post"
          validator={approvalDecisionValidator}
          action={action}
          onSubmit={onClose}
          defaultValues={{ approvalRequestId, decision, notes: undefined }}
          fetcher={fetcher}
        >
          <ModalHeader>
            <ModalTitle>{title}</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <Hidden name="approvalRequestId" />
            <Hidden name="decision" />
            <p className="text-sm text-muted-foreground mb-4">{description}</p>
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
              {isApproving ? t`Approve` : t`Reject`}
            </Button>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
};

export default ApprovalDecision;
