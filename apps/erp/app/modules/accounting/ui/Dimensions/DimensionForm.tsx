import { SelectControlled, ValidatedForm } from "@carbon/form";
import {
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
import { Array, Boolean, Hidden, Input, Submit } from "~/components/Form";
import { DimensionEntityTypeIcon } from "~/components/Icons";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import {
  dimensionEntityTypes,
  dimensionValidator
} from "../../accounting.models";

type DimensionFormProps = {
  initialValues: z.infer<typeof dimensionValidator>;
  onClose: () => void;
};

const entityTypeLabels: Record<string, string> = {
  Custom: "Custom",
  Location: "Location",
  ItemPostingGroup: "Item Group",
  SupplierType: "Supplier Type",
  CustomerType: "Customer Type",
  Department: "Department",
  Employee: "Employee",
  FixedAssetClass: "Asset Class",
  CostCenter: "Cost Center"
};

const DimensionForm = ({ initialValues, onClose }: DimensionFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "accounting")
    : !permissions.can("create", "accounting");

  const [entityType, setEntityType] = useState<string>(
    initialValues.entityType
  );
  const isCustom = entityType === "Custom";

  const entityTypeOptions = dimensionEntityTypes.map((et) => ({
    value: et,
    label: (
      <HStack className="w-full">
        <DimensionEntityTypeIcon entityType={et} className="w-4 h-4 mr-2" />
        {entityTypeLabels[et]}
      </HStack>
    )
  }));

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent>
        <ValidatedForm
          validator={dimensionValidator}
          method="post"
          action={
            isEditing
              ? path.to.dimension(initialValues.id!)
              : path.to.newDimension
          }
          defaultValues={initialValues}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>
              {isEditing ? (
                <Trans>Edit Dimension</Trans>
              ) : (
                <Trans>New Dimension</Trans>
              )}
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />
            <VStack spacing={4}>
              <Input name="name" label={t`Name`} />
              <SelectControlled
                name="entityType"
                label={t`Entity Type`}
                termId="dimension-entity-type"
                isReadOnly={isEditing}
                helperText={
                  isEditing ? t`Entity type cannot be changed` : undefined
                }
                options={entityTypeOptions}
                value={entityType}
                onChange={(option) => {
                  if (option) {
                    setEntityType(option.value);
                  }
                }}
              />
              {isCustom && (
                <Array
                  name="dimensionValues"
                  label={t`Values`}
                  termId="dimension-values"
                />
              )}
              <Boolean name="active" label={t`Active`} />
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Submit isDisabled={isDisabled}>
                <Trans>Save</Trans>
              </Submit>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
};

export default DimensionForm;
