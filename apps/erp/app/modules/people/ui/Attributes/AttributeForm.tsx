import { ValidatedForm } from "@carbon/form";
import {
  Button,
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
import type { z } from "zod";
import {
  Array,
  Boolean,
  Hidden,
  Input,
  Select,
  Submit
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { DataType } from "~/modules/shared";
import { path } from "~/utils/path";
import { attributeValidator } from "../../people.models";

type AttributeFormProps = {
  initialValues: z.infer<typeof attributeValidator>;
  dataTypes: {
    id: number;
    label: string;
    isBoolean: boolean;
    isDate: boolean;
    isList: boolean;
    isNumeric: boolean;
    isText: boolean;
    isFile: boolean;
  }[];
  onClose: () => void;
};

const AttributeForm = ({
  initialValues,
  dataTypes,
  onClose
}: AttributeFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();

  const options =
    dataTypes?.map((dt) => ({
      value: dt.id.toString(),
      label: dt.label
    })) ?? [];

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "people")
    : !permissions.can("create", "people");

  const [isList, setIsList] = useState(
    initialValues.attributeDataTypeId === DataType.List
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
          validator={attributeValidator}
          method="post"
          action={
            isEditing
              ? path.to.attribute(initialValues.id!)
              : path.to.newAttribute
          }
          defaultValues={initialValues}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>
              {isEditing ? (
                <Trans>Edit Attribute</Trans>
              ) : (
                <Trans>New Attribute</Trans>
              )}
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />
            <VStack spacing={4}>
              <Input name="name" label={t`Name`} />
              <Hidden name="userAttributeCategoryId" />

              <Select
                name="attributeDataTypeId"
                label={t`Data Type`}
                termId="attribute-data-type"
                isReadOnly={isEditing}
                helperText={
                  isEditing ? t`Data type cannot be changed` : undefined
                }
                options={options}
                onChange={onChangeCheckForListType}
              />
              {isList && (
                <Array
                  name="listOptions"
                  label={t`List Options`}
                  termId="attribute-list-options"
                />
              )}
              <Boolean
                name="canSelfManage"
                label={t`Self Managed`}
                termId="attribute-self-managed"
                description={t`Users can update this value for themselves`}
              />
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Button size="md" variant="solid" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
              <Submit withBlocker={false} isDisabled={isDisabled}>
                <Trans>Save</Trans>
              </Submit>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
};

export default AttributeForm;
