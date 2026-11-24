// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  toast
} from "@carbon/react";
import { INPUT_FORMAT } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { nanoid } from "nanoid";
import { useState } from "react";
import {
  DatePicker,
  Hidden,
  Number as NumberField,
  Select,
  Submit,
  TextArea
} from "~/components/Form";
import { useCurrencyFormatter } from "~/hooks";
import { paymentRequestValidator } from "~/modules/invoicing/invoicing.models";
import type {
  PaymentRequestRow,
  PaymentRequestTarget
} from "~/modules/invoicing/types";
import type { action as paymentRequestAction } from "~/routes/x+/payment-request";
import { path } from "~/utils/path";

export default function PaymentRequestForm({
  request,
  target,
  currencyCode,
  allowance,
  onClose
}: {
  request: PaymentRequestRow | null;
  target: PaymentRequestTarget;
  currencyCode: string;
  /** From the API; the operation refuses a larger amount all the same. */
  allowance: number;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const formatter = useCurrencyFormatter({ currency: currencyCode });
  // One key per opened form: a double submit creates one request.
  const [idempotencyKey] = useState(() => nanoid());
  const fetcher = useAction<typeof paymentRequestAction>({
    onSuccess: () => {
      toast.success(request ? t`Request updated` : t`Request added`);
      onClose();
    }
  });

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent>
        <ValidatedForm
          method="post"
          action={path.to.paymentRequestAction}
          validator={paymentRequestValidator}
          fetcher={fetcher}
          defaultValues={{
            id: request?.id,
            ...target,
            amount:
              request?.amount == null ? undefined : Number(request.amount),
            dueDate: request?.dueDate ?? undefined,
            description: request?.description ?? undefined,
            status:
              request?.status === "Ready"
                ? ("Ready" as const)
                : ("Planned" as const)
          }}
        >
          <ModalHeader>
            <ModalTitle>
              {request ? (
                <Trans>Edit request {request.requestNumber}</Trans>
              ) : (
                <Trans>Add payment request</Trans>
              )}
            </ModalTitle>
            <ModalDescription>
              <Trans>
                Up to {formatter.format(allowance)} can still be requested.
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody className="flex flex-col gap-4">
            <Hidden name="intent" value="save" />
            <Hidden name="id" />
            {"purchaseInvoiceId" in target ? (
              <Hidden name="purchaseInvoiceId" />
            ) : (
              <Hidden name="purchaseOrderId" />
            )}
            {!request && (
              <Hidden name="idempotencyKey" value={idempotencyKey} />
            )}
            <NumberField
              name="amount"
              label={t`Amount`}
              formatOptions={INPUT_FORMAT.money(currencyCode, 2)}
            />
            <DatePicker name="dueDate" label={t`Due date`} />
            <Select
              name="status"
              label={t`Status`}
              options={[
                { value: "Planned", label: t`Planned: expected, not yet due` },
                { value: "Ready", label: t`Ready: due, send to Ramp` }
              ]}
            />
            <TextArea name="description" label={t`Description`} />
          </ModalBody>
          <ModalFooter>
            <HStack>
              <Button type="button" variant="secondary" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
              <Submit withBlocker={false}>
                <Trans>Save</Trans>
              </Submit>
            </HStack>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
