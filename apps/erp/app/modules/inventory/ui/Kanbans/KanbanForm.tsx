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
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import type { z } from "zod";
import { Enumerable } from "~/components/Enumerable";
import {
  ConversionFactor,
  Item,
  Location,
  Number,
  SequenceOrCustomId,
  StorageUnit,
  Submit,
  Supplier,
  UnitOfMeasure
} from "~/components/Form";
import { useUser } from "~/hooks";
import type { MethodItemType } from "~/modules/shared/types";
import {
  kanbanValidator,
  replenishmentSystemTypes
} from "../../inventory.models";

type KanbanFormValues = z.infer<typeof kanbanValidator>;

type KanbanFormProps = {
  initialValues: KanbanFormValues;
  locationId?: string;
  onClose: () => void;
};

const KanbanForm = ({ initialValues, onClose }: KanbanFormProps) => {
  const { t } = useLingui();
  const [selectedReplenishmentSystem, setSelectedReplenishmentSystem] =
    useState<string>(initialValues.replenishmentSystem || "Buy");

  const isEditing = !!initialValues.id;

  const [storageUnitId, setStorageUnitId] = useState<string | null>(
    initialValues.storageUnitId || null
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

    const [item, storageUnit] = await Promise.all([
      carbon
        .from("item")
        .select("replenishmentSystem, unitOfMeasureCode")
        .eq("id", value.value)
        .single(),
      carbon
        .from("pickMethod")
        .select("defaultStorageUnitId")
        .eq("itemId", value.value)
        .eq("companyId", company.id)
        .eq("locationId", locationId)
        .maybeSingle()
    ]);
    if (item.error) {
      toast.error(t`Failed to load item details`);
      return;
    }
    setSelectedReplenishmentSystem(item.data?.replenishmentSystem || "Buy");
    if (storageUnit.data?.defaultStorageUnitId) {
      setStorageUnitId(storageUnit.data.defaultStorageUnitId);
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

  const [autoRelease, setAutoRelease] = useState<boolean>(
    initialValues.autoRelease || false
  );
  const [autoStartJob, setAutoStartJob] = useState<boolean>(
    initialValues.autoStartJob || false
  );

  const onLocationChange = (value: { value: string } | null) => {
    setLocationId(value?.value || "");
    setStorageUnitId(null);
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
              {isEditing ? t`Edit Kanban` : t`New Kanban`}
            </DrawerTitle>
            <DrawerDescription>
              {isEditing
                ? t`Update the kanban information for scan-based replenishment.`
                : t`Create a new kanban card for scan-based replenishment.`}
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
                  label={t`Item`}
                  type={itemType}
                  locationId={locationId || undefined}
                  onTypeChange={(t) => setItemType(t as MethodItemType)}
                  onChange={onItemChange}
                  isReadOnly={isEditing}
                />

                <Number
                  name="quantity"
                  label={t`Quantity`}
                  minValue={1}
                  helperText={t`The quantity of the item to be reordered on scan-based replenishment.`}
                />

                <SelectControlled
                  value={selectedReplenishmentSystem}
                  name="replenishmentSystem"
                  label={t`Replenishment System`}
                  termId="replenishment-system"
                  onChange={(value) => {
                    if (value) {
                      setSelectedReplenishmentSystem(value.value);
                    }
                  }}
                  options={replenishmentSystemTypes
                    .filter((type) => type !== "Buy and Make")
                    .map((type) => ({
                      value: type,
                      label: <Enumerable value={type} />
                    }))}
                />

                {selectedReplenishmentSystem === "Buy" && (
                  <>
                    <Supplier
                      name="supplierId"
                      label={t`Supplier`}
                      value={supplierId}
                      onChange={onSupplierChange}
                    />

                    <UnitOfMeasure
                      name="purchaseUnitOfMeasureCode"
                      label={t`Purchase Unit of Measure`}
                      termId="purchase-unit-of-measure"
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
                      label={t`Conversion Factor`}
                      termId="conversion-factor"
                      inventoryCode={inventoryUnitOfMeasureCode}
                      purchasingCode={purchaseUnitOfMeasureCode}
                      value={conversionFactor}
                      onChange={setConversionFactor}
                      helperText={t`Number of inventory units per purchase unit`}
                    />
                  </>
                )}

                <Location
                  name="locationId"
                  label={t`Location`}
                  onChange={onLocationChange}
                  isReadOnly={isEditing}
                />

                <StorageUnit
                  name="storageUnitId"
                  label={t`Storage Unit`}
                  locationId={locationId}
                  value={storageUnitId ?? undefined}
                  onChange={(value) => {
                    if (value) setStorageUnitId(value?.id ?? null);
                  }}
                />

                {selectedReplenishmentSystem === "Make" && (
                  <>
                    <Boolean
                      name="autoRelease"
                      label={t`Auto Release`}
                      termId="kanban-auto-release"
                      value={autoRelease}
                      onChange={(value) => {
                        setAutoRelease(value);
                        if (!value) {
                          setAutoStartJob(false);
                        }
                      }}
                      description={t`Automatically release the job when the kanban is scanned`}
                    />
                    <Boolean
                      name="autoStartJob"
                      label={t`Auto Start Job`}
                      termId="kanban-auto-start-job"
                      value={autoStartJob}
                      onChange={setAutoStartJob}
                      isDisabled={!autoRelease}
                      description={
                        autoRelease
                          ? t`Automatically start the job when the kanban is scanned`
                          : t`Auto release must be enabled to start a job automatically`
                      }
                    />
                    <SequenceOrCustomId
                      name="completedBarcodeOverride"
                      label={t`Completion Barcode`}
                      termId="kanban-completion-barcode"
                      table="kanban"
                      placeholder={t`Auto-generated QR Code`}
                    />
                  </>
                )}
              </div>
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Button type="button" variant="ghost" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
              <Submit withBlocker={false}>
                {isEditing ? (
                  <Trans>Update Kanban</Trans>
                ) : (
                  <Trans>Create Kanban</Trans>
                )}
              </Submit>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
};

export default KanbanForm;
