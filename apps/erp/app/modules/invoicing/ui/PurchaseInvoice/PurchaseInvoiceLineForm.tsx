import {
  Badge,
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
  VStack,
} from "@carbon/react";

import { useCarbon } from "@carbon/auth";
import { ValidatedForm } from "@carbon/form";
import { getItemReadableId } from "@carbon/utils";
import { useParams } from "@remix-run/react";
import { useEffect, useState } from "react";
import type { z } from "zod";
import {
  ConversionFactor,
  CustomFormFields,
  Hidden,
  Item,
  Location,
  NumberControlled,
  Shelf,
  Submit,
  UnitOfMeasure,
} from "~/components/Form";
import {
  useCurrencyFormatter,
  usePercentFormatter,
  usePermissions,
  useRouteData,
  useUser,
} from "~/hooks";
import type { PurchaseInvoice } from "~/modules/invoicing";
import { purchaseInvoiceLineValidator } from "~/modules/invoicing";
import type { MethodItemType } from "~/modules/shared";
import { useItems } from "~/stores";
import { path } from "~/utils/path";

type PurchaseInvoiceLineFormProps = {
  initialValues: z.infer<typeof purchaseInvoiceLineValidator> & {
    taxPercent?: number;
  };
  type?: "card" | "modal";
  onClose?: () => void;
};

