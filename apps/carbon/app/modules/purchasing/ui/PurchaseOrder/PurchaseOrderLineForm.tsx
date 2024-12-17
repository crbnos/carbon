import {
  cn,
  FormControl,
  FormLabel,
  Input,
  ModalCard,
  ModalCardBody,
  ModalCardContent,
  ModalCardDescription,
  ModalCardFooter,
  ModalCardHeader,
  ModalCardProvider,
  ModalCardTitle,
  useDisclosure,
  VStack,
} from "@carbon/react";

import { useCarbon } from "@carbon/auth";
import { Number, ValidatedForm } from "@carbon/form";
import { useFetcher, useParams } from "@remix-run/react";
import { useState } from "react";
import type { z } from "zod";
import {
  Account,
  ConversionFactor,
  CustomFormFields,
  Hidden,
  Item,
  Location,
  NumberControlled,
  Select,
  Shelf,
  Submit,
  UnitOfMeasure,
} from "~/components/Form";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import type {
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderLineType,
} from "~/modules/purchasing";
import {
  purchaseOrderLineType,
  purchaseOrderLineValidator,
} from "~/modules/purchasing";
import { methodItemType } from "~/modules/shared";
import type { action } from "~/routes/x+/purchase-order+/$orderId.$lineId.details";
import { path } from "~/utils/path";
import DeletePurchaseOrderLine from "./DeletePurchaseOrderLine";

type PurchaseOrderLineFormProps = {
  initialValues: z.infer<typeof purchaseOrderLineValidator>;
  type?: "card" | "modal";
  onClose?: () => void;
};

