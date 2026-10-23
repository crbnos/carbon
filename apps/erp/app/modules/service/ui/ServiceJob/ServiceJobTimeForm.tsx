// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  VStack
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { z } from "zod";
import {
  Boolean,
  DatePicker,
  Employee,
  Hidden,
  Item,
  Number,
  Submit,
  TextArea
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { serviceJobTimeValidator } from "../../service.models";

type ServiceJobTimeFormProps = {
  initialValues: z.infer<typeof serviceJobTimeValidator>;
  isLocked: boolean;
  onClose: () => void;
};

/**
 * Hours one employee worked on a job on one day, at a labor item's cost and
 * bill rate. The time posts when the job is completed.
 */
const ServiceJobTimeForm = ({
  initialValues,
  isLocked,
  onClose
}: ServiceJobTimeFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const isEditing = !!initialValues.id;
  const isDisabled = isLocked || !permissions.can("update", "service");

  const fetcher = useAction({ onSuccess: onClose });

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent>
        <ValidatedForm
          defaultValues={initialValues}
          validator={serviceJobTimeValidator}
          method="post"
          action={
            isEditing
              ? path.to.serviceJobTime(
                  initialValues.serviceJobId,
                  initialValues.id!
                )
              : path.to.newServiceJobTime(initialValues.serviceJobId)
          }
          className="flex flex-col h-full"
          fetcher={fetcher}
          isDisabled={isDisabled}
        >
          <DrawerHeader>
            <DrawerTitle>{isEditing ? t`Edit Time` : t`Log Time`}</DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />
            <Hidden name="serviceJobId" />
            <VStack spacing={4}>
              <Employee name="employeeId" label={t`Employee`} />
              <Item
                name="laborItemId"
                label={t`Labor Item`}
                type="Service"
                validItemTypes={["Service"]}
              />
              <DatePicker name="entryDate" label={t`Date`} />
              <Number
                name="hours"
                label={t`Hours`}
                minValue={0}
                maxValue={24}
                formatOptions={INPUT_FORMAT.quantity}
                step={INPUT_STEP.quantity}
              />
              <Boolean name="billable" label={t`Billable`} />
              <TextArea name="note" label={t`Note`} rows={3} />
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Submit
                isDisabled={isDisabled || fetcher.state !== "idle"}
                isLoading={fetcher.state !== "idle"}
                withBlocker={false}
              >
                <Trans>Save</Trans>
              </Submit>
              <Button size="md" variant="solid" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
};

export default ServiceJobTimeForm;