const PurchaseInvoiceLineForm = ({
  initialValues,
  type,
  onClose,
}: PurchaseInvoiceLineFormProps) => {
  const permissions = usePermissions();
  const { carbon } = useCarbon();

  const [items] = useItems();
  const { company, defaults } = useUser();
  const { invoiceId } = useParams();

  if (!invoiceId) throw new Error("invoiceId not found");

  const routeData = useRouteData<{
    purchaseInvoice: PurchaseInvoice;
  }>(path.to.purchaseInvoice(invoiceId));

  const isEditable = ["Draft"].includes(
    routeData?.purchaseInvoice?.status ?? ""
  );

  const [itemType, setItemType] = useState<MethodItemType>(
    initialValues.invoiceLineType as MethodItemType
  );
  const [locationId, setLocationId] = useState(defaults.locationId ?? "");
  const [itemData, setItemData] = useState<{
    itemId: string;
    description: string;
    quantity: number;
    supplierUnitPrice: number;
    supplierShippingCost: number;
    purchaseUom: string;
    inventoryUom: string;
    conversionFactor: number;
    shelfId: string | null;
    minimumOrderQuantity?: number;
    taxAmount: number;
    taxPercent: number;
  }>({
    itemId: initialValues.itemId ?? "",
    description: initialValues.description ?? "",
    quantity: initialValues.quantity ?? 1,
    supplierUnitPrice: initialValues.supplierUnitPrice ?? 0,
    supplierShippingCost: initialValues.supplierShippingCost ?? 0,
    purchaseUom: initialValues.purchaseUnitOfMeasureCode ?? "",
    inventoryUom: initialValues.inventoryUnitOfMeasureCode ?? "",
    conversionFactor: initialValues.conversionFactor ?? 1,
    shelfId: initialValues.shelfId ?? "",
    minimumOrderQuantity: undefined,
    taxAmount: initialValues.supplierTaxAmount ?? 0,
    taxPercent: initialValues.taxPercent ?? 0,
  });

  // update tax amount when quantity or unit price changes
  useEffect(() => {
    const subtotal =
      itemData.supplierUnitPrice * itemData.quantity +
      itemData.supplierShippingCost;
    if (itemData.taxPercent !== 0) {
      setItemData((d) => ({
        ...d,
        taxAmount: subtotal * itemData.taxPercent,
      }));
    }
  }, [
    itemData.supplierUnitPrice,
    itemData.quantity,
    itemData.supplierShippingCost,
    itemData.taxPercent,
  ]);

  const isEditing = initialValues.id !== undefined;
  const isDisabled = !isEditable
    ? true
    : isEditing
    ? !permissions.can("update", "purchasing")
    : !permissions.can("create", "purchasing");

  const currencyFormatter = useCurrencyFormatter();
  const percentFormatter = usePercentFormatter();

  const onTypeChange = (t: MethodItemType | "Item") => {
    if (t === itemType) return;
    setItemType(t as MethodItemType);
    setItemData({
      itemId: "",
      description: "",
      quantity: 1,
      supplierUnitPrice: 0,
      supplierShippingCost: 0,
      inventoryUom: "",
      purchaseUom: "",
      conversionFactor: 1,
      shelfId: "",
      minimumOrderQuantity: undefined,
      taxAmount: 0,
      taxPercent: 0,
    });
  };

  const onItemChange = async (itemId: string) => {
    if (!carbon) throw new Error("Carbon client not found");
    switch (itemType) {
      // @ts-expect-error
      case "Item":
      case "Consumable":
      case "Material":
      case "Part":
      case "Tool":
        const [item, supplierPart, inventory] = await Promise.all([
          carbon
            .from("item")
            .select(
              "name, readableIdWithRevision, type, unitOfMeasureCode, itemCost(unitCost), itemReplenishment(purchasingUnitOfMeasureCode, conversionFactor, leadTime)"
            )
            .eq("id", itemId)
            .eq("companyId", company.id)
            .single(),
          carbon
            .from("supplierPart")
            .select("*")
            .eq("itemId", itemId)
            .eq("companyId", company.id)
            .eq("supplierId", routeData?.purchaseInvoice.supplierId!)
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
          description: item.data?.name ?? "",
          quantity: supplierPart?.data?.minimumOrderQuantity ?? 1,
          supplierUnitPrice:
            (supplierPart?.data?.unitPrice ?? itemCost?.unitCost ?? 0) /
            (routeData?.purchaseInvoice?.exchangeRate ?? 1),
          supplierShippingCost: 0,
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
          taxAmount: 0,
          taxPercent: 0,
        });

        if (item.data?.type) {
          setItemType(item.data.type as MethodItemType);
        }

        break;
      default:
        throw new Error(
          `Invalid invoice line type: ${itemType} is not implemented`
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
    <ModalCardProvider type={type}>
      <ModalCard
        onClose={onClose}
        defaultCollapsed={isEditing}
        isCollapsible={isEditing}
      >
        <ModalCardContent size="xxlarge">
          <ValidatedForm
            defaultValues={initialValues}
            validator={purchaseInvoiceLineValidator}
            method="post"
            action={
              isEditing
                ? path.to.purchaseInvoiceLine(invoiceId, initialValues.id!)
                : path.to.newPurchaseInvoiceLine(invoiceId)
            }
            className="w-full"
            onSubmit={() => {
              if (type === "modal") onClose?.();
            }}
          >
            <ModalCardHeader>
              <ModalCardTitle
                className={cn(
                  isEditing && !itemData?.itemId && "text-muted-foreground"
                )}
              >
                {isEditing
                  ? getItemReadableId(items, itemData?.itemId) ?? "..."
                  : "New Purchase Invoice Line"}
              </ModalCardTitle>
              <ModalCardDescription>
                {isEditing ? (
                  <div className="flex flex-col items-start gap-1">
                    <span>{itemData?.description}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{initialValues?.quantity}</Badge>
                      <Badge variant="green">
                        {currencyFormatter.format(
                          (initialValues?.supplierUnitPrice ?? 0) +
                            (initialValues?.supplierShippingCost ?? 0)
                        )}{" "}
                        {initialValues?.purchaseUnitOfMeasureCode}
                      </Badge>
                      {initialValues?.taxPercent > 0 ? (
                        <Badge variant="red">
                          {percentFormatter.format(initialValues?.taxPercent)}{" "}
                          Tax
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  "A purchase invoice line contains invoice details for a particular item"
                )}
              </ModalCardDescription>
            </ModalCardHeader>
            <ModalCardBody>
              <Hidden name="id" />
              <Hidden name="invoiceId" />
              <Hidden name="invoiceLineType" value={itemType} />
              <Hidden name="description" value={itemData.description} />
              <Hidden
                name="exchangeRate"
                value={routeData?.purchaseInvoice?.exchangeRate ?? 1}
              />
              <Hidden
                name="inventoryUnitOfMeasureCode"
                value={itemData?.inventoryUom}
              />

              <VStack>
                <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
                  <Item
                    name="itemId"
                    label={itemType}
                    // @ts-ignore
                    type={itemType}
                    replenishmentSystem="Buy"
                    onChange={(value) => {
                      onItemChange(value?.value as string);
                    }}
                    onTypeChange={onTypeChange}
                  />

                  <FormControl className="col-span-2">
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

                  {["Item", "Part", "Material", "Tool", "Consumable"].includes(
                    itemType
                  ) && (
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

                      <NumberControlled
                        name="supplierUnitPrice"
                        label="Supplier Unit Price"
                        value={itemData.supplierUnitPrice}
                        formatOptions={{
                          style: "currency",
                          currency:
                            routeData?.purchaseInvoice?.currencyCode ??
                            company.baseCurrencyCode,
                        }}
                        onChange={(value) =>
                          setItemData((d) => ({
                            ...d,
                            supplierUnitPrice: value,
                          }))
                        }
                      />
                      <NumberControlled
                        name="supplierShippingCost"
                        label="Shipping"
                        value={itemData.supplierShippingCost}
                        minValue={0}
                        formatOptions={{
                          style: "currency",
                          currency:
                            routeData?.purchaseInvoice?.currencyCode ??
                            company.baseCurrencyCode,
                        }}
                        onChange={(value) =>
                          setItemData((d) => ({
                            ...d,
                            supplierShippingCost: value,
                          }))
                        }
                      />

                      <NumberControlled
                        name="supplierTaxAmount"
                        label="Tax"
                        value={itemData.taxAmount}
                        formatOptions={{
                          style: "currency",
                          currency:
                            routeData?.purchaseInvoice?.currencyCode ??
                            company.baseCurrencyCode,
                        }}
                        onChange={(value) => {
                          const subtotal =
                            itemData.supplierUnitPrice * itemData.quantity +
                            itemData.supplierShippingCost;
                          setItemData((d) => ({
                            ...d,
                            taxAmount: value,
                            taxPercent: subtotal > 0 ? value / subtotal : 0,
                          }));
                        }}
                      />

                      <Location
                        name="locationId"
                        label="Location"
                        value={locationId}
                        onChange={onLocationChange}
                      />
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
                    </>
                  )}
                  <NumberControlled
                    name="taxPercent"
                    label="Tax Percent"
                    value={itemData.taxPercent}
                    minValue={0}
                    maxValue={1}
                    step={0.0001}
                    formatOptions={{
                      style: "percent",
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 2,
                    }}
                    onChange={(value) => {
                      const subtotal =
                        itemData.supplierUnitPrice * itemData.quantity +
                        itemData.supplierShippingCost;
                      setItemData((d) => ({
                        ...d,
                        taxPercent: value,
                        taxAmount: subtotal * value,
                      }));
                    }}
                  />
                  <CustomFormFields table="purchaseInvoiceLine" />
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
  );
};

export default PurchaseInvoiceLineForm;
