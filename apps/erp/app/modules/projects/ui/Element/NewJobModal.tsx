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
  Item,
  Location,
  Number as NumberField,
  Submit
} from "~/components/Form";
import { useUser } from "~/hooks";
import { path } from "~/utils/path";
import { newProjectJobValidator } from "../../projects.models";

/**
 * New Job on a task: the Make part, the quantity, the due date (the
 * task's target date) and the location (the project's), as a part CLIN's Build asks (`ContractLineBuildModal`), with
 * the task fixed. The action adds the plan line, links a part CLIN of the
 * task and redirects to the job; a refusal shows in the modal.
 */
export function NewJobModal({
  projectId,
  element,
  defaultLocationId,
  onClose
}: {
  projectId: string;
  element: {
    id: string;
    readableId: string;
    name: string;
    targetDate?: string | null;
  };
  /** The project's location. */
  defaultLocationId?: string | null;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const { defaults } = useUser();
  const fetcher = useAction<{ error?: { message: string } }>();
  const errorMessage =
    fetcher.state === "idle" ? fetcher.data?.error?.message : undefined;

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalOverlay />
      <ModalContent>
        <ValidatedForm
          validator={newProjectJobValidator}
          method="post"
          action={path.to.projectElementCreateJob(projectId, element.id)}
          fetcher={fetcher}
          defaultValues={{
            itemId: "",
            quantity: 1,
            dueDate: element.targetDate ?? undefined,
            locationId: defaultLocationId ?? defaults?.locationId ?? ""
          }}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>New Job</Trans>
            </ModalTitle>
            <ModalDescription>
              {element.readableId} {element.name}
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              {errorMessage && (
                <Alert variant="destructive">
                  <LuTriangleAlert />
                  <AlertDescription>{errorMessage}</AlertDescription>
                </Alert>
              )}
              <Item
                name="itemId"
                label={t`Part`}
                type="Part"
                replenishmentSystem="Make"
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
