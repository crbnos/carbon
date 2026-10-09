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
  Number as NumberField,
  Select,
  Submit,
  TextArea
} from "~/components/Form";
import { useCompanyToday } from "~/hooks";
import { path } from "~/utils/path";
import { logTimeValidator } from "../../projects.models";

/**
 * Logs time on one element for the signed-in user. The charge number is
 * fixed to the element. A posting refusal shows in the modal, which stays
 * open.
 */
export function LogTimeModal({
  projectId,
  element,
  laborCategories,
  defaultLaborCategoryId,
  action = path.to.projectLogTime,
  hiddenFields,
  defaultHours,
  onLogged,
  onClose
}: {
  projectId: string;
  element: { id: string; readableId: string; name: string };
  laborCategories: { id: string; name: string }[];
  defaultLaborCategoryId: string | null;
  /** The route that logs and posts the time (a service order's charge route). */
  action?: string;
  /** Extra values the action reads, such as `intent`. */
  hiddenFields?: Record<string, string>;
  /** The hours to start from, such as a stopped work timer's. */
  defaultHours?: number;
  /** Called once the time is logged, before the modal closes. */
  onLogged?: () => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const today = useCompanyToday();
  const fetcher = useAction<{
    success?: boolean;
    error?: { message: string } | null;
  }>({
    onSuccess: () => {
      onLogged?.();
      onClose();
    }
  });
  const errorMessage =
    fetcher.state === "idle" ? fetcher.data?.error?.message : undefined;

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalOverlay />
      <ModalContent>
        <ValidatedForm
          validator={logTimeValidator}
          method="post"
          action={action}
          fetcher={fetcher}
          defaultValues={{
            entryDate: today,
            projectId,
            projectElementId: element.id,
            laborCategoryId:
              defaultLaborCategoryId &&
              laborCategories.some((c) => c.id === defaultLaborCategoryId)
                ? defaultLaborCategoryId
                : (laborCategories[0]?.id ?? ""),
            hours: defaultHours,
            note: ""
          }}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Log Time</Trans>
            </ModalTitle>
            <ModalDescription>
              <span className="font-mono">{element.readableId}</span>{" "}
              {element.name}
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Hidden name="projectId" />
            <Hidden name="projectElementId" />
            {Object.entries(hiddenFields ?? {}).map(([name, value]) => (
              <Hidden key={name} name={name} value={value} />
            ))}
            <VStack spacing={4}>
              {errorMessage && (
                <Alert variant="destructive">
                  <LuTriangleAlert />
                  <AlertDescription>{errorMessage}</AlertDescription>
                </Alert>
              )}
              <DatePicker name="entryDate" label={t`Date`} />
              <NumberField
                name="hours"
                label={t`Hours`}
                minValue={0}
                maxValue={24}
                formatOptions={INPUT_FORMAT.quantity}
                step={INPUT_STEP.quantity}
              />
              <Select
                name="laborCategoryId"
                label={t`Labor Category`}
                options={laborCategories.map((c) => ({
                  value: c.id,
                  label: c.name
                }))}
              />
              <TextArea name="note" label={t`Note`} />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit withBlocker={false}>
              <Trans>Log Time</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
