import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  FormControl,
  FormLabel,
  HStack,
  Input,
  VStack,
} from "@carbon/react";

import { ValidatedForm } from "@carbon/remix-validated-form";
import { useFetcher, useNavigate, useParams } from "@remix-run/react";
import { useEffect, useMemo, useState } from "react";
import type { z } from "zod";
import {
  Account,
  ComboboxControlled,
  ConversionFactor,
  CustomFormFields,
  Hidden,
  Item,
  NumberControlled,
  Select,
  Submit,
  UnitOfMeasure,
} from "~/components/Form";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import { useSupabase } from "~/lib/supabase";
import type {
  PurchaseInvoice,
  PurchaseInvoiceLineType,
} from "~/modules/invoicing";
import {
  purchaseInvoiceLineType,
  purchaseInvoiceLineValidator,
} from "~/modules/invoicing";
import type { getShelvesList } from "~/modules/parts";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";

type PurchaseInvoiceLineFormProps = {
  initialValues: z.infer<typeof purchaseInvoiceLineValidator>;
};

const PurchaseInvoiceLineForm = ({
  initialValues,
}: PurchaseInvoiceLineFormProps) => {
  const permissions = usePermissions();
  const { supabase } = useSupabase();
  const navigate = useNavigate();
  const { company, defaults } = useUser();
  const { invoiceId } = useParams();

  if (!invoiceId) throw new Error("invoiceId not found");

  const routeData = useRouteData<{
    locations: ListItem[];
    purchaseInvoice: PurchaseInvoice;
  }>(path.to.purchaseInvoice(invoiceId));

  const locations = routeData?.locations ?? [];
  const locationOptions = locations.map((location) => ({
    label: location.name,
    value: location.id,
  }));

  const isEditable = ["Draft"].includes(
    routeData?.purchaseInvoice?.status ?? ""
  );

  const [type, setType] = useState(initialValues.invoiceLineType);
  const [locationId, setLocationId] = useState(defaults.locationId ?? "");
  const [itemData, setItemData] = useState<{
    itemId: string;
    itemReadableId: string;
    description: string;
    quantity: number;
    unitPrice: number;
    purchaseUom: string;
    inventoryUom: string;
    conversionFactor: number;
    shelfId: string | null;
    minimumOrderQuantity?: number;
  }>({
    itemId: initialValues.itemId ?? "",
    itemReadableId: initialValues.itemReadableId ?? "",
    description: initialValues.description ?? "",
    quantity: initialValues.quantity ?? 1,
    unitPrice: initialValues.unitPrice ?? 0,
    purchaseUom: initialValues.purchaseUnitOfMeasureCode ?? "",
    inventoryUom: initialValues.inventoryUnitOfMeasureCode ?? "",
    conversionFactor: initialValues.conversionFactor ?? 1,
    shelfId: initialValues.shelfId ?? "",
    minimumOrderQuantity: undefined,
  });

  const shelfFetcher = useFetcher<Awaited<ReturnType<typeof getShelvesList>>>();

  useEffect(() => {
    if (locationId) {
      shelfFetcher.load(path.to.api.shelves(locationId));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId]);

  const shelfOptions = useMemo(
    () =>
      shelfFetcher.data?.data?.map((shelf) => ({
        label: shelf.id,
        value: shelf.id,
      })) ?? [],
    [shelfFetcher.data]
  );

  const isEditing = initialValues.id !== undefined;
  const isDisabled = !isEditable
    ? true
    : isEditing
    ? !permissions.can("update", "purchasing")
    : !permissions.can("create", "purchasing");

  const purchaseInvoiceLineTypeOptions = purchaseInvoiceLineType.map(
    (type) => ({
      label: type,
      value: type,
    })
  );

  const onClose = () => navigate(-1);

  const onTypeChange = (type: PurchaseInvoiceLineType) => {
    setType(type);
    setItemData({
      itemId: "",
      itemReadableId: "",
      description: "",
      quantity: 1,
      unitPrice: 0,
      inventoryUom: "",
      purchaseUom: "",
      conversionFactor: 1,
      shelfId: "",
      minimumOrderQuantity: undefined,
    });
  };

  const onItemChange = async (itemId: string) => {
    if (!supabase) throw new Error("Supabase client not found");
    switch (type) {
      case "Part":
        const [item, part, itemSupplier, inventory] = await Promise.all([
          supabase
            .from("item")
            .select(
              "name, readableId, itemCost(unitCost), itemReplenishment(purchasingUnitOfMeasureCode, conversionFactor, purchasingLeadTime)"
            )
            .eq("id", itemId)
            .eq("companyId", company.id)
            .single(),
          supabase
            .from("part")
            .select("unitOfMeasureCode")
            .eq("itemId", itemId)
            .eq("companyId", company.id)
            .single(),
          supabase
            .from("itemSupplier")
            .select("*")
            .eq("itemId", itemId)
            .eq("companyId", company.id)
            .eq("supplierId", routeData?.purchaseInvoice.supplierId!)
            .maybeSingle(),
          supabase
            .from("itemInventory")
            .select("defaultShelfId")
            .eq("itemId", itemId)
            .eq("companyId", company.id)
            .eq("locationId", locationId!)
            .maybeSingle(),
        ]);

        const itemCost = item?.data?.itemCost?.[0];
        const itemReplenishment = item?.data?.itemReplenishment?.[0];

        setItemData({
          itemId: itemId,
          itemReadableId: item.data?.readableId ?? "",
          description: item.data?.name ?? "",
          quantity: itemSupplier?.data?.minimumOrderQuantity ?? 1,
          unitPrice: itemSupplier?.data?.unitPrice ?? itemCost?.unitCost ?? 0,
          purchaseUom:
            itemReplenishment?.purchasingUnitOfMeasureCode ??
            part.data?.unitOfMeasureCode ??
            "EA",
          inventoryUom: part.data?.unitOfMeasureCode ?? "EA",

          conversionFactor: itemReplenishment?.conversionFactor ?? 1,
          shelfId: inventory.data?.defaultShelfId ?? null,
        });

        break;
      case "Service":
        const service = await supabase
          .from("item")
          .select("readableId, name")
          .eq("id", itemId)
          .eq("companyId", company.id)
          .single();

        setItemData({
          itemId: itemId,
          itemReadableId: service.data?.readableId ?? "",
          description: service.data?.name ?? "",
          quantity: 1,
          unitPrice: 0,
          purchaseUom: "EA",
          inventoryUom: "EA",
          conversionFactor: 1,
          shelfId: "",
          minimumOrderQuantity: undefined,
        });

        break;
      default:
        throw new Error(
          `Invalid invoice line type: ${type} is not implemented`
        );
    }
  };

  const onLocationChange = async (newLocation: { value: string } | null) => {
    if (!supabase) throw new Error("supabase is not defined");
    if (typeof newLocation?.value !== "string")
      throw new Error("locationId is not a string");

    setLocationId(newLocation.value);
    if (!itemData.itemId) return;
    const shelf = await supabase
      .from("itemInventory")
      .select("defaultShelfId")
      .eq("itemId", itemData.itemId)
      .eq("companyId", company.id)
      .eq("locationId", newLocation.value)
      .maybeSingle();

    setItemData((d) => ({
      ...d,
      shelfId: shelf?.data?.defaultShelfId ?? "",
    }));
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
          defaultValues={initialValues}
          validator={purchaseInvoiceLineValidator}
          method="post"
          action={
            isEditing
              ? path.to.purchaseInvoiceLine(invoiceId, initialValues.id!)
              : path.to.newPurchaseInvoiceLine(invoiceId)
          }
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>
              {isEditing ? "Edit" : "New"} Purchase Invoice Line
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />
            <Hidden name="invoiceId" />
            <Hidden name="description" value={itemData.description} />
            <Hidden
              name="inventoryUnitOfMeasureCode"
              value={itemData?.inventoryUom}
            />
            <VStack spacing={4}>
              <Select
                name="invoiceLineType"
                label="Type"
                options={purchaseInvoiceLineTypeOptions}
                onChange={(value) => {
                  onTypeChange(value?.value as PurchaseInvoiceLineType);
                }}
              />
              {[
                "Part",
                "Service",
                "Material",
                "Tool",
                "Fixture",
                "Hardware",
                "Consumable",
              ].includes(type) && (
                <Item
                  name="itemId"
                  label={type}
                  // @ts-ignore
                  type={type}
                  onChange={(value) => {
                    onItemChange(value?.value as string);
                  }}
                />
              )}

              {type === "G/L Account" && (
                <Account
                  name="accountNumber"
                  label="Account"
                  classes={["Expense", "Asset"]}
                  onChange={(value) => {
                    setItemData({
                      itemId: "",
                      itemReadableId: "",
                      description: value?.label ?? "",
                      quantity: 1,
                      unitPrice: 0,
                      purchaseUom: "EA",
                      inventoryUom: "EA",
                      conversionFactor: 1,
                      shelfId: "",
                      minimumOrderQuantity: 0,
                    });
                  }}
                />
              )}
              {type === "Fixed Asset" && (
                // TODO: implement Fixed Asset
                <Select name="assetId" label="Asset" options={[]} />
              )}
              <FormControl>
                <FormLabel>Description</FormLabel>
                <Input
                  value={itemData.description}
                  onChange={(e) =>
                    setItemData((d) => ({ ...d, description: e.target.value }))
                  }
                />
              </FormControl>
              {type !== "Comment" && (
                <>
                  <NumberControlled
                    minValue={itemData.minimumOrderQuantity}
                    name="quantity"
                    label="Quantity"
                    value={itemData.quantity}
                    onChange={(value) => {
                      setItemData((d) => ({
                        ...d,
                        quantity: value,
                      }));
                    }}
                  />
                  <NumberControlled
                    name="unitPrice"
                    label="Unit Price"
                    value={itemData.unitPrice}
                    onChange={(value) =>
                      setItemData((d) => ({
                        ...d,
                        unitPrice: value,
                      }))
                    }
                  />

                  {["Part", "Material", "Hardware"] && (
                    <>
                      <UnitOfMeasure
                        name="purchaseUnitOfMeasureCode"
                        label="Unit of Measure"
                        value={itemData.purchaseUom}
                        onChange={(newValue) => {
                          if (newValue) {
                            setItemData((d) => ({
                              ...d,
                              purchaseUom: newValue?.value as string,
                            }));
                          }
                        }}
                      />
                      <ConversionFactor
                        name="conversionFactor"
                        purchasingCode={itemData.purchaseUom}
                        inventoryCode={itemData.inventoryUom}
                        value={itemData.conversionFactor}
                        onChange={(value) => {
                          setItemData((d) => ({
                            ...d,
                            conversionFactor: value,
                          }));
                        }}
                      />
                    </>
                  )}

                  {[
                    "Part",
                    "Service",
                    "Material",
                    "Tool",
                    "Fixture",
                    "Hardware",
                    "Consumable",
                    "Fixed Asset",
                  ].includes(type) && (
                    <ComboboxControlled
                      name="locationId"
                      label="Location"
                      options={locationOptions}
                      value={locationId}
                      onChange={onLocationChange}
                    />
                  )}
                  {[
                    "Part",
                    "Service",
                    "Material",
                    "Tool",
                    "Fixture",
                    "Hardware",
                    "Consumable",
                    "Fixed Asset",
                  ].includes(type) && (
                    <ComboboxControlled
                      name="shelfId"
                      label="Shelf"
                      options={shelfOptions}
                      value={itemData.shelfId ?? ""}
                      onChange={(newValue) => {
                        if (newValue) {
                          setItemData((d) => ({
                            ...d,
                            shelfId: newValue.value,
                          }));
                        }
                      }}
                    />
                  )}
                </>
              )}
              <CustomFormFields table="purchaseInvoiceLine" />
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

export default PurchaseInvoiceLineForm;
