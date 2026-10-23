// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Alert,
  AlertDescription,
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
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuTriangleAlert } from "react-icons/lu";
import {
  DatePicker,
  Hidden,
  Input,
  Number as NumberField,
  Submit
} from "~/components/Form";
import { useCompanyToday, useUser } from "~/hooks";
import { useCurrencyDecimals } from "~/hooks/useCurrencies";
import { serviceExpenseValidator } from "../../service.models";

/**
 * Adds an expense to a node: mileage, a meal, a part bought on a card. It
 * posts at once (`post-project-expense`) and its coverage decides who pays.
 * A posting refusal shows in the modal, which stays open.
 */
export default function AddExpenseModal({
  action,
  node,
  serviceVisitId,
  onClose
}: {
  /** The order's charge route. */
  action: string;
  node: { id: string; readableId: string; name: string };
  serviceVisitId?: string | null;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const today = useCompanyToday();
  const { company } = useUser();
  const currencyCode = company.baseCurrencyCode ?? "USD";
  const decimals = useCurrencyDecimals(currencyCode);
  const fetcher = useAction<{
    success?: boolean;
    error?: { message: string } | null;
  }>({ onSuccess: () => onClose() });
  const errorMessage =
    fetcher.state === "idle" ? fetcher.data?.error?.message : undefined;

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalOverlay />
      <ModalContent>
        <ValidatedForm
          validator={serviceExpenseValidator}
          method="post"
          action={action}
          fetcher={fetcher}
          defaultValues={{
            projectElementId: node.id,
            serviceVisitId: serviceVisitId ?? undefined,
            entryDate: today,
            description: ""
          }}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Add Expense</Trans>
            </ModalTitle>
            <ModalDescription>
              <span className="font-mono">{node.readableId}</span> {node.name}
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Hidden name="intent" value="expense" />
            <Hidden name="projectElementId" />
            <Hidden name="serviceVisitId" />
            <VStack spacing={4}>
              {errorMessage && (
                <Alert variant="destructive">
                  <LuTriangleAlert />
                  <AlertDescription>{errorMessage}</AlertDescription>
                </Alert>
              )}
              <DatePicker name="entryDate" label={t`Date`} />
              <Input name="description" label={t`Description`} />
              <NumberField
                name="amount"
                label={t`Amount`}
                minValue={0}
                formatOptions={INPUT_FORMAT.money(currencyCode, decimals)}
                step={INPUT_STEP.money(decimals)}
              />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit withBlocker={false}>
              <Trans>Add Expense</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
