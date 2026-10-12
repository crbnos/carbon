// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import {
  Button,
  HStack,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  VStack
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useFetcher } from "react-router";
import type { z } from "zod";
import { DatePicker, Hidden, Number, Select, Submit } from "~/components/Form";
import { useCurrencyDecimals, usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import {
  leasePaymentTypes,
  leasePaymentValidator
} from "../../purchasing.models";
import { useLeasePaymentTypeLabel } from "./useLeaseLabels";

type LeasePaymentFormProps = {
  initialValues: z.infer<typeof leasePaymentValidator>;
  /** The lease's assets: a row belongs to one of them. */
  assets: { id: string; description: string }[];
  currencyCode: string;
  onClose: () => void;
};

/** Add a payment row to one asset of a Draft lease: a rent holiday, an
 *  irregular step, a payment the terms do not describe. A row's fields are
 *  changed in the setup grid. */
const LeasePaymentForm = ({
  initialValues,
  assets,
  currencyCode,
  onClose
}: LeasePaymentFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<{}>();
  const currencyDecimals = useCurrencyDecimals(currencyCode);
  const paymentTypeLabel = useLeasePaymentTypeLabel();

  const action = path.to.leasePaymentNew(initialValues.leaseId);

  return (
    <ModalDrawerProvider type="modal">
      <ModalDrawer
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={leasePaymentValidator}
            method="post"
            action={action}
            fetcher={fetcher}
            defaultValues={initialValues}
            className="flex flex-col h-full"
            onSubmit={onClose}
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                <Trans>Add Payment</Trans>
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="leaseId" />
              <VStack spacing={4}>
                <Select
                  name="leaseLineId"
                  label={t`Asset`}
                  options={assets.map((asset) => ({
                    value: asset.id,
                    label: asset.description
                  }))}
                />
                <Select
                  name="paymentType"
                  label={t`Type`}
                  options={leasePaymentTypes.map((type) => ({
                    value: type,
                    label: paymentTypeLabel(type)
                  }))}
                />
                <DatePicker name="periodStart" label={t`Period Start`} />
                <DatePicker name="periodEnd" label={t`Period End`} />
                <DatePicker
                  name="dueDate"
                  label={t`Due Date`}
                  helperText={t`The invoice for this payment is drafted on this date`}
                />
                <Number
                  name="amount"
                  label={t`Amount`}
                  minValue={0}
                  step={INPUT_STEP.money(currencyDecimals)}
                  formatOptions={INPUT_FORMAT.money(
                    currencyCode,
                    currencyDecimals
                  )}
                />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={!permissions.can("update", "purchasing")}>
                  <Trans>Save</Trans>
                </Submit>
                <Button size="md" variant="solid" onClick={onClose}>
                  <Trans>Cancel</Trans>
                </Button>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default LeasePaymentForm;
