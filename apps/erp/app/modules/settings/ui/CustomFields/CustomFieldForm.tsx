import { SelectControlled, ValidatedForm } from "@carbon/form";
import {
  Button,
  cn,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import {
  LuCalendar,
  LuContainer,
  LuFile,
  LuHash,
  LuList,
  LuSquareUser,
  LuToggleLeft,
  LuType,
  LuUser
} from "react-icons/lu";
import { useParams } from "react-router";
import type { z } from "zod";
import { Array, Boolean, Hidden, Input, Submit, Tags } from "~/components/Form";
import { usePermissions, useRouteData } from "~/hooks";
import type { AttributeDataType } from "~/modules/people";
import { customFieldValidator } from "~/modules/settings";
import { DataType, tablesWithTags } from "~/modules/shared";
import { path } from "~/utils/path";

type CustomFieldFormProps = {
  initialValues: z.infer<typeof customFieldValidator>;
  dataTypes: AttributeDataType[];
  onClose: () => void;
};

const CustomFieldForm = ({
  initialValues,
  dataTypes,
  onClose
}: CustomFieldFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { table } = useParams();
  if (!table) throw new Error("table is not found");

  const routeData = useRouteData<{
    tags: { name: string }[];
  }>(path.to.customFieldsTable(table));

  const options =
    dataTypes?.map((dt) => ({
      value: dt.id.toString(),
      label: (
        <HStack className="w-full">
          <CustomFieldDataTypeIcon type={dt.id} className="mr-2" />
          {dt.label}
        </HStack>
      )
    })) ?? [];

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "resources")
    : !permissions.can("create", "resources");

  const [dataType, setDataType] = useState<string>(
    initialValues.dataTypeId.toString()
  );
  const isList = Number(dataType) === DataType.List;

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
            <DrawerTitle>
              {isEditing ? (
                <Trans>Edit Custom Field</Trans>
              ) : (
                <Trans>New Custom Field</Trans>
              )}
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />
            <VStack spacing={4}>
              <Input name="name" label={t`Name`} />
              <Hidden name="table" />

              <SelectControlled
                name="dataTypeId"
                label={t`Data Type`}
                isReadOnly={isEditing}
                helperText={
                  isEditing ? t`Data type cannot be changed` : undefined
                }
                options={options}
                value={dataType.toString()}
                onChange={(option) => {
                  if (option) {
                    setDataType(option.value);
                  }
                }}
              />
              {isList && <Array name="listOptions" label={t`List Options`} />}

              {tablesWithTags.includes(table) && (
                <Tags
                  table={table}
                  name="tags"
                  availableTags={routeData?.tags ?? []}
                  helperText={t`These custom fields will only be available for entities with the same tags`}
                />
              )}

              <Boolean name="required" label={t`Required`} />
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Submit withBlocker={false} isDisabled={isDisabled}>
                <Trans>Save</Trans>
              </Submit>
              <Button size="md" variant="solid" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
};

export default CustomFieldForm;

function CustomFieldDataTypeIcon({
  type,
  className
}: {
  type: DataType;
  className?: string;
}) {
  switch (type) {
    case DataType.Numeric:
      return <LuHash className={cn("w-4 h-4 text-blue-600", className)} />;
    case DataType.Text:
      return <LuType className={cn("w-4 h-4 text-emerald-600", className)} />;
    case DataType.Boolean:
      return (
        <LuToggleLeft className={cn("w-4 h-4 text-purple-600", className)} />
      );
    case DataType.List:
      return <LuList className={cn("w-4 h-4 text-orange-600", className)} />;
    case DataType.Date:
      return <LuCalendar className={cn("w-4 h-4 text-red-600", className)} />;
    case DataType.User:
      return <LuUser className={cn("w-4 h-4 text-yellow-600", className)} />;
    case DataType.Customer:
      return (
        <LuSquareUser className={cn("w-4 h-4 text-foreground", className)} />
      );
    case DataType.Supplier:
      return (
        <LuContainer className={cn("w-4 h-4 text-emerald-600", className)} />
      );
    case DataType.File:
      return <LuFile className={cn("w-4 h-4 text-indigo-600", className)} />;
    default:
      return null;
  }
}
