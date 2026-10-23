// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
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
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Hidden, Input, Radios, Submit } from "~/components/Form";
import type { action as responseAction } from "~/routes/x+/service-job+/$jobId.estimate.response";
import { path } from "~/utils/path";
import { serviceJobEstimateResponseValidator } from "../../service.models";

/**
 * Records the customer's answer to a sent estimate. Accepted reopens the job
 * for the repair; Declined marks the unit not repairable, so the evaluation
 * time can be completed and billed.
 */
export function EstimateResponseModal({
  jobId,
  onClose
}: {
  jobId: string;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const fetcher = useAction<typeof responseAction>({
    onSuccess: () => {
      toast.success(t`Recorded the customer's response`);
      onClose();
    }
  });

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
          method="post"
          action={path.to.serviceJobEstimateResponse(jobId)}
          validator={serviceJobEstimateResponseValidator}
          defaultValues={{
            jobId,
            response: "Accepted",
            estimateRespondedBy: ""
          }}
          fetcher={fetcher}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Record Response</Trans>
            </ModalTitle>
            <ModalDescription>
              <Trans>
                Accepted reopens the job for the repair. Declined marks the unit
                not repairable, so the job can complete and bill its evaluation
                time.
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Hidden name="jobId" />
            <VStack spacing={4}>
              <Radios
                name="response"
                label={t`Response`}
                options={[
                  { label: t`Accepted`, value: "Accepted" },
                  { label: t`Declined`, value: "Declined" }
                ]}
              />
              <Input
                name="estimateRespondedBy"
                label={t`Customer Name`}
                helperText={t`Who gave the answer`}
              />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit
              isLoading={fetcher.state !== "idle"}
              isDisabled={fetcher.state !== "idle"}
              withBlocker={false}
            >
              <Trans>Record</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}

export default EstimateResponseModal;
