import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  FormControl,
  FormErrorMessage,
  FormLabel,
  HStack,
  VStack,
} from "@carbon/react";
import {
  ValidatedForm,
  useControlField,
  useField,
} from "@carbon/remix-validated-form";
import { useFetcher } from "@remix-run/react";
import { useEffect, useMemo, useState } from "react";
import type { z } from "zod";
import {
  CustomFormFields,
  Hidden,
  Input,
  Location,
  Number,
  Select,
  Submit,
  TextArea,
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import type { getWorkCellList } from "~/modules/resources";
import { equipmentValidator } from "~/modules/resources";
import { path } from "~/utils/path";

type EquipmentFormProps = {
  initialValues: z.infer<typeof equipmentValidator>;
  equipmentTypes: {
    id: string;
    name: string;
  }[];
  onClose: () => void;
};

const EquipmentForm = ({
  initialValues,
  equipmentTypes,
  onClose,
}: EquipmentFormProps) => {
  const permissions = usePermissions();

  const options =
    equipmentTypes?.map((et) => ({
      value: et.id,
      label: et.name,
    })) ?? [];

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "resources")
    : !permissions.can("create", "resources");

  const workCellFetcher =
    useFetcher<Awaited<ReturnType<typeof getWorkCellList>>>();
  const [location, setLocation] = useState<string | null>(
    initialValues.locationId ?? null
  );

  const onLocationChange = (location: { value: string } | null) => {
    setLocation((location?.value as string) ?? null);
  };

  useEffect(() => {
    if (location) {
      workCellFetcher.load(path.to.api.workCells(location));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  const workCells = useMemo(
    () =>
      workCellFetcher.data?.data?.map((cell) => ({
        value: cell.id,
        label: cell.name,
      })) ?? [],
    [workCellFetcher.data]
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
          validator={equipmentValidator}
          method="post"
          action={
            isEditing
              ? path.to.equipmentUnit(initialValues.id!)
              : path.to.newEquipmentUnit
          }
          defaultValues={initialValues}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>{isEditing ? "Edit" : "New"} Equipment</DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />
            <VStack spacing={4}>
              <Input name="name" label="Name" />
              <Input name="equipmentId" label="Equipment ID" />
              <TextArea name="description" label="Description" />
              <Select
                name="equipmentTypeId"
                label="Equipment Type"
                options={options}
              />
              <Location
                name="locationId"
                label="Location"
                onChange={onLocationChange}
              />
              <WorkCellsByLocation
                workCells={workCells}
                initialWorkCell={initialValues.workCellId ?? undefined}
              />
              <Number
                name="setupHours"
                label="Setup Hours"
                minValue={0}
                maxValue={100} // this seems like a reasonable max?
              />
              <Number
                name="operatorsRequired"
                label="Operators Required"
                minValue={0}
                maxValue={100} // this seems like a reasonable max?
              />
              <CustomFormFields table="equipment" />
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Submit isDisabled={isDisabled}>Save</Submit>
              <Button size="md" variant="solid" onClick={onClose}>
                Cancel
              </Button>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
};

const WORK_CELL_FIELD = "workCellId";

const WorkCellsByLocation = ({
  workCells,
  initialWorkCell,
}: {
  workCells: { value: string; label: string }[];
  initialWorkCell?: string;
}) => {
  const { error } = useField(WORK_CELL_FIELD);

  const [workCell, setWorkCell] = useControlField<string | null>(
    WORK_CELL_FIELD
  );

  useEffect(() => {
    // if the initial value is in the options, set it, otherwise set to null
    if (workCells) {
      setWorkCell(
        workCells.find((s) => s.value === initialWorkCell)?.value ?? null
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workCells, initialWorkCell]);

  return (
    <FormControl isInvalid={!!error}>
      <FormLabel htmlFor={WORK_CELL_FIELD}>Work Cell</FormLabel>
      <Select
        id={WORK_CELL_FIELD}
        name={WORK_CELL_FIELD}
        options={workCells}
        value={workCell ?? undefined}
        onChange={(newValue) => {
          if (newValue) {
            setWorkCell(newValue.value);
          } else {
            setWorkCell(null);
          }
        }}
        className="w-full"
      />
      {error && <FormErrorMessage>{error}</FormErrorMessage>}
    </FormControl>
  );
};

export default EquipmentForm;
