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
  ModalFooter,
  ModalHeader,
  ModalTitle,
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import {
  CustomerContact,
  EmailRecipients,
  SelectControlled
} from "~/components/Form";
import { useIntegrations } from "~/hooks/useIntegrations";
import type { action as sendAction } from "~/routes/x+/service-job+/$jobId.estimate.send";
import { path } from "~/utils/path";
import { serviceJobEstimateSendFormValidator } from "../../service.models";

/**
 * Sends a job's estimate, as Finalize sends a quote: the estimate becomes
 * Sent and the job waits for the customer's answer. With Email the estimate
 * PDF goes to the chosen contact.
 */
export function EstimateSendModal({
  jobId,
  serviceJobId,
  customerId,
  customerContactId,
  onClose
}: {
  jobId: string;
  serviceJobId: string;
  customerId: string;
  customerContactId: string | null;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const integrations = useIntegrations();
  const canEmail = integrations.has("email");
  const [notificationType, setNotificationType] = useState<"Email" | "None">(
    canEmail ? "Email" : "None"
  );

  const fetcher = useAction<typeof sendAction>({
    onSuccess: (result) => {
      if (result.data?.warning) toast.warning(result.data.warning);
      else toast.success(t`Estimate sent`);
      onClose();
    }
  });
  const isSubmitting = fetcher.state !== "idle";

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
          validator={serviceJobEstimateSendFormValidator}
          action={path.to.serviceJobEstimateSend(jobId)}
          defaultValues={{
            notification: notificationType,
            customerContact: customerContactId ?? undefined,
            cc: []
          }}
          fetcher={fetcher}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Send Estimate {serviceJobId}</Trans>
            </ModalTitle>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              <p className="text-sm text-muted-foreground">
                <Trans>
                  The estimate is marked Sent and the job waits for the
                  customer's answer.
                </Trans>
              </p>
              {canEmail && (
                <SelectControlled
                  label={t`Send Via`}
                  name="notification"
                  options={[
                    { label: t`None`, value: "None" },
                    { label: t`Email`, value: "Email" }
                  ]}
                  value={notificationType}
                  onChange={(option) => {
                    if (option?.value === "Email" || option?.value === "None")
                      setNotificationType(option.value);
                  }}
                />
              )}
              {notificationType === "Email" && (
                <>
                  <CustomerContact
                    name="customerContact"
                    customer={customerId}
                  />
                  <EmailRecipients name="cc" label={t`CC`} type="employee" />
                </>
              )}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Button
              type="submit"
              isDisabled={isSubmitting}
              isLoading={isSubmitting}
            >
              <Trans>Send</Trans>
            </Button>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}

export default EstimateSendModal;
