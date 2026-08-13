import {
  Boolean,
  Hidden,
  Input,
  Number,
  Submit,
  TextArea,
  ValidatedForm
} from "@carbon/form";
import {
  Button,
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
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import type { z } from "zod";
import CustomFormFields from "~/components/Form/CustomFormFields";
import Department from "~/components/Form/Department";
import Location from "~/components/Form/Location";
import Processes from "~/components/Form/Processes";
import Shifts from "~/components/Form/Shifts";
import StandardFactor from "~/components/Form/StandardFactor";
import { usePermissions, useUser } from "~/hooks";
import { workCenterValidator } from "~/modules/resources";
import { path } from "~/utils/path";

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

  const [selectedLocationId, setSelectedLocationId] = useState<
    string | undefined
  >(initialValues.locationId);

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
        <ModalDrawerContent>
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
                <Input name="name" label={t`Name`} />
                {showProcesses && (
                  <Processes
                    name="processes"
                    label={t`Processes`}
                    termId="work-center-processes"
                  />
                )}
                <Shifts
                  name="shifts"
                  label={t`Operating shifts`}
                  locationId={selectedLocationId}
                  helperText={t`Empty = all shifts at the location`}
                />
                <Boolean
                  name="alwaysOn"
                  label={t`Runs 24×7 (lights-out)`}
                  description={t`Ignore shift calendars — this machine can run unattended around the clock.`}
                />
                <TextArea name="description" label={t`Description`} />
                <Location
                  name="locationId"
                  label={t`Location`}
                  onChange={(location) =>
                    setSelectedLocationId(location?.value)
                  }
                />
                <Department name="departmentId" label={t`Department`} />

                <Number
                  name="laborRate"
                  label={t`Labor Rate (Hourly)`}
                  termId="work-center-labor-rate"
                  formatOptions={{
                    style: "currency",
                    currency: baseCurrency
                  }}
                />
                <Number
                  name="machineRate"
                  label={t`Machine Rate (Hourly)`}
                  termId="work-center-machine-rate"
                  formatOptions={{
                    style: "currency",
                    currency: baseCurrency
                  }}
                />
                <Number
                  name="overheadRate"
                  label={t`Overhead Rate (Hourly)`}
                  termId="work-center-overhead-rate"
                  formatOptions={{
                    style: "currency",
                    currency: baseCurrency
                  }}
                />

                <StandardFactor
                  name="defaultStandardFactor"
                  label={t`Default Unit`}
                  termId="work-center-default-unit"
                  value={initialValues.defaultStandardFactor}
                />
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

export default WorkCenterForm;
