import { DatePicker, Select, ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  VStack,
} from "@carbon/react";
import type { z } from "zod";
import { Enumerable } from "~/components/Enumerable";
import {
  CustomFormFields,
  Hidden,
  Input,
  Location,
  SequenceOrCustomId,
  Shelf,
  Submit,
  Supplier,
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import type { ListItem } from "~/types";
import { gaugeRole, gaugeValidator } from "../../quality.models";
import { GaugeRole } from "./GaugeStatus";

type GaugeFormValues = z.infer<typeof gaugeValidator>;

type GaugeFormProps = {
  initialValues: GaugeFormValues;
  gaugeTypes: ListItem[];
};

const GaugeForm = ({ initialValues, gaugeTypes }: GaugeFormProps) => {
  const permissions = usePermissions();
  const isEditing = initialValues.id !== undefined;

  return (
    <Card>
      <ValidatedForm
        method="post"
        validator={gaugeValidator}
        defaultValues={initialValues}
        className="w-full"
      >
        <CardHeader>
          <CardTitle>{isEditing ? "Gauge" : "New Gauge"}</CardTitle>
          {!isEditing && (
            <CardDescription>
              A gauge record tracks measurement tools and their calibration
              status.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <Hidden name="id" />

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
              />
              <DatePicker
                name="nextCalibrationDate"
                label="Next Calibration Date"
              />
              <Location name="locationId" label="Location" />
              <Shelf
                name="shelfId"
                label="Shelf"
                locationId={initialValues.locationId}
              />
              <CustomFormFields table="gauge" />
            </div>
          </VStack>
        </CardContent>
        <CardFooter>
          <Submit
            isDisabled={
              isEditing
                ? !permissions.can("update", "quality")
                : !permissions.can("create", "quality")
            }
          >
            Save
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default GaugeForm;
