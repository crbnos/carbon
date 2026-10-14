// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useFetcher } from "react-router";
import { Select, Submit, TextArea } from "~/components/Form";
import { path } from "~/utils/path";
import { leaseClassificationValidator } from "../../purchasing.models";
import { useLesseeClassificationLabel } from "./LesseeClassificationBadge";
import type { LeaseLine, LesseeClassificationType } from "./types";

type LeaseClassificationOverrideModalProps = {
  leaseId: string;
  line: Pick<LeaseLine, "id" | "description">;
  classification: LesseeClassificationType;
  onClose: () => void;
};

/** Posts a manual classification of one asset with its reason
 *  (`update: accounting`). */
export function LeaseClassificationOverrideModal({
  leaseId,
  line,
  classification,
  onClose
}: LeaseClassificationOverrideModalProps) {
  const { t } = useLingui();
  const label = useLesseeClassificationLabel();
  const fetcher = useFetcher<{}>();

  const options = (["Operating", "Finance"] as const).map((value) => ({
    value,
    label: label(value)
  }));

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalOverlay />
      <ModalContent>
        <ValidatedForm
          validator={leaseClassificationValidator}
          method="post"
          action={path.to.leaseLineClassification(leaseId, line.id)}
          fetcher={fetcher}
          defaultValues={{
            classification:
              classification === "Finance" ? "Operating" : "Finance",
            reason: ""
          }}
          onSubmit={onClose}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Override Classification of {line.description}</Trans>
            </ModalTitle>
            <ModalDescription>
              <Trans>
                The override is kept at activation and recorded in the audit log
                with its reason.
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              <Select
                name="classification"
                label={t`Classification`}
                options={options}
              />
              <TextArea name="reason" label={t`Reason`} />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit>
              <Trans>Override</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}

/** Removes one asset's classification override while the lease is Draft, so
 *  activation classifies it from its tests again. Posts `intent=remove` to
 *  the override route (`update: accounting`), which audit-logs it as it does
 *  setting one. */
export function RemoveClassificationOverride({
  leaseId,
  leaseLineId
}: {
  leaseId: string;
  leaseLineId: string;
}) {
  const fetcher = useFetcher<{}>();
  return (
    <fetcher.Form
      method="post"
      action={path.to.leaseLineClassification(leaseId, leaseLineId)}
    >
      <input type="hidden" name="intent" value="remove" />
      <Button
        type="submit"
        variant="secondary"
        size="sm"
        isLoading={fetcher.state !== "idle"}
      >
        <Trans>Remove Override</Trans>
      </Button>
    </fetcher.Form>
  );
}

export default LeaseClassificationOverrideModal;
