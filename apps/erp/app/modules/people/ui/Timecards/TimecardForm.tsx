// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { TextArea, ValidatedForm } from "@carbon/form";
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
import type { CalendarDateTime } from "@internationalized/date";
import {
  getLocalTimeZone,
  now,
  parseAbsolute,
  toCalendarDateTime
} from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { useNavigate } from "react-router";
import type { z } from "zod";
import { DateTimePicker, Employee, Hidden, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { timecardValidator } from "../../people.models";

type TimecardFormProps = {
  initialValues: z.infer<typeof timecardValidator>;
};

const TimecardForm = ({ initialValues }: TimecardFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const onClose = () => navigate(-1);

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "people")
    : !permissions.can("create", "people");

  const [clockIn, setClockIn] = useState<CalendarDateTime>(
    initialValues.clockIn
      ? toCalendarDateTime(
          parseAbsolute(initialValues.clockIn, getLocalTimeZone())
        )
      : toCalendarDateTime(now(getLocalTimeZone()))
  );

  const [clockOut, setClockOut] = useState<CalendarDateTime | undefined>(
    initialValues.clockOut
      ? toCalendarDateTime(
          parseAbsolute(initialValues.clockOut, getLocalTimeZone())
        )
      : undefined
  );

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent>
        <ValidatedForm
          validator={timecardValidator}
          method="post"
          action={
            isEditing
              ? path.to.timecard(initialValues.id!)
              : path.to.newTimecard
          }
          defaultValues={initialValues}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>
              {isEditing ? (
                <Trans>Edit Timecard</Trans>
              ) : (
                <Trans>New Timecard</Trans>
              )}
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />
            <VStack spacing={4}>
              {!isEditing ? (
                <Employee name="employeeId" label={t`Employee`} />
              ) : (
                <Hidden name="employeeId" />
              )}
              <DateTimePicker
                name="clockIn"
                label={t`Clock In`}
                maxValue={clockOut}
                onChange={setClockIn}
              />
              <DateTimePicker
                name="clockOut"
                label={t`Clock Out`}
                minValue={clockIn}
                onChange={setClockOut}
              />
              <TextArea name="note" label={t`Note`} />
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Submit isDisabled={isDisabled}>
                <Trans>Save</Trans>
              </Submit>
              <Button variant="solid" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
};

export default TimecardForm;
