import { DatePicker, Select, ValidatedForm } from "@carbon/form";
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
  VStack,
} from "@carbon/react";
import { parseDate } from "@internationalized/date";
import { useFetcher } from "@remix-run/react";
import { useState } from "react";
import { LuCalendar } from "react-icons/lu";
import type { z } from "zod";
import { Enumerable } from "~/components/Enumerable";
import {
  CustomFormFields,
  Hidden,
  Input,
  Location,
  NumberControlled,
  SequenceOrCustomId,
  Shelf,
  Submit,
  Supplier,
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import { gaugeRole, gaugeValidator } from "../../quality.models";
import { GaugeRole } from "./GaugeStatus";

type GaugeFormValues = z.infer<typeof gaugeValidator>;

type GaugeFormProps = {
  initialValues: GaugeFormValues;
  gaugeTypes: ListItem[];
  type?: "modal" | "drawer";
  open?: boolean;
  onClose?: () => void;
};

const GaugeForm = ({
  initialValues,
  gaugeTypes,
  open = true,
  type = "drawer",
  onClose,
}: GaugeFormProps) => {
  const permissions = usePermissions();
  const fetcher = useFetcher<{}>();
  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "quality")
    : !permissions.can("create", "quality");

  const [calibrationInterval, setCalibrationInterval] = useState({
    lastCalibrationDate: initialValues.lastCalibrationDate,
    nextCalibrationDate: initialValues.nextCalibrationDate,
    calibrationIntervalInMonths: initialValues.calibrationIntervalInMonths ?? 6,
  });

  return (
    <ModalDrawerProvider type={type}>
      <ModalDrawer
        open={open}
        onOpenChange={(open) => {
          if (!open && onClose) onClose();
        }}
      >
        <ModalDrawerContent size="lg">
          <ValidatedForm
            method="post"
            validator={gaugeValidator}
            defaultValues={initialValues}
            fetcher={fetcher}
            action={
              isEditing ? path.to.gauge(initialValues.id!) : path.to.newGauge
            }
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? "Edit Gauge" : "New Gauge"}
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="type" value={type} />

              <VStack spacing={4}>
                <div className="grid w-full gap-4 grid-cols-1 md:grid-cols-2">
                  {isEditing ? (
                    <Input name="gaugeId" label="Gauge ID" isReadOnly />
                  ) : (
                    <SequenceOrCustomId
                      name="gaugeId"
                      label="Gauge ID"
                      table="gauge"
                    />
                  )}
                  <Input name="description" label="Description" />
                  <Select
                    name="gaugeTypeId"
                    label="Gauge Type"
                    options={gaugeTypes.map((type) => ({
                      label: <Enumerable value={type.name} />,
                      value: type.id,
                    }))}
                  />
                  <Supplier name="supplierId" label="Supplier" />
                  <Input name="modelNumber" label="Model Number" />
                  <Input name="serialNumber" label="Serial Number" />
                  {/* <Select
                    name="gaugeCalibrationStatus"
                    label="Calibration Status"
                    options={gaugeCalibrationStatus.map((status) => ({
                      label: <GaugeCalibrationStatus status={status} />,
                      value: status,
                    }))}
                  /> */}
                  <Select
                    name="gaugeRole"
                    label="Role"
                    options={gaugeRole.map((role) => ({
                      label: <GaugeRole role={role} />,
                      value: role,
                    }))}
                  />
                  <DatePicker name="dateAcquired" label="Date Acquired" />
                  {/* <Select
                    name="gaugeStatus"
                    label="Status"
                    options={gaugeStatus.map((status) => ({
                      label: <GaugeStatus status={status} />,
                      value: status,
                    }))}
                  /> */}
                  <DatePicker
                    name="lastCalibrationDate"
                    label="Last Calibration Date"
                    value={calibrationInterval.lastCalibrationDate}
                    onChange={(value) => {
                      setCalibrationInterval({
                        ...calibrationInterval,
                        lastCalibrationDate: value?.toString(),
                        nextCalibrationDate: value
                          ? parseDate(value?.toString())
                              .add({
                                months:
                                  calibrationInterval.calibrationIntervalInMonths,
                              })
                              .toString()
                          : undefined,
                      });
                    }}
                  />
                  <DatePicker
                    name="nextCalibrationDate"
                    label="Next Calibration Date"
                    value={calibrationInterval.nextCalibrationDate}
                    onChange={(value) => {
                      setCalibrationInterval({
                        ...calibrationInterval,
                        nextCalibrationDate: value?.toString(),
                      });
                    }}
                  />
                  <Location name="locationId" label="Location" />
                  <Shelf
                    name="shelfId"
                    label="Shelf"
                    locationId={initialValues.locationId}
                  />
                  <CustomFormFields table="gauge" />
                </div>
                <div className="border bg-muted/30 rounded-lg p-4 relative w-full">
                  <LuCalendar className="absolute top-2 right-4 text-muted-foreground" />
                  <NumberControlled
                    name="calibrationIntervalInMonths"
                    label="Calibration Interval (Months)"
                    value={calibrationInterval.calibrationIntervalInMonths}
                    onChange={(value) => {
                      setCalibrationInterval({
                        ...calibrationInterval,
                        calibrationIntervalInMonths: value,
                        nextCalibrationDate:
                          calibrationInterval.lastCalibrationDate
                            ? parseDate(calibrationInterval.lastCalibrationDate)
                                .add({
                                  months: value,
                                })
                                .toString()
                            : undefined,
                      });
                    }}
                  />
                </div>
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>Save</Submit>
                {onClose && (
                  <Button size="md" variant="solid" onClick={onClose}>
                    Cancel
                  </Button>
                )}
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default GaugeForm;
