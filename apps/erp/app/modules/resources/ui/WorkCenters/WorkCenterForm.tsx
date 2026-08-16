import {
  Hidden,
  Input,
  Number,
  Submit,
  TextArea,
  useControlField,
  ValidatedForm
} from "@carbon/form";
import {
  Button,
  FormControl,
  FormHelperText,
  FormLabel,
  HStack,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
  VStack
} from "@carbon/react";
import { INPUT_FORMAT } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import type { z } from "zod";
import CustomFormFields from "~/components/Form/CustomFormFields";
import Department from "~/components/Form/Department";
import Location from "~/components/Form/Location";
import Processes from "~/components/Form/Processes";
import Shifts from "~/components/Form/Shifts";
import StandardFactor from "~/components/Form/StandardFactor";
import { useCurrencyDecimals, usePermissions, useUser } from "~/hooks";
import { workCenterValidator } from "~/modules/resources";
import { path } from "~/utils/path";

type ScheduleMode = "all" | "some" | "lightsOut";

type WorkCenterFormProps = {
  initialValues: z.infer<typeof workCenterValidator>;
  type?: "modal" | "drawer";
  open?: boolean;
  showProcesses?: boolean;
  onClose: () => void;
};

const WorkCenterForm = ({
  initialValues,
  open = true,
  type = "drawer",
  showProcesses = true,
  onClose
}: WorkCenterFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<PostgrestResponse<{ id: string }>>();

  const { company } = useUser();
  const baseCurrency = company?.baseCurrencyCode ?? "USD";
  const currencyDecimals = useCurrencyDecimals(baseCurrency);

  const [selectedLocationId, setSelectedLocationId] = useState<
    string | undefined
  >(initialValues.locationId);

  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>(
    initialValues.alwaysOn
      ? "lightsOut"
      : (initialValues.shifts?.length ?? 0) > 0
        ? "some"
        : "all"
  );

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      toast.success(t`Created work center`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(
        t`Failed to create work center: ${fetcher.data.error.message}`
      );
    }
  }, [fetcher.data, fetcher.state, onClose, type, t]);

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "resources")
    : !permissions.can("create", "resources");

  return (
    <ModalDrawerProvider type={type}>
      <ModalDrawer
        open={open}
        onOpenChange={(isOpen) => {
          if (!isOpen) onClose?.();
        }}
      >
        <ModalDrawerContent size="lg">
          <ValidatedForm
            validator={workCenterValidator}
            method="post"
            action={
              isEditing
                ? path.to.workCenter(initialValues.id!)
                : path.to.newWorkCenter
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? (
                  <Trans>Edit Work Center</Trans>
                ) : (
                  <Trans>New Work Center</Trans>
                )}
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="type" value={type} />
              <VStack spacing={4}>
                <p className="text-xs font-mono uppercase font-light text-muted-foreground">
                  <Trans>Basic Information</Trans>
                </p>
                <Input name="name" label={t`Name`} />
                {showProcesses && (
                  <Processes
                    name="processes"
                    label={t`Processes`}
                    termId="work-center-processes"
                  />
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
                  <Location
                    name="locationId"
                    label={t`Location`}
                    onChange={(location) =>
                      setSelectedLocationId(location?.value)
                    }
                  />
                  <Department name="departmentId" label={t`Department`} />
                </div>
                <StandardFactor
                  name="defaultStandardFactor"
                  label={t`Default Unit`}
                  termId="work-center-default-unit"
                  value={initialValues.defaultStandardFactor}
                />
                <TextArea name="description" label={t`Description`} />

                <p className="text-xs font-mono uppercase font-light text-muted-foreground pt-2">
                  <Trans>Costing</Trans>
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full">
                  <Number
                    name="laborRate"
                    label={t`Labor Rate`}
                    termId="work-center-labor-rate"
                    formatOptions={INPUT_FORMAT.rate(
                      baseCurrency,
                      currencyDecimals
                    )}
                  />
                  <Number
                    name="machineRate"
                    label={t`Machine Rate`}
                    termId="work-center-machine-rate"
                    formatOptions={INPUT_FORMAT.rate(
                      baseCurrency,
                      currencyDecimals
                    )}
                  />
                  <Number
                    name="overheadRate"
                    label={t`Overhead Rate`}
                    termId="work-center-overhead-rate"
                    formatOptions={INPUT_FORMAT.rate(
                      baseCurrency,
                      currencyDecimals
                    )}
                  />
                </div>

                <p className="text-xs font-mono uppercase font-light text-muted-foreground pt-2">
                  <Trans>Scheduling</Trans>
                </p>
                <FormControl>
                  <FormLabel htmlFor="scheduleMode">
                    {t`Operating hours`}
                  </FormLabel>
                  <Select
                    value={scheduleMode}
                    onValueChange={(value) =>
                      setScheduleMode(value as ScheduleMode)
                    }
                  >
                    <SelectTrigger id="scheduleMode" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t`All Shifts`}</SelectItem>
                      <SelectItem value="some">{t`Some Shifts`}</SelectItem>
                      <SelectItem value="lightsOut">
                        {t`Lights Out (24×7)`}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <FormHelperText>
                    {scheduleMode === "lightsOut"
                      ? t`Runs unattended around the clock, ignoring shift calendars.`
                      : scheduleMode === "all"
                        ? t`Runs during every shift at the location.`
                        : t`Runs only during the shifts you select.`}
                  </FormHelperText>
                </FormControl>
                {scheduleMode === "some" && (
                  <Shifts
                    name="shifts"
                    label={t`Shifts`}
                    locationId={selectedLocationId}
                  />
                )}
                <ClearArrayField
                  name="shifts"
                  active={scheduleMode === "some"}
                />
                {scheduleMode === "lightsOut" && (
                  <Hidden name="alwaysOn" value="on" />
                )}

                <CustomFormFields table="workCenter" />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>
                  <Trans>Save</Trans>
                </Submit>
                <Button size="md" variant="solid" onClick={() => onClose?.()}>
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

/**
 * Clears a controlled array field when it should be inactive.
 * Must be rendered inside a ValidatedForm.
 */
function ClearArrayField({ name, active }: { name: string; active: boolean }) {
  const [, setValue] = useControlField<string[]>(name);
  useEffect(() => {
    if (!active) {
      setValue([]);
    }
  }, [active, setValue]);
  return null;
}

export default WorkCenterForm;
