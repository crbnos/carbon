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
import { path } from "~/utils/path";
import { projectExpenseValidator } from "../../projects.models";

/**
 * Charges a cost straight to an element (a rental, a fee, a part bought on
 * a card). It posts at once (`post-project-expense`). A cost card prefills
 * its description, which ties the charge to that plan line. A posting
 * refusal shows in the modal, which stays open.
 */
export function ChargeCostModal({
  projectId,
  element,
  defaultDescription,
  defaultAmount,
  onClose
}: {
  projectId: string;
  element: { id: string; readableId: string; name: string };
  defaultDescription?: string;
  defaultAmount?: number;
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
          validator={projectExpenseValidator}
          method="post"
          action={path.to.projectExpense}
          fetcher={fetcher}
          defaultValues={{
            projectId,
            projectElementId: element.id,
            entryDate: today,
            description: defaultDescription ?? "",
            amount: defaultAmount
          }}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Charge Cost</Trans>
            </ModalTitle>
            <ModalDescription>
              <span className="font-mono">{element.readableId}</span>{" "}
              {element.name}
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Hidden name="projectId" />
            <Hidden name="projectElementId" />
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
              <Trans>Charge</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
