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
  VStack,
} from "@carbon/react";
import { useNavigate, useParams } from "@remix-run/react";
import { useState } from "react";
import type { z } from "zod";
import {
  ConversionFactor,
  CustomFormFields,
  Hidden,
  Input,
  Number,
  Submit,
  Supplier,
  UnitOfMeasure,
} from "~/components/Form";
import { usePermissions, useRouteData } from "~/hooks";
import type { PartSummary } from "~/modules/items";
import { buyMethodValidator } from "~/modules/items";
import { path } from "~/utils/path";

type BuyMethodFormProps = {
  initialValues: z.infer<typeof buyMethodValidator>;
  type: "Part" | "Service" | "Tool" | "Consumable" | "Material" | "Fixture";
};

const BuyMethodForm = ({ initialValues, type }: BuyMethodFormProps) => {
  const permissions = usePermissions();
  const navigate = useNavigate();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const routeData = useRouteData<{ partSummary: PartSummary }>(
    path.to.part(itemId)
  );
  const [purchaseUnitOfMeasure, setPurchaseUnitOfMeasure] = useState<
    string | undefined
  >(initialValues.supplierUnitOfMeasureCode);

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "parts")
    : !permissions.can("create", "parts");

  const onClose = () => navigate(-1);

  const action = getAction(isEditing, type, itemId, initialValues.id);

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent>
        <ValidatedForm
          defaultValues={initialValues}
          validator={buyMethodValidator}
          method="post"
          action={action}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>{isEditing ? "Edit" : "New"} Buy Method</DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />
            <Hidden name="itemId" />

            <VStack spacing={4}>
              <Supplier name="supplierId" label="Supplier" />
              <Input name="supplierPartId" label="Supplier Part ID" />
              <Number name="unitPrice" label="Unit Price" minValue={0} />
              <UnitOfMeasure
                name="supplierUnitOfMeasureCode"
                label="Unit of Measure"
                onChange={(value) => {
                  if (value) setPurchaseUnitOfMeasure(value.value);
                }}
              />
              <ConversionFactor
                name="conversionFactor"
                label="Conversion Factor"
                inventoryCode={
                  routeData?.partSummary?.unitOfMeasureCode ?? undefined
                }
                purchasingCode={purchaseUnitOfMeasure}
              />
              <Number
                name="minimumOrderQuantity"
                label="Minimum Order Quantity"
                minValue={0}
              />
              <CustomFormFields table="partSupplier" />
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

export default BuyMethodForm;

function getAction(
  isEditing: boolean,
  type: "Part" | "Service" | "Tool" | "Consumable" | "Material" | "Fixture",
  itemId: string,
  id?: string
) {
  if (type === "Part") {
    if (isEditing) {
      return path.to.partSupplier(itemId, id!);
    } else {
      return path.to.newPartSupplier(itemId);
    }
  }
  if (type === "Service") {
    if (isEditing) {
      return path.to.serviceSupplier(itemId, id!);
    } else {
      return path.to.newServiceSupplier(itemId);
    }
  }

  if (type === "Tool") {
    if (isEditing) {
      return path.to.toolSupplier(itemId, id!);
    } else {
      return path.to.newToolSupplier(itemId);
    }
  }

  if (type === "Consumable") {
    if (isEditing) {
      return path.to.consumableSupplier(itemId, id!);
    } else {
      return path.to.newConsumableSupplier(itemId);
    }
  }

  if (type === "Material") {
    if (isEditing) {
      return path.to.materialSupplier(itemId, id!);
    } else {
      return path.to.newMaterialSupplier(itemId);
    }
  }

  if (type === "Fixture") {
    if (isEditing) {
      return path.to.fixtureSupplier(itemId, id!);
    } else {
      return path.to.newFixtureSupplier(itemId);
    }
  }

  throw new Error("Invalid type");
}
