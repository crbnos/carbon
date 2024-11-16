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

import { ValidatedForm } from "@carbon/form";
import { useParams } from "@remix-run/react";
import { useState } from "react";
import type { z } from "zod";
import { Array, Hidden, Input, Select, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import type { AttributeDataType } from "~/modules/people";
import { customFieldValidator } from "~/modules/settings";
import { DataType } from "~/modules/shared";
import { path } from "~/utils/path";

type CustomFieldFormProps = {
  initialValues: z.infer<typeof customFieldValidator>;
  dataTypes: AttributeDataType[];
  onClose: () => void;
};

const CustomFieldForm = ({
  initialValues,
  dataTypes,
  onClose,
}: CustomFieldFormProps) => {
  const permissions = usePermissions();
  const { table } = useParams();
  if (!table) throw new Error("table is not found");

  const options =
    dataTypes?.map((dt) => ({
      value: dt.id.toString(),
      label: dt.label,
    })) ?? [];

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "resources")
    : !permissions.can("create", "resources");

  const [isList, setIsList] = useState(
    initialValues.dataTypeId.toString() === DataType.List.toString()
  );

  const onChangeCheckForListType = (
    selected: {
      value: string;
      label: string | JSX.Element;
    } | null
  ) => {
    setIsList(
      selected === null ? false : Number(selected.value) === DataType.List
    );
  };

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent>
        <ValidatedForm
          validator={customFieldValidator}
          method="post"
          action={
            isEditing
              ? path.to.customField(table, initialValues.table!)
              : path.to.newCustomField(table)
          }
          defaultValues={initialValues}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>{isEditing ? "Edit" : "New"} Custom Field</DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />
            <VStack spacing={4}>
              <Input name="name" label="Name" />
              <Hidden name="table" />

              <Select
                name="dataTypeId"
                label="Data Type"
                isReadOnly={isEditing}
                helperText={
                  isEditing ? "Data type cannot be changed" : undefined
                }
                options={options}
                onChange={onChangeCheckForListType}
              />
              {isList && <Array name="listOptions" label="List Options" />}
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

export default CustomFieldForm;
