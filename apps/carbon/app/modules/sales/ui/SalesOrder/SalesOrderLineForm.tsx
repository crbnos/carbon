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

import { ValidatedForm } from "@carbon/remix-validated-form";
import { useFetcher, useNavigate, useParams } from "@remix-run/react";
import { useEffect, useMemo, useState } from "react";
import type { z } from "zod";
import {
  ComboboxControlled,
  CustomFormFields,
  Hidden,
  Item,
  Number,
  NumberControlled,
  Select,
  Submit,
} from "~/components/Form";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import { useSupabase } from "~/lib/supabase";
import type { getShelvesList } from "~/modules/items";
import type { SalesOrder, SalesOrderLineType } from "~/modules/sales";
import { salesOrderLineType, salesOrderLineValidator } from "~/modules/sales";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";

type SalesOrderLineFormProps = {
  initialValues: z.infer<typeof salesOrderLineValidator>;
};

const SalesOrderLineForm = ({ initialValues }: SalesOrderLineFormProps) => {
  const permissions = usePermissions();
  const { supabase } = useSupabase();
  const navigate = useNavigate();
  const { company, defaults } = useUser();
  const { orderId } = useParams();

  if (!orderId) throw new Error("orderId not found");

  const routeData = useRouteData<{
    locations: ListItem[];
    salesOrder: SalesOrder;
  }>(path.to.salesOrder(orderId));

  const locations = routeData?.locations ?? [];
  const locationOptions = locations.map((location) => ({
    label: location.name,
    value: location.id,
  }));

  const isEditable = ["Draft", "To Review"].includes(
    routeData?.salesOrder?.status ?? ""
  );

  const [type, setType] = useState(initialValues.salesOrderLineType);
  const [locationId, setLocationId] = useState(defaults.locationId ?? "");
  const [itemData, setItemData] = useState<{
    itemId: string;
    itemReadableId?: string;
    description: string;
    unitPrice: number;
    uom: string;
    shelfId: string;
  }>({
    itemId: initialValues.itemId ?? "",
    itemReadableId: initialValues.itemReadableId ?? "",
    description: initialValues.description ?? "",
    unitPrice: initialValues.unitPrice ?? 0,
    uom: initialValues.unitOfMeasureCode ?? "",
    shelfId: initialValues.shelfId ?? "",
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
    ? !permissions.can("update", "sales")
    : !permissions.can("create", "sales");

  const salesOrderLineTypeOptions = salesOrderLineType.map((type) => ({
    label: type,
    value: type,
  }));

  const onClose = () => navigate(-1);

  const onTypeChange = (type: SalesOrderLineType) => {
    // @ts-ignore
    setType(type);
    setItemData({
      itemId: "",
      itemReadableId: "",
      description: "",
      unitPrice: 0,
      uom: "EA",
      shelfId: "",
    });
  };

  const onChange = async (itemId: string) => {
    if (!itemId) return;
    if (!supabase || !company.id) return;
    const [item, part, shelf, price] = await Promise.all([
      supabase
        .from("item")
        .select("name, readableId")
        .eq("id", itemId)
        .eq("companyId", company.id)
        .single(),
      supabase
        .from("part")
        .select("unitOfMeasureCode")
        .eq("itemId", itemId)
        .eq("companyId", company.id)
        .maybeSingle(),
      supabase
        .from("itemInventory")
        .select("defaultShelfId")
        .eq("itemId", itemId)
        .eq("companyId", company.id)
        .eq("locationId", locationId)
        .maybeSingle(),
      supabase
        .from("itemUnitSalePrice")
        .select("unitSalePrice")
        .eq("itemId", itemId)
        .eq("companyId", company.id)
        .maybeSingle(),
    ]);

    setItemData({
      itemId,
      itemReadableId: item.data?.readableId,
      description: item.data?.name ?? "",
      unitPrice: price.data?.unitSalePrice ?? 0,
      uom: part.data?.unitOfMeasureCode ?? "EA",
      shelfId: shelf.data?.defaultShelfId ?? "",
    });
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
          validator={salesOrderLineValidator}
          method="post"
          action={
            isEditing
              ? path.to.salesOrderLine(orderId, initialValues.id!)
              : path.to.newSalesOrderLine(orderId)
          }
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>
              {isEditing ? "Edit" : "New"} Sales Order Line
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />
            <Hidden name="salesOrderId" />
            <Hidden name="itemReadableId" value={itemData?.itemReadableId} />
            <Hidden name="description" value={itemData?.description} />
            <VStack spacing={4}>
              <Select
                name="salesOrderLineType"
                label="Type"
                options={salesOrderLineTypeOptions}
                onChange={(value) => {
                  onTypeChange(value?.value as SalesOrderLineType);
                }}
              />

              {[
                "Part",
                "Material",
                "Service",
                "Tool",
                "Fixture",
                "Consumable",
              ].includes(type) && (
                <Item
                  name="itemId"
                  label={type}
                  // @ts-ignore
                  type={type}
                  onChange={(value) => {
                    onChange(value?.value as string);
                  }}
                />
              )}

              {type !== "Comment" && (
                <>
                  <Number name="saleQuantity" label="Quantity" />
                  {/* 
                // TODO: implement this and replace the UoM in PartForm */}
                  {/* <UnitOfMeasure name="unitOfMeasureCode" label="Unit of Measure" value={uom} /> */}
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
                  {["Part", "Service"].includes(type) && (
                    <ComboboxControlled
                      name="locationId"
                      label="Location"
                      options={locationOptions}
                      value={locationId}
                      onChange={onLocationChange}
                    />
                  )}
                  {type === "Part" && (
                    <ComboboxControlled
                      name="shelfId"
                      label="Shelf"
                      options={shelfOptions}
                      value={itemData.shelfId}
                      onChange={(newValue) => {
                        if (newValue) {
                          setItemData((d) => ({
                            ...d,
                            shelfId: newValue?.value as string,
                          }));
                        }
                      }}
                    />
                  )}
                </>
              )}
              <CustomFormFields table="salesOrderLine" />
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

export default SalesOrderLineForm;
