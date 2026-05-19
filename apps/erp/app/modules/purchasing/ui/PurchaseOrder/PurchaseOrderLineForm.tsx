import { useCarbon } from "@carbon/auth";
import {
  Combobox,
  DatePicker,
  InputControlled,
  ValidatedForm
} from "@carbon/form";
import {
  Badge,
  cn,
  FormControl,
  FormLabel,
  HStack,
  Input,
  ModalCard,
  ModalCardBody,
  ModalCardContent,
  ModalCardDescription,
  ModalCardFooter,
  ModalCardHeader,
  ModalCardProvider,
  ModalCardTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useDisclosure,
  useMount,
  VStack
} from "@carbon/react";
import { getItemReadableId } from "@carbon/utils";
import { getLocalTimeZone, today } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";
import { LuBox, LuReceipt } from "react-icons/lu";
import { useFetcher, useParams } from "react-router";
import type { z } from "zod";
import {
  Account,
  ConversionFactor,
  CostCenter,
  CustomFormFields,
  Hidden,
  Item,
  Location,
  NumberControlled,
  StorageUnit,
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
  const { t } = useLingui();
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

  const [itemType, setItemType] = useState<MethodItemType>(
    initialValues.purchaseOrderLineType as MethodItemType
  );
  const [locationId, setLocationId] = useState(initialValues.locationId);
  const [itemData, setItemData] = useState<{
    itemId: string;
    conversionFactor: number;
    description: string;
    fallbackUnitPrice: number;
    inventoryUom: string;
    minimumOrderQuantity?: number;
    priceBreaks: Array<{ quantity: number; unitPrice: number }>;
    purchaseQuantity: number;
    purchaseUom: string;
    requiredDate: string | null;
    storageUnitId: string | null;
    supplierShippingCost: number;
    supplierTaxAmount: number;
    supplierUnitPrice: number;
    taxPercent: number;
  }>({
    itemId: initialValues.itemId ?? "",
    conversionFactor: initialValues.conversionFactor ?? 1,
    description: initialValues.description ?? "",
    fallbackUnitPrice: initialValues.supplierUnitPrice ?? 0,
    inventoryUom: initialValues.inventoryUnitOfMeasureCode ?? "",
    minimumOrderQuantity: undefined,
    purchaseQuantity: initialValues.purchaseQuantity ?? 1,
    purchaseUom: initialValues.purchaseUnitOfMeasureCode ?? "",
    priceBreaks: [],
    requiredDate: initialValues?.requiredDate ?? null,
    storageUnitId: initialValues.storageUnitId ?? "",
    supplierShippingCost: initialValues.supplierShippingCost ?? 0,
    supplierTaxAmount: initialValues.supplierTaxAmount ?? 0,
    supplierUnitPrice: initialValues.supplierUnitPrice ?? 0,
    taxPercent:
      (initialValues.supplierUnitPrice ?? 0) *
        (initialValues.purchaseQuantity ?? 1) +
        (initialValues.supplierShippingCost ?? 0) >
      0
        ? (initialValues.supplierTaxAmount ?? 0) /
          ((initialValues.supplierUnitPrice ?? 0) *
            (initialValues.purchaseQuantity ?? 1) +
            (initialValues.supplierShippingCost ?? 0))
        : 0
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
  const isGLAccount = initialValues.purchaseOrderLineType === "G/L Account";
  const [activeTab, setActiveTab] = useState<"direct" | "indirect">(
    isGLAccount ? "indirect" : "direct"
  );

  const [indirectData, setIndirectData] = useState<{
    accountId: string;
    costCenterId: string;
    description: string;
    purchaseQuantity: number;
    requiredDate: string | null;
    supplierUnitPrice: number;
    supplierShippingCost: number;
    supplierTaxAmount: number;
    taxPercent: number;
  }>({
    accountId: initialValues.accountId ?? "",
    costCenterId: initialValues.costCenterId ?? "",
    description: initialValues.description ?? "",
    purchaseQuantity: initialValues.purchaseQuantity ?? 1,
    requiredDate: initialValues.requiredDate ?? null,
    supplierUnitPrice: initialValues.supplierUnitPrice ?? 0,
    supplierShippingCost: initialValues.supplierShippingCost ?? 0,
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
        : 0
  });

  useEffect(() => {
    const subtotal =
      indirectData.supplierUnitPrice * indirectData.purchaseQuantity +
      indirectData.supplierShippingCost;
    if (indirectData.taxPercent !== 0) {
      setIndirectData((d) => ({
        ...d,
        supplierTaxAmount: subtotal * indirectData.taxPercent
      }));
    }
  }, [
    indirectData.supplierUnitPrice,
    indirectData.purchaseQuantity,
    indirectData.supplierShippingCost,
    indirectData.taxPercent
  ]);

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
        const breaks = await getSupplierPartPriceBreaks(supplierPart.data.id);
        setItemData((d) => ({ ...d, priceBreaks: breaks }));
      }
    })();
  });

  const isDisabled = isEditing
    ? !permissions.can("update", "purchasing")
    : !permissions.can("create", "purchasing");

  const deleteDisclosure = useDisclosure();
  const currencyFormatter = useCurrencyFormatter();
  const percentFormatter = usePercentFormatter();

  const onTypeChange = (t: MethodItemType | "Item") => {
    if (t === itemType) return;
    setItemType(t as MethodItemType);
    setItemData({
      itemId: "",
      conversionFactor: 1,
      description: "",
      fallbackUnitPrice: 0,
      inventoryUom: "",
      minimumOrderQuantity: undefined,
      priceBreaks: [],
      purchaseQuantity: 1,
      purchaseUom: "",
      requiredDate: null,
      storageUnitId: "",
      supplierShippingCost: 0,
      supplierTaxAmount: 0,
      supplierUnitPrice: 0,
      taxPercent: 0
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
            .select("defaultStorageUnitId")
            .eq("itemId", itemId)
            .eq("companyId", company.id)
            .eq("locationId", locationId!)
            .maybeSingle()
        ]);

        const itemCost = item?.data?.itemCost?.[0];
        const itemReplenishment = item?.data?.itemReplenishment;
        const exchangeRate = routeData?.purchaseOrder?.exchangeRate ?? 1;
        const initialQty = supplierPart?.data?.minimumOrderQuantity ?? 1;
        const leadTime = item?.data?.itemReplenishment?.leadTime ?? 0;
        const baseFallback =
          (supplierPart?.data?.unitPrice ?? itemCost?.unitCost ?? 0) /
          exchangeRate;

        const breaks = supplierPart?.data?.id
          ? await getSupplierPartPriceBreaks(supplierPart.data.id)
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
          requiredDate:
            leadTime === 0
              ? null
              : today(getLocalTimeZone()).add({ days: leadTime }).toString(),
          storageUnitId: inventory.data?.defaultStorageUnitId ?? null,
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
    const storageUnit = await carbon
      .from("pickMethod")
      .select("defaultStorageUnitId")
      .eq("itemId", itemData.itemId)
      .eq("companyId", company.id)
      .eq("locationId", newLocation.value)
      .maybeSingle();

    setItemData((d) => ({
      ...d,
      storageUnitId: storageUnit?.data?.defaultStorageUnitId ?? ""
    }));
  };

  return (
    <>
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as "direct" | "indirect")}
        className="w-full"
      >
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
                isDisabled={isLocked}
                onSubmit={() => {
                  if (type === "modal") onClose?.();
                }}
              >
                <HStack
                  className={cn(
                    "w-full justify-between items-start",
                    type === "modal" && "pr-16"
                  )}
                >
                  <ModalCardHeader className="flex flex-1">
                    <ModalCardTitle
                      className={cn(
                        isEditing &&
                          !isGLAccount &&
                          !itemData?.itemId &&
                          "text-muted-foreground"
                      )}
                    >
                      {isEditing
                        ? isGLAccount
                          ? indirectData.description || "G/L Account"
                          : getItemReadableId(items, itemData?.itemId) || "..."
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
                            {/* @ts-expect-error TS2339 */}
                            {initialValues?.taxPercent > 0 ? (
                              <Badge variant="red">
                                {percentFormatter.format(
                                  /* @ts-expect-error TS2339 */
                                  initialValues?.taxPercent ?? 0
                                )}{" "}
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
                  <div className="flex-shrink-0">
                    {!isEditing && (
                      <TabsList>
                        <TabsTrigger value="direct">
                          <LuBox className="mr-1" />
                          <Trans>Direct</Trans>
                        </TabsTrigger>
                        <TabsTrigger value="indirect">
                          <LuReceipt className="mr-1" />
                          <Trans>Indirect</Trans>
                        </TabsTrigger>
                      </TabsList>
                    )}
                  </div>
                </HStack>
                <ModalCardBody>
                  <Hidden name="id" />
                  <Hidden name="purchaseOrderId" />
                  <Hidden
                    name="exchangeRate"
                    value={routeData?.purchaseOrder?.exchangeRate ?? 1}
                  />

                  <TabsContent value="direct">
                    <Hidden name="purchaseOrderLineType" value={itemType} />
                    <Hidden
                      name="inventoryUnitOfMeasureCode"
                      value={itemData?.inventoryUom}
                    />
                    <VStack>
                      <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
                        <Item
                          name="itemId"
                          label={itemType}
                          type={itemType}
                          locationId={locationId}
                          replenishmentSystem={
                            isOutsideProcessing ? undefined : "Buy"
                          }
                          onChange={(value) => {
                            onItemChange(value?.value as string);
                          }}
                          onTypeChange={onTypeChange}
                        />

                        <InputControlled
                          label={t`Description`}
                          name="description"
                          value={itemData.description}
                          isOptional={false}
                        />

                        {isOutsideProcessing && (
                          <JobOperationSelect jobId={initialValues.jobId} />
                        )}

                        <DatePicker
                          name="requiredDate"
                          label={t`Required Date`}
                          value={itemData?.requiredDate ?? undefined}
                          onChange={(date) => {
                            setItemData((d) => ({
                              ...d,
                              requiredDate: date
                            }));
                          }}
                        />

                        <NumberControlled
                          minValue={itemData.minimumOrderQuantity}
                          name="purchaseQuantity"
                          label={t`Quantity`}
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
                              label={t`Unit of Measure`}
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
                          label={t`Unit Price`}
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
                          label={t`Shipping`}
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
                          label={t`Tax`}
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
                              label={t`Delivery Location`}
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
                            <StorageUnit
                              name="storageUnitId"
                              label={t`Storage Unit`}
                              locationId={locationId}
                              value={itemData.storageUnitId ?? undefined}
                              onChange={(newValue) => {
                                if (newValue) {
                                  setItemData((d) => ({
                                    ...d,
                                    storageUnitId: newValue?.id
                                  }));
                                }
                              }}
                            />
                          )}
                        <NumberControlled
                          name="taxPercent"
                          label={t`Tax Percent`}
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
                  </TabsContent>

                  <TabsContent value="indirect">
                    <Hidden name="purchaseOrderLineType" value="G/L Account" />
                    <Hidden
                      name="description"
                      value={indirectData.description}
                    />
                    <VStack>
                      <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
                        <Account
                          name="accountId"
                          label={t`GL Account`}
                          classes={["Asset", "Expense"]}
                        />
                        <FormControl>
                          <FormLabel>
                            <Trans>Description</Trans>
                          </FormLabel>
                          <Input
                            value={indirectData.description}
                            onChange={(e) =>
                              setIndirectData((d) => ({
                                ...d,
                                description: e.target.value
                              }))
                            }
                          />
                        </FormControl>
                        <CostCenter
                          name="costCenterId"
                          label={t`Cost Center`}
                          isOptional
                        />
                        <DatePicker
                          name="requiredDate"
                          label={t`Required Date`}
                          value={indirectData.requiredDate ?? undefined}
                          onChange={(date) => {
                            setIndirectData((d) => ({
                              ...d,
                              requiredDate: date
                            }));
                          }}
                        />
                        <NumberControlled
                          name="purchaseQuantity"
                          label={t`Quantity`}
                          value={indirectData.purchaseQuantity}
                          onChange={(value) =>
                            setIndirectData((d) => ({
                              ...d,
                              purchaseQuantity: value
                            }))
                          }
                        />
                        <NumberControlled
                          name="supplierUnitPrice"
                          label={t`Unit Price`}
                          value={indirectData.supplierUnitPrice}
                          formatOptions={{
                            style: "currency",
                            currency:
                              routeData?.purchaseOrder?.currencyCode ??
                              company.baseCurrencyCode
                          }}
                          onChange={(value) =>
                            setIndirectData((d) => ({
                              ...d,
                              supplierUnitPrice: value
                            }))
                          }
                        />
                        <NumberControlled
                          name="supplierShippingCost"
                          label={t`Shipping`}
                          minValue={0}
                          value={indirectData.supplierShippingCost}
                          formatOptions={{
                            style: "currency",
                            currency:
                              routeData?.purchaseOrder?.currencyCode ??
                              company.baseCurrencyCode
                          }}
                          onChange={(value) =>
                            setIndirectData((d) => ({
                              ...d,
                              supplierShippingCost: value
                            }))
                          }
                        />
                        <NumberControlled
                          name="supplierTaxAmount"
                          label={t`Tax`}
                          value={indirectData.supplierTaxAmount}
                          formatOptions={{
                            style: "currency",
                            currency:
                              routeData?.purchaseOrder?.currencyCode ??
                              company.baseCurrencyCode
                          }}
                          onChange={(value) => {
                            const subtotal =
                              indirectData.supplierUnitPrice *
                                indirectData.purchaseQuantity +
                              indirectData.supplierShippingCost;
                            setIndirectData((d) => ({
                              ...d,
                              supplierTaxAmount: value,
                              taxPercent: subtotal > 0 ? value / subtotal : 0
                            }));
                          }}
                        />
                        <NumberControlled
                          name="taxPercent"
                          label={t`Tax Percent`}
                          value={indirectData.taxPercent}
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
                              indirectData.supplierUnitPrice *
                                indirectData.purchaseQuantity +
                              indirectData.supplierShippingCost;
                            setIndirectData((d) => ({
                              ...d,
                              taxPercent: value,
                              supplierTaxAmount: subtotal * value
                            }));
                          }}
                        />
                        <CustomFormFields table="purchaseOrderLine" />
                      </div>
                    </VStack>
                  </TabsContent>
                </ModalCardBody>
                <ModalCardFooter>
                  <Submit isDisabled={isDisabled} withBlocker={false}>
                    <Trans>Save</Trans>
                  </Submit>
                </ModalCardFooter>
              </ValidatedForm>
            </ModalCardContent>
          </ModalCard>
        </ModalCardProvider>
      </Tabs>
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
  const { t } = useLingui();
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
        label={t`Job`}
        options={jobOptions}
        onChange={(value) => {
          if (value) {
            setJobId(value.value as string);
          }
        }}
      />
      <Combobox
        name="jobOperationId"
        label={t`Operation`}
        options={jobOperationOptions}
      />
    </>
  );
}
