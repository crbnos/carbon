import { useCarbon } from "@carbon/auth";
import { Combobox, ValidatedForm } from "@carbon/form";
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
  useDisclosure,
  useMount,
  VStack
} from "@carbon/react";
import { getItemReadableId } from "@carbon/utils";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";
import { useFetcher, useParams } from "react-router";
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
  UnitOfMeasure
} from "~/components/Form";
import {
  useCurrencyFormatter,
  usePercentFormatter,
  usePermissions,
  useRouteData,
  useUser
} from "~/hooks";
import { getSupplierPartPriceBreaks } from "~/modules/items";
import type { PurchaseOrder, PurchaseOrderLine } from "~/modules/purchasing";
import {
  isPurchaseOrderLocked,
  purchaseOrderLineValidator
} from "~/modules/purchasing";
import { type MethodItemType, resolveSupplierPrice } from "~/modules/shared";
import type { action } from "~/routes/x+/purchase-order+/$orderId.$lineId.details";
import { useItems } from "~/stores";
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
  onClose
}: PurchaseOrderLineFormProps) => {
  const permissions = usePermissions();
  const { carbon } = useCarbon();
  const [items] = useItems();
  const { company } = useUser();
  const { orderId } = useParams();
  const fetcher = useFetcher<typeof action>();

  if (!orderId) throw new Error("orderId not found");

  const routeData = useRouteData<{
    purchaseOrder: PurchaseOrder;
  }>(path.to.purchaseOrder(orderId));

  const isOutsideProcessing =
    routeData?.purchaseOrder?.purchaseOrderType === "Outside Processing";
  const isLocked = isPurchaseOrderLocked(routeData?.purchaseOrder?.status);
  const isClosed = routeData?.purchaseOrder?.status === "Closed";

  const [itemType, setItemType] = useState<MethodItemType>(
    initialValues.purchaseOrderLineType as MethodItemType
  );
  const [locationId, setLocationId] = useState(initialValues.locationId);
  const [itemData, setItemData] = useState<{
    itemId: string;
    description: string;
    purchaseQuantity: number;
    supplierUnitPrice: number;
    supplierShippingCost: number;
    purchaseUom: string;
    inventoryUom: string;
    conversionFactor: number;
    shelfId: string | null;
    minimumOrderQuantity?: number;
    supplierTaxAmount: number;
    taxPercent: number;
    priceBreaks: Array<{ quantity: number; unitPrice: number }>;
    fallbackUnitPrice: number;
  }>({
    itemId: initialValues.itemId ?? "",
    description: initialValues.description ?? "",
    purchaseQuantity: initialValues.purchaseQuantity ?? 1,
    supplierUnitPrice: initialValues.supplierUnitPrice ?? 0,
    supplierShippingCost: initialValues.supplierShippingCost ?? 0,
    purchaseUom: initialValues.purchaseUnitOfMeasureCode ?? "",
    inventoryUom: initialValues.inventoryUnitOfMeasureCode ?? "",
    conversionFactor: initialValues.conversionFactor ?? 1,
    shelfId: initialValues.shelfId ?? "",
    minimumOrderQuantity: undefined,
    supplierTaxAmount: initialValues.supplierTaxAmount ?? 0,
    taxPercent:
      (initialValues.supplierUnitPrice ?? 0) *
        (initialValues.purchaseQuantity ?? 1) +
        (initialValues.supplierShippingCost ?? 0) >
      0
        ? (initialValues.supplierTaxAmount ?? 0) /
          ((initialValues.supplierUnitPrice ?? 0) *
            (initialValues.purchaseQuantity ?? 1) +
            (initialValues.supplierShippingCost ?? 0))
        : 0,
    priceBreaks: [],
    fallbackUnitPrice: initialValues.supplierUnitPrice ?? 0
  });

  // update tax amount when quantity or unit price changes
  useEffect(() => {
    const subtotal =
      itemData.supplierUnitPrice * itemData.purchaseQuantity +
      itemData.supplierShippingCost;
    if (itemData.taxPercent !== 0) {
      setItemData((d) => ({
        ...d,
        supplierTaxAmount: subtotal * itemData.taxPercent
      }));
    }
  }, [
    itemData.supplierUnitPrice,
    itemData.purchaseQuantity,
    itemData.supplierShippingCost,
    itemData.taxPercent
  ]);

  const isEditing = initialValues.id !== undefined;

  // Load price breaks on mount when editing so quantity changes resolve correctly
  useMount(() => {
    if (!isEditing || !initialValues.itemId) return;
    const supplierId = routeData?.purchaseOrder?.supplierId;
    if (!supplierId) return;

    (async () => {
      const supplierPart = await carbon
        .from("supplierPart")
        .select("id")
        .eq("itemId", initialValues.itemId!)
        .eq("companyId", company.id)
        .eq("supplierId", supplierId)
        .maybeSingle();

      if (supplierPart?.data?.id) {
        const breaks = await getSupplierPartPriceBreaks(
          carbon,
          supplierPart.data.id
        );
        setItemData((d) => ({ ...d, priceBreaks: breaks }));
      }
    })();
  });

  const isDisabled = isClosed
    ? true
    : isEditing
      ? isLocked
        ? !permissions.can("delete", "purchasing")
        : !permissions.can("update", "purchasing")
      : !permissions.can("create", "purchasing");

  const deleteDisclosure = useDisclosure();
  const currencyFormatter = useCurrencyFormatter();
  const percentFormatter = usePercentFormatter();

  const onTypeChange = (t: MethodItemType | "Item") => {
    if (t === itemType) return;
    setItemType(t as MethodItemType);
    setItemData({
      itemId: "",
      description: "",
      purchaseQuantity: 1,
      supplierUnitPrice: 0,
      supplierShippingCost: 0,
      inventoryUom: "",
      purchaseUom: "",
      conversionFactor: 1,
      shelfId: "",
      minimumOrderQuantity: undefined,
      supplierTaxAmount: 0,
      taxPercent: 0,
      priceBreaks: [],
      fallbackUnitPrice: 0
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
            .eq("supplierId", routeData?.purchaseOrder.supplierId!)
            .maybeSingle(),
          carbon
            .from("pickMethod")
            .select("defaultShelfId")
            .eq("itemId", itemId)
            .eq("companyId", company.id)
            .eq("locationId", locationId!)
            .maybeSingle()
        ]);

        const itemCost = item?.data?.itemCost?.[0];
        const itemReplenishment = item?.data?.itemReplenishment;
        const exchangeRate = routeData?.purchaseOrder?.exchangeRate ?? 1;
        const initialQty = supplierPart?.data?.minimumOrderQuantity ?? 1;
        const baseFallback =
          (supplierPart?.data?.unitPrice ?? itemCost?.unitCost ?? 0) /
          exchangeRate;

        const breaks = supplierPart?.data?.id
          ? await getSupplierPartPriceBreaks(carbon, supplierPart.data.id)
          : [];
        const resolvedPrice = resolveSupplierPrice(
          breaks,
          initialQty,
          baseFallback,
          exchangeRate
        );

        setItemData({
          itemId: itemId,
          description: item.data?.name ?? "",
          purchaseQuantity: initialQty,
          supplierUnitPrice: resolvedPrice,
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
          supplierTaxAmount: 0,
          taxPercent: 0,
          priceBreaks: breaks,
          fallbackUnitPrice: baseFallback
        });

        if (item.data?.type) {
          setItemType(item.data.type as MethodItemType);
        }

        break;
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
      shelfId: shelf?.data?.defaultShelfId ?? ""
    }));
  };

  return (
    <>
      <ModalCardProvider type={type}>
        <ModalCard
          onClose={onClose}
          defaultCollapsed={false}
          isCollapsible={isEditing}
        >
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
                    isEditing && !itemData?.itemId && "text-muted-foreground"
                  )}
                >
                  {isEditing
                    ? getItemReadableId(items, itemData?.itemId) || "..."
                    : "New Purchase Order Line"}
                </ModalCardTitle>
                <ModalCardDescription>
                  {isOutsideProcessing ? (
                    <Badge variant="default">Outside Processing</Badge>
                  ) : isEditing ? (
                    <div className="flex flex-col items-start gap-1">
                      <span>{itemData?.description}</span>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">
                          {initialValues?.purchaseQuantity}
                        </Badge>
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
                    "A purchase order line contains order details for a particular item"
                  )}
                </ModalCardDescription>
              </ModalCardHeader>
              <ModalCardBody>
                <Hidden name="id" />
                <Hidden name="purchaseOrderId" />

                <Hidden name="purchaseOrderLineType" value={itemType} />
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
                    <Item
                      name="itemId"
                      label={itemType}
                      // @ts-ignore
                      type={itemType}
                      replenishmentSystem={
                        isOutsideProcessing ? undefined : "Buy"
                      }
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
                            description: e.target.value
                          }))
                        }
                      />
                    </FormControl>

                    {isOutsideProcessing && (
                      <JobOperationSelect jobId={initialValues.jobId} />
                    )}

                    <NumberControlled
                      minValue={itemData.minimumOrderQuantity}
                      name="purchaseQuantity"
                      label="Quantity"
                      value={itemData.purchaseQuantity}
                      onChange={(value) => {
                        const exchangeRate =
                          routeData?.purchaseOrder?.exchangeRate ?? 1;
                        setItemData((d) => ({
                          ...d,
                          purchaseQuantity: value,
                          supplierUnitPrice: resolveSupplierPrice(
                            d.priceBreaks,
                            value,
                            d.fallbackUnitPrice,
                            exchangeRate
                          )
                        }));
                      }}
                    />

                    {[
                      "Item",
                      "Part",
                      "Material",
                      "Consumable",
                      "Tool"
                    ].includes(itemType) && (
                      <>
                        <UnitOfMeasure
                          name="purchaseUnitOfMeasureCode"
                          label="Unit of Measure"
                          value={itemData.purchaseUom}
                          onChange={(newValue) => {
                            if (newValue) {
                              setItemData((d) => ({
                                ...d,
                                purchaseUom: newValue?.value as string
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
                              conversionFactor: value
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
                          company.baseCurrencyCode
                      }}
                      onChange={(value) =>
                        setItemData((d) => ({
                          ...d,
                          supplierUnitPrice: value
                        }))
                      }
                    />
                    <NumberControlled
                      name="supplierShippingCost"
                      label="Shipping"
                      minValue={0}
                      value={itemData.supplierShippingCost}
                      formatOptions={{
                        style: "currency",
                        currency:
                          routeData?.purchaseOrder?.currencyCode ??
                          company.baseCurrencyCode
                      }}
                      onChange={(value) =>
                        setItemData((d) => ({
                          ...d,
                          supplierShippingCost: value
                        }))
                      }
                    />
                    <NumberControlled
                      name="supplierTaxAmount"
                      label="Tax"
                      value={itemData.supplierTaxAmount}
                      formatOptions={{
                        style: "currency",
                        currency:
                          routeData?.purchaseOrder?.currencyCode ??
                          company.baseCurrencyCode
                      }}
                      onChange={(value) => {
                        const subtotal =
                          itemData.supplierUnitPrice *
                            itemData.purchaseQuantity +
                          itemData.supplierShippingCost;
                        setItemData((d) => ({
                          ...d,
                          supplierTaxAmount: value,
                          taxPercent: subtotal > 0 ? value / subtotal : 0
                        }));
                      }}
                    />
                    {[
                      "Item",
                      "Part",
                      "Service",
                      "Material",
                      "Tool",
                      "Consumable",
                      "Fixed Asset"
                    ].includes(itemType) &&
                      !isOutsideProcessing && (
                        <Location
                          name="locationId"
                          label="Location"
                          value={locationId}
                          onChange={onLocationChange}
                        />
                      )}
                    {[
                      "Item",
                      "Part",
                      "Service",
                      "Material",
                      "Tool",
                      "Consumable",
                      "Fixed Asset"
                    ].includes(itemType) &&
                      !isOutsideProcessing && (
                        <Shelf
                          name="shelfId"
                          label="Shelf"
                          locationId={locationId}
                          value={itemData.shelfId ?? undefined}
                          onChange={(newValue) => {
                            if (newValue) {
                              setItemData((d) => ({
                                ...d,
                                shelfId: newValue?.id
                              }));
                            }
                          }}
                        />
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
                        maximumFractionDigits: 2
                      }}
                      onChange={(value) => {
                        const subtotal =
                          itemData.supplierUnitPrice *
                            itemData.purchaseQuantity +
                          itemData.supplierShippingCost;
                        setItemData((d) => ({
                          ...d,
                          taxPercent: value,
                          supplierTaxAmount: subtotal * value
                        }));
                      }}
                    />

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

function JobOperationSelect(initialValues: { jobId?: string }) {
  const [jobId, setJobId] = useState<string | null>(
    initialValues.jobId ?? null
  );

  const jobsFetcher =
    useFetcher<PostgrestResponse<{ id: string; jobId: string }>>();
  useMount(() => {
    jobsFetcher.load(path.to.api.jobs);
  });

  const jobOptions = useMemo(
    () =>
      jobsFetcher.data?.data
        ? jobsFetcher.data?.data.map((c) => ({
            value: c.id,
            label: c.jobId
          }))
        : [],
    [jobsFetcher.data]
  );

  const jobOperationFetcher =
    useFetcher<PostgrestResponse<{ id: string; description: string }>>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (jobId) {
      jobOperationFetcher.load(path.to.api.outsideOperations(jobId));
    }
  }, [jobId]);

  const jobOperationOptions = useMemo(() => {
    return (
      jobOperationFetcher.data?.data?.map((c) => ({
        value: c.id,
        label: c.description
      })) ?? []
    );
  }, [jobOperationFetcher.data]);

  return (
    <>
      <Combobox
        name="jobId"
        label="Job"
        options={jobOptions}
        onChange={(value) => {
          if (value) {
            setJobId(value.value as string);
          }
        }}
      />
      <Combobox
        name="jobOperationId"
        label="Operation"
        options={jobOperationOptions}
      />
    </>
  );
}
