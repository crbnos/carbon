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
  VStack,
} from "@carbon/react";
import type { CalendarDateTime } from "@internationalized/date";
import {
  getLocalTimeZone,
  parseAbsolute,
  toCalendarDateTime,
} from "@internationalized/date";
import { useNavigate } from "@remix-run/react";
import { useState } from "react";
import type { z } from "zod";
import {
  DateTimePicker,
  Employee,
  Hidden,
  Select,
  Submit,
  WorkCenter,
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { productionEventValidator } from "../../production.models";

type ProductionEventFormProps = {
  initialValues: z.infer<typeof productionEventValidator>;
  operationOptions: {
    label: string;
    value: string;
    helperText?: string;
  }[];
};

const ProductionEventForm = ({
  initialValues,
  operationOptions,
}: ProductionEventFormProps) => {
  const permissions = usePermissions();
  const navigate = useNavigate();
  const onClose = () => navigate(-1);

  const [startTime, setStartTime] = useState(
    toCalendarDateTime(
      parseAbsolute(initialValues.startTime, getLocalTimeZone())
    )
  );
  const [endTime, setEndTime] = useState<CalendarDateTime | undefined>(
    initialValues.endTime
      ? toCalendarDateTime(
          parseAbsolute(initialValues.endTime, getLocalTimeZone())
        )
      : undefined
  );
  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "production")
    : !permissions.can("create", "production");
  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent>
        <ValidatedForm
          validator={productionEventValidator}
          method="post"
          defaultValues={initialValues}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>
              {isEditing ? "Edit Production Event" : "Create Production Event"}
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />

            <VStack spacing={4}>
              <Select
                name="jobOperationId"
                label="Operation"
                options={operationOptions ?? []}
              />
              <Employee name="employeeId" label="Employee" />
              <WorkCenter
                name="workCenterId"
                label="Work Center"
                processId={initialValues.jobOperationId}
              />
              <Select
                name="type"
                label="Event Type"
                options={[
                  { label: "Labor", value: "Labor" },
                  { label: "Machine", value: "Machine" },
                  { label: "Setup", value: "Setup" },
                ]}
              />
              <DateTimePicker
                name="startTime"
                label="Start Time"
                maxValue={endTime}
                onChange={setStartTime}
              />
              <DateTimePicker
                name="endTime"
                label="End Time"
                minValue={startTime}
                onChange={setEndTime}
              />
              <TextArea name="notes" label="Notes" />
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Submit isDisabled={isDisabled}>Save</Submit>
              <Button variant="solid" onClick={onClose}>
                Cancel
              </Button>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
};

export default ProductionEventForm;
