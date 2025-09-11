import { useCarbon } from "@carbon/auth";
import { Boolean, Hidden, SelectControlled, ValidatedForm } from "@carbon/form";
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  toast,
  VStack,
} from "@carbon/react";
import { useState } from "react";
import type { z } from "zod";
import { Enumerable } from "~/components/Enumerable";
import {
  ConversionFactor,
  Item,
  Location,
  Number,
  Shelf,
  Submit,
  Supplier,
  UnitOfMeasure,
} from "~/components/Form";
import { useUser } from "~/hooks";
import type { MethodItemType } from "~/modules/shared/types";
import {
  kanbanValidator,
  replenishmentSystemTypes,
} from "../../inventory.models";

type KanbanFormValues = z.infer<typeof kanbanValidator>;

type KanbanFormProps = {
  initialValues: KanbanFormValues;
  locationId?: string;
  onClose: () => void;
};

const KanbanForm = ({ initialValues, onClose }: KanbanFormProps) => {
  const [selectedReplenishmentSystem, setSelectedReplenishmentSystem] =
    useState<string>(initialValues.replenishmentSystem || "Buy");

  const isEditing = !!initialValues.id;

  const [shelfId, setShelfId] = useState<string | null>(
    initialValues.shelfId || null
  );
  const [itemType, setItemType] = useState<MethodItemType | "Item">("Item");
  const [itemId, setItemId] = useState<string>(initialValues.itemId || "");

  const [supplierId, setSupplierId] = useState<string>(
    initialValues.supplierId || ""
  );
  const [purchaseUnitOfMeasureCode, setPurchaseUnitOfMeasureCode] =
    useState<string>(initialValues.purchaseUnitOfMeasureCode || "");
  const [inventoryUnitOfMeasureCode, setInventoryUnitOfMeasureCode] =
    useState<string>("");
  const [conversionFactor, setConversionFactor] = useState<number>(
    initialValues.conversionFactor || 1
  );

  const { carbon } = useCarbon();
  const { company } = useUser();

  const onItemChange = async (value: { value: string } | null) => {
    if (!carbon || !value) return;

    setItemId(value.value);

    const [item, shelf] = await Promise.all([
      carbon
        .from("item")
        .select("replenishmentSystem, unitOfMeasureCode")
        .eq("id", value.value)
        .single(),
      carbon
        .from("pickMethod")
        .select("defaultShelfId")
        .eq("itemId", value.value)
        .eq("companyId", company.id)
        .eq("locationId", locationId)
        .maybeSingle(),
    ]);
    if (item.error) {
      toast.error("Failed to load item details");
      return;
    }
    setSelectedReplenishmentSystem(item.data?.replenishmentSystem || "Buy");
    if (shelf.data?.defaultShelfId) {
      setShelfId(shelf.data.defaultShelfId);
    }

    // Set inventory unit of measure from item
    const itemUnitOfMeasure = item.data?.unitOfMeasureCode || "";
    setInventoryUnitOfMeasureCode(itemUnitOfMeasure);

    // If there's no supplier selected, set purchase unit to match inventory unit
    if (!supplierId) {
      setPurchaseUnitOfMeasureCode(itemUnitOfMeasure);
      setConversionFactor(1);
    } else {
      // If there's a supplier, look up supplier part for this item/supplier combo
      const supplierPart = await carbon
        .from("supplierPart")
        .select("supplierUnitOfMeasureCode, conversionFactor")
        .eq("itemId", value.value)
        .eq("supplierId", supplierId)
        .eq("companyId", company.id)
        .maybeSingle();

      if (supplierPart.data) {
        setPurchaseUnitOfMeasureCode(
          supplierPart.data.supplierUnitOfMeasureCode || itemUnitOfMeasure
        );
        setConversionFactor(supplierPart.data.conversionFactor || 1);
      } else {
        setPurchaseUnitOfMeasureCode(itemUnitOfMeasure);
        setConversionFactor(1);
      }
    }
  };

  const onSupplierChange = async (value: { value: string } | null) => {
    setSupplierId(value?.value || "");

    // If we have both item and supplier, look up supplier part
    if (carbon && value?.value && itemId) {
      const supplierPart = await carbon
        .from("supplierPart")
        .select("supplierUnitOfMeasureCode, conversionFactor")
        .eq("itemId", itemId)
        .eq("supplierId", value.value)
        .eq("companyId", company.id)
        .maybeSingle();

      if (supplierPart.data) {
        setPurchaseUnitOfMeasureCode(
          supplierPart.data.supplierUnitOfMeasureCode ||
            inventoryUnitOfMeasureCode
        );
        setConversionFactor(supplierPart.data.conversionFactor || 1);
      }
    } else if (!value?.value) {
      // If supplier is cleared, reset to inventory unit of measure
      setPurchaseUnitOfMeasureCode(inventoryUnitOfMeasureCode);
      setConversionFactor(1);
    }
  };

  const [locationId, setLocationId] = useState<string>(
    initialValues.locationId || ""
  );
  const onLocationChange = (value: { value: string } | null) => {
    setLocationId(value?.value || "");
    setShelfId(null);
  };

  return (
    <Drawer open onOpenChange={onClose}>
      <DrawerContent>
        <ValidatedForm
          method="post"
          validator={kanbanValidator}
          defaultValues={initialValues}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>
              {isEditing ? "Edit Kanban" : "New Kanban"}
            </DrawerTitle>
            <DrawerDescription>
              {isEditing
                ? "Update the kanban information for scan-based replenishment."
                : "Create a new kanban card for scan-based replenishment."}
            </DrawerDescription>
          </DrawerHeader>
          <DrawerBody>
            {isEditing && <Hidden name="id" value={initialValues.id} />}
            {selectedReplenishmentSystem === "Make" && (
              <Hidden
                name="purchaseUnitOfMeasureCode"
                value={purchaseUnitOfMeasureCode}
              />
            )}
            <VStack spacing={4}>
              <div className="grid grid-cols-1 gap-4 w-full">
                <Item
                  name="itemId"
                  label="Item"
                  type={itemType}
                  onTypeChange={(t) => setItemType(t as MethodItemType)}
                  onChange={onItemChange}
                  isReadOnly={isEditing}
                />

                <Number
                  name="quantity"
                  label="Quantity"
                  minValue={1}
                  helperText="The quantity of the item to be reordered on scan-based replenishment."
                />

                <SelectControlled
                  value={selectedReplenishmentSystem}
                  name="replenishmentSystem"
                  label="Replenishment System"
                  onChange={(value) => {
                    if (value) {
                      setSelectedReplenishmentSystem(value.value);
                    }
                  }}
                  options={replenishmentSystemTypes
                    .filter((type) => type !== "Buy and Make")
                    .map((type) => ({
                      value: type,
                      label: <Enumerable value={type} />,
                    }))}
                />

                {selectedReplenishmentSystem === "Buy" && (
                  <>
                    <Supplier
                      name="supplierId"
                      label="Supplier"
                      value={supplierId}
                      onChange={onSupplierChange}
                    />

                    <UnitOfMeasure
                      name="purchaseUnitOfMeasureCode"
                      label="Purchase Unit of Measure"
                      value={purchaseUnitOfMeasureCode}
                      onChange={(value) => {
                        if (
                          value &&
                          typeof value === "object" &&
                          "value" in value
                        ) {
                          setPurchaseUnitOfMeasureCode(value.value);
                        } else {
                          setPurchaseUnitOfMeasureCode("");
                        }
                      }}
                    />

                    <ConversionFactor
                      name="conversionFactor"
                      label="Conversion Factor"
                      inventoryCode={inventoryUnitOfMeasureCode}
                      purchasingCode={purchaseUnitOfMeasureCode}
                      value={conversionFactor}
                      onChange={setConversionFactor}
                      helperText="Number of inventory units per purchase unit"
                    />
                  </>
                )}

                <Location
                  name="locationId"
                  label="Location"
                  onChange={onLocationChange}
                  isReadOnly={isEditing}
                />

                <Shelf
                  name="shelfId"
                  label="Shelf"
                  locationId={locationId}
                  value={shelfId ?? undefined}
                  onChange={(value) => {
                    if (value) setShelfId(value?.id ?? null);
                  }}
                />

                {selectedReplenishmentSystem === "Make" && (
                  <Boolean
                    name="autoRelease"
                    label="Auto Release"
                    description={
                      selectedReplenishmentSystem === "Make"
                        ? "Automatically release the job when the kanban is scanned."
                        : undefined
                    }
                  />
                )}
              </div>
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Submit withBlocker={false}>
                {isEditing ? "Update" : "Create"} Kanban
              </Submit>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
};

export default KanbanForm;