const PurchaseOrderLineForm = ({
  initialValues,
  type,
  onClose,
}: PurchaseOrderLineFormProps) => {
  const permissions = usePermissions();
  const { carbon } = useCarbon();

  const { company, defaults } = useUser();
  const { orderId } = useParams();
  const fetcher = useFetcher<typeof action>();

  if (!orderId) throw new Error("orderId not found");

  const routeData = useRouteData<{
    purchaseOrder: PurchaseOrder;
  }>(path.to.purchaseOrder(orderId));

  const isEditable = ["Draft"].includes(routeData?.purchaseOrder?.status ?? "");

  const [itemType, setItemType] = useState<PurchaseOrderLineType>(
    initialValues.purchaseOrderLineType
  );
  const [locationId, setLocationId] = useState(
    initialValues.locationId ?? defaults.locationId ?? ""
  );
  const [itemData, setItemData] = useState<{
    itemId: string;
    itemReadableId: string;
    description: string;
    purchaseQuantity: number;
    supplierUnitPrice: number;
    purchaseUom: string;
    inventoryUom: string;
    conversionFactor: number;
    shelfId: string | null;
    minimumOrderQuantity?: number;
  }>({
    itemId: initialValues.itemId ?? "",
    itemReadableId: initialValues.itemReadableId ?? "",
    description: initialValues.description ?? "",
    purchaseQuantity: initialValues.purchaseQuantity ?? 1,
    supplierUnitPrice: initialValues.supplierUnitPrice ?? 0,
    purchaseUom: initialValues.purchaseUnitOfMeasureCode ?? "",
    inventoryUom: initialValues.inventoryUnitOfMeasureCode ?? "",
    conversionFactor: initialValues.conversionFactor ?? 1,
    shelfId: initialValues.shelfId ?? "",
    minimumOrderQuantity: undefined,
  });

  const isEditing = initialValues.id !== undefined;
  const isDisabled = !isEditable
    ? true
    : isEditing
    ? !permissions.can("update", "purchasing")
    : !permissions.can("create", "purchasing");

  const purchaseOrderLineTypeOptions = purchaseOrderLineType.map((t) => ({
    label: t,
    value: t,
  }));

  const deleteDisclosure = useDisclosure();

  const onTypeChange = (t: PurchaseOrderLineType) => {
    setItemType(t);
    setItemData({
      itemId: "",
      itemReadableId: "",
      description: "",
      purchaseQuantity: 1,
      supplierUnitPrice: 0,
      inventoryUom: "",
      purchaseUom: "",
      conversionFactor: 1,
      shelfId: "",
      minimumOrderQuantity: undefined,
    });
  };

  const onItemChange = async (itemId: string) => {
    if (!carbon) throw new Error("Carbon client not found");
    switch (itemType) {
      case "Consumable":
      case "Material":
      case "Part":
      case "Tool":
        const [item, supplierPart, inventory] = await Promise.all([
          carbon
            .from("item")
            .select(
              "name, readableId, unitOfMeasureCode, itemCost(unitCost), itemReplenishment(purchasingUnitOfMeasureCode, conversionFactor, purchasingLeadTime)"
            )
            .eq("id", itemId)
            .eq("companyId", company.id)
            .single(),
          carbon
            .from("supplierPart")
            .select("*")
            .eq("itemId", itemId)
            .eq("companyId", company.id)
            .eq("supplierId", routeData?.purchaseOrder.supplierId!)
            .maybeSingle(),
          carbon
            .from("pickMethod")
            .select("defaultShelfId")
            .eq("itemId", itemId)
            .eq("companyId", company.id)
            .eq("locationId", locationId!)
            .maybeSingle(),
        ]);

        const itemCost = item?.data?.itemCost?.[0];
        const itemReplenishment = item?.data?.itemReplenishment;

        setItemData({
          itemId: itemId,
          itemReadableId: item.data?.readableId ?? "",
          description: item.data?.name ?? "",
          purchaseQuantity: supplierPart?.data?.minimumOrderQuantity ?? 1,
          supplierUnitPrice:
            (supplierPart?.data?.unitPrice ?? itemCost?.unitCost ?? 0) /
            (routeData?.purchaseOrder?.exchangeRate ?? 1),
          purchaseUom:
            supplierPart?.data?.supplierUnitOfMeasureCode ??
            itemReplenishment?.purchasingUnitOfMeasureCode ??
            item.data?.unitOfMeasureCode ??
            "EA",
          inventoryUom: item.data?.unitOfMeasureCode ?? "EA",
          conversionFactor:
            supplierPart?.data?.conversionFactor ??
            itemReplenishment?.conversionFactor ??
            1,
          shelfId: inventory.data?.defaultShelfId ?? null,
        });

        break;
      // case "Service":
      //   const service = await carbon
      //     .from("item")
      //     .select("readableId, name")
      //     .eq("id", itemId)
      //     .eq("companyId", company.id)
      //     .single();

      //   setItemData({
      //     itemId: itemId,
      //     itemReadableId: service.data?.readableId ?? "",
      //     description: service.data?.name ?? "",
      //     purchaseQuantity: 1,
      //     supplierUnitPrice: 0,
      //     purchaseUom: "EA",
      //     inventoryUom: "EA",
      //     conversionFactor: 1,
      //     shelfId: "",
      //     minimumOrderQuantity: undefined,
      //   });

      //   break;
      default:
        throw new Error(
          `Invalid purchase order line type: ${itemType} is not implemented`
        );
    }
  };

  const onLocationChange = async (newLocation: { value: string } | null) => {
    if (!carbon) throw new Error("carbon is not defined");
    if (typeof newLocation?.value !== "string")
      throw new Error("locationId is not a string");

    setLocationId(newLocation.value);
    if (!itemData.itemId) return;
    const shelf = await carbon
      .from("pickMethod")
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
    <>
      <ModalCardProvider type={type}>
        <ModalCard onClose={onClose}>
          <ModalCardContent size="xxlarge">
            <ValidatedForm
              defaultValues={initialValues}
              validator={purchaseOrderLineValidator}
              method="post"
              action={
                isEditing
                  ? path.to.purchaseOrderLine(orderId, initialValues.id!)
                  : path.to.newPurchaseOrderLine(orderId)
              }
              className="w-full"
              fetcher={fetcher}
              onSubmit={() => {
                if (type === "modal") onClose?.();
              }}
            >
              <ModalCardHeader>
                <ModalCardTitle
                  className={cn(
                    isEditing &&
                      !itemData?.itemReadableId &&
                      "text-muted-foreground"
                  )}
                >
                  {isEditing
                    ? itemData?.itemReadableId || "..."
                    : "New Purchase Order Line"}
                </ModalCardTitle>
                <ModalCardDescription>
                  {isEditing
                    ? itemData?.description || itemType
                    : "A purchase order line contains order details for a particular item"}
                </ModalCardDescription>
              </ModalCardHeader>
              <ModalCardBody>
                <Hidden name="id" />
                <Hidden name="purchaseOrderId" />
                <Hidden name="itemReadableId" value={itemData.itemReadableId} />
                <Hidden name="description" value={itemData.description} />
                <Hidden
                  name="exchangeRate"
                  value={routeData?.purchaseOrder?.exchangeRate ?? 1}
                />
                <Hidden
                  name="inventoryUnitOfMeasureCode"
                  value={itemData?.inventoryUom}
                />
                <VStack>
                  <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
                    <Select
                      name="purchaseOrderLineType"
                      label="Type"
                      options={purchaseOrderLineTypeOptions}
                      onChange={(value) => {
                        onTypeChange(value?.value as PurchaseOrderLineType);
                      }}
                    />
                    {/* @ts-ignore */}
                    {methodItemType.includes(itemType) && (
                      <Item
                        name="itemId"
                        label={itemType}
                        // @ts-ignore
                        type={itemType}
                        replenishmentSystem="Buy"
                        onChange={(value) => {
                          onItemChange(value?.value as string);
                        }}
                      />
                    )}

                    {itemType === "G/L Account" && (
                      <Account
                        name="accountNumber"
                        label="Account"
                        classes={["Expense", "Asset"]}
                        onChange={(value) => {
                          setItemData({
                            itemId: "",
                            itemReadableId: "",
                            description: value?.label ?? "",
                            purchaseQuantity: 1,
                            supplierUnitPrice: 0,
                            purchaseUom: "EA",
                            inventoryUom: "EA",
                            conversionFactor: 1,
                            shelfId: "",
                            minimumOrderQuantity: 0,
                          });
                        }}
                      />
                    )}
                    {itemType === "Fixed Asset" && (
                      // TODO: implement Fixed Asset
                      <Select name="assetId" label="Asset" options={[]} />
                    )}
                    <FormControl>
                      <FormLabel>Description</FormLabel>
                      <Input
                        value={itemData.description}
                        onChange={(e) =>
                          setItemData((d) => ({
                            ...d,
                            description: e.target.value,
                          }))
                        }
                      />
                    </FormControl>
                    {itemType !== "Comment" && (
                      <>
                        <NumberControlled
                          minValue={itemData.minimumOrderQuantity}
                          name="purchaseQuantity"
                          label="Quantity"
                          value={itemData.purchaseQuantity}
                          onChange={(value) => {
                            setItemData((d) => ({
                              ...d,
                              purchaseQuantity: value,
                            }));
                          }}
                        />

                        {["Part", "Material", "Consumable", "Tool"].includes(
                          itemType
                        ) && (
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
                        <NumberControlled
                          name="supplierUnitPrice"
                          label="Unit Price"
                          value={itemData.supplierUnitPrice}
                          formatOptions={{
                            style: "currency",
                            currency:
                              routeData?.purchaseOrder?.currencyCode ??
                              company.baseCurrencyCode,
                          }}
                          onChange={(value) =>
                            setItemData((d) => ({
                              ...d,
                              supplierUnitPrice: value,
                            }))
                          }
                        />
                        <Number
                          name="supplierShippingCost"
                          label="Shipping"
                          formatOptions={{
                            style: "currency",
                            currency:
                              routeData?.purchaseOrder?.currencyCode ??
                              company.baseCurrencyCode,
                          }}
                        />
                        <Number
                          name="supplierTaxAmount"
                          label="Tax"
                          formatOptions={{
                            style: "currency",
                            currency:
                              routeData?.purchaseOrder?.currencyCode ??
                              company.baseCurrencyCode,
                          }}
                        />
                        {[
                          "Part",
                          "Service",
                          "Material",
                          "Tool",
                          "Consumable",
                          "Fixed Asset",
                        ].includes(itemType) && (
                          <Location
                            name="locationId"
                            label="Location"
                            value={locationId}
                            onChange={onLocationChange}
                          />
                        )}
                        {[
                          "Part",
                          "Service",
                          "Material",
                          "Tool",
                          "Consumable",
                          "Fixed Asset",
                        ].includes(itemType) && (
                          <Shelf
                            name="shelfId"
                            label="Shelf"
                            locationId={locationId}
                            value={itemData.shelfId ?? undefined}
                            onChange={(newValue) => {
                              if (newValue) {
                                setItemData((d) => ({
                                  ...d,
                                  shelfId: newValue?.id,
                                }));
                              }
                            }}
                          />
                        )}
                      </>
                    )}
                    <CustomFormFields table="purchaseOrderLine" />
                  </div>
                </VStack>
              </ModalCardBody>
              <ModalCardFooter>
                <Submit isDisabled={isDisabled} withBlocker={false}>
                  Save
                </Submit>
              </ModalCardFooter>
            </ValidatedForm>
          </ModalCardContent>
        </ModalCard>
      </ModalCardProvider>
      {isEditing && deleteDisclosure.isOpen && (
        <DeletePurchaseOrderLine
          line={initialValues as PurchaseOrderLine}
          onCancel={deleteDisclosure.onClose}
        />
      )}
    </>
  );
};

export default PurchaseOrderLineForm;
