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
import { useMemo } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import {
  Combobox,
  DatePicker,
  Location,
  Number as NumberField,
  Submit,
  useChargeNumbers
} from "~/components/Form";
import { useUser } from "~/hooks";
import { path } from "~/utils/path";
import { contractLineBuildValidator } from "../../sales.models";

/**
 * Build on a part CLIN (spec section 10.2), as a task's Create Job asks:
 * the task, the quantity, the due date and the location. The job, its plan
 * line and its link to the CLIN follow from the line.
 */
export default function ContractLineBuildModal({
  contractId,
  lineId,
  projectId,
  itemLabel,
  defaultElementId,
  defaultQuantity,
  defaultDueDate,
  onClose
}: {
  contractId: string;
  lineId: string;
  projectId: string;
  itemLabel: string;
  /** The line's billing element. */
  defaultElementId?: string | null;
  /** The line's quantity less what its jobs already build. */
  defaultQuantity: number;
  /** The task's target date. */
  defaultDueDate?: string | null;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const { defaults } = useUser();
  const chargeNumbers = useChargeNumbers();
  const fetcher = useAction<{ error?: { message: string } }>();
  const errorMessage =
    fetcher.state === "idle" ? fetcher.data?.error?.message : undefined;

  // The project's chargeable elements: a job is charged to one of them.
  const taskOptions = useMemo(
    () =>
      chargeNumbers
        .filter(
          (row) => row.projectId === projectId && row.projectElementId !== null
        )
        .map((row) => ({
          value: row.projectElementId as string,
          label: `${row.readableId} ${row.name}`
        })),
    [chargeNumbers, projectId]
  );

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalOverlay />
      <ModalContent>
        <ValidatedForm
          validator={contractLineBuildValidator}
          method="post"
          action={path.to.contractLineBuild(contractId, lineId)}
          fetcher={fetcher}
          defaultValues={{
            elementId: defaultElementId ?? "",
            quantity: defaultQuantity,
            dueDate: defaultDueDate ?? undefined,
            locationId: defaults?.locationId ?? ""
          }}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Build</Trans>
            </ModalTitle>
            <ModalDescription>{itemLabel}</ModalDescription>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              {errorMessage && (
                <Alert variant="destructive">
                  <LuTriangleAlert />
                  <AlertDescription>{errorMessage}</AlertDescription>
                </Alert>
              )}
              <Combobox
                name="elementId"
                label={t`Task`}
                options={taskOptions}
                helperText={t`The job's cost reports to this task`}
              />
              <NumberField
                name="quantity"
                label={t`Quantity`}
                minValue={0}
                formatOptions={INPUT_FORMAT.quantity}
                step={INPUT_STEP.quantity}
              />
              <DatePicker name="dueDate" label={t`Due Date`} />
              <Location name="locationId" label={t`Location`} />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit withBlocker={false}>
              <Trans>Create Job</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
