import {
  Boolean,
  Number,
  Select,
  useControlField,
  ValidatedForm
} from "@carbon/form";
import {
  Button,
  FormControl,
  FormLabel,
  HStack,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  toast,
  VStack
} from "@carbon/react";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { useEffect } from "react";
import { BsExclamationSquareFill } from "react-icons/bs";
import { useFetcher } from "react-router";
import type { z } from "zod/v3";
import { HighPriorityIcon } from "~/assets/icons/HighPriorityIcon";
import { LowPriorityIcon } from "~/assets/icons/LowPriorityIcon";
import { MediumPriorityIcon } from "~/assets/icons/MediumPriorityIcon";
import { Enumerable } from "~/components/Enumerable";
import { Hidden, Input, Submit, WorkCenter } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import {
  maintenanceDispatchPriority,
  maintenanceFrequency,
  maintenanceScheduleValidator
} from "../../resources.models";

function getPriorityIcon(
  priority: (typeof maintenanceDispatchPriority)[number]
) {
  switch (priority) {
    case "Critical":
      return <BsExclamationSquareFill className="text-red-500" />;
    case "High":
      return <HighPriorityIcon />;
    case "Medium":
      return <MediumPriorityIcon />;
    case "Low":
      return <LowPriorityIcon />;
  }
}

// Component to show day selector and skip holidays when Daily frequency is selected
function DailyScheduleOptions() {
  const [frequency] = useControlField<string>("frequency");
  const isDaily = frequency === "Daily";

  if (!isDaily) return null;

  return (
    <>
      <FormControl>
        <FormLabel>Days</FormLabel>
        <VStack>
          <Boolean name="monday" description="Monday" />
          <Boolean name="tuesday" description="Tuesday" />
          <Boolean name="wednesday" description="Wednesday" />
          <Boolean name="thursday" description="Thursday" />
          <Boolean name="friday" description="Friday" />
          <Boolean name="saturday" description="Saturday" />
          <Boolean name="sunday" description="Sunday" />
        </VStack>
      </FormControl>
      <Boolean
        name="skipHolidays"
        label="Skip Holidays"
        description="Skip scheduled maintenance on company holidays"
      />
    </>
  );
}

type MaintenanceScheduleFormProps = {
  initialValues: z.infer<typeof maintenanceScheduleValidator>;
  type?: "modal" | "drawer";
  open?: boolean;
  onClose: () => void;
};

const MaintenanceScheduleForm = ({
  initialValues,
  open = true,
  type = "drawer",
  onClose
}: MaintenanceScheduleFormProps) => {
  const permissions = usePermissions();
  const fetcher = useFetcher<PostgrestResponse<{ id: string }>>();

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      toast.success(`Created maintenance schedule`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(
        `Failed to create maintenance schedule: ${fetcher.data.error.message}`
      );
    }
  }, [fetcher.data, fetcher.state, onClose, type]);

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "production")
    : !permissions.can("create", "production");

  return (
    <ModalDrawerProvider type={type}>
      <ModalDrawer
        open={open}
        onOpenChange={(open) => {
          if (!open) onClose?.();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={maintenanceScheduleValidator}
            method="post"
            action={
              isEditing
                ? path.to.maintenanceSchedule(initialValues.id!)
                : path.to.newMaintenanceSchedule
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? "Edit" : "New"} Scheduled Maintenance
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="type" value={type} />
              <VStack spacing={4}>
                <Input name="name" label="Schedule Name" />
                <WorkCenter name="workCenterId" label="Work Center" />
                <Select
                  name="frequency"
                  label="Frequency"
                  options={maintenanceFrequency.map((freq) => ({
                    value: freq,
                    label: <Enumerable value={freq} />
                  }))}
                />
                <Select
                  name="priority"
                  label="Priority"
                  options={maintenanceDispatchPriority.map((priority) => ({
                    value: priority,
                    label: (
                      <div className="flex gap-1 items-center">
                        {getPriorityIcon(priority)}
                        <span>{priority}</span>
                      </div>
                    )
                  }))}
                />
                <Number
                  name="estimatedDuration"
                  label="Estimated Duration (minutes)"
                  minValue={0}
                />
                <Boolean name="active" label="Active" />
                <DailyScheduleOptions />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>Save</Submit>
                <Button size="md" variant="solid" onClick={() => onClose()}>
                  Cancel
                </Button>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default MaintenanceScheduleForm;
