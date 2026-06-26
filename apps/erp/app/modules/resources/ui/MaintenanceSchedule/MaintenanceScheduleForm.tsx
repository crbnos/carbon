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
import { Trans, useLingui } from "@lingui/react/macro";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { useEffect } from "react";
import { BsExclamationSquareFill } from "react-icons/bs";
import { useFetcher } from "react-router";
import type { z } from "zod";
import { HighPriorityIcon } from "~/assets/icons/HighPriorityIcon";
import { LowPriorityIcon } from "~/assets/icons/LowPriorityIcon";
import { MediumPriorityIcon } from "~/assets/icons/MediumPriorityIcon";
import { Enumerable } from "~/components/Enumerable";
import {
  Hidden,
  Input,
  Location,
  Procedure,
  Submit,
  WorkCenter
} from "~/components/Form";
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
  const { t } = useLingui();
  const [frequency] = useControlField<string>("frequency");
  const isDaily = frequency === "Daily";

  if (!isDaily) return null;

  return (
    <>
      <FormControl>
        <FormLabel>
          <Trans>Days</Trans>
        </FormLabel>
        <VStack>
          <Boolean name="monday" description={t`Monday`} />
          <Boolean name="tuesday" description={t`Tuesday`} />
          <Boolean name="wednesday" description={t`Wednesday`} />
          <Boolean name="thursday" description={t`Thursday`} />
          <Boolean name="friday" description={t`Friday`} />
          <Boolean name="saturday" description={t`Saturday`} />
          <Boolean name="sunday" description={t`Sunday`} />
        </VStack>
      </FormControl>
      <Boolean
        name="skipHolidays"
        label={t`Skip Holidays`}
        description={t`Skip scheduled maintenance on company holidays`}
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
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<PostgrestResponse<{ id: string }>>();

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      toast.success(t`Created maintenance schedule`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(
        t`Failed to create maintenance schedule: ${fetcher.data.error.message}`
      );
    }
  }, [fetcher.data, fetcher.state, onClose, type, t]);

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
                {isEditing ? (
                  <Trans>Edit Scheduled Maintenance</Trans>
                ) : (
                  <Trans>New Scheduled Maintenance</Trans>
                )}
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="type" value={type} />
              <VStack spacing={4}>
                <Input name="name" label={t`Schedule Name`} />
                <WorkCenter
                  name="workCenterId"
                  label={t`Work Center`}
                  termId="work-center"
                />
                <Location name="locationId" label={t`Location`} />
                <Select
                  name="frequency"
                  label={t`Frequency`}
                  termId="maintenance-schedule-frequency"
                  options={maintenanceFrequency.map((freq) => ({
                    value: freq,
                    label: <Enumerable value={freq} />
                  }))}
                />
                <Select
                  name="priority"
                  label={t`Priority`}
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
                  label={t`Estimated Duration (minutes)`}
                  termId="maintenance-schedule-estimated-duration"
                  minValue={0}
                />
                <Procedure
                  name="procedureId"
                  label={t`Procedure`}
                  termId="maintenance-schedule-procedure"
                />
                <Boolean name="active" label={t`Active`} />
                <DailyScheduleOptions />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>
                  <Trans>Save</Trans>
                </Submit>
                <Button size="md" variant="solid" onClick={() => onClose()}>
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

export default MaintenanceScheduleForm;
