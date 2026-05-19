import { useCarbon } from "@carbon/auth";
import { DatePicker, InputControlled, ValidatedForm } from "@carbon/form";
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
  useMount,
  VStack
} from "@carbon/react";
import { getItemReadableId } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { LuBox, LuReceipt } from "react-icons/lu";
import { useParams } from "react-router";
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
import type { PurchaseInvoice } from "~/modules/invoicing";
import { purchaseInvoiceLineValidator } from "~/modules/invoicing";
import { getSupplierPartPriceBreaks } from "~/modules/items";
import { type MethodItemType, resolveSupplierPrice } from "~/modules/shared";
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
  onClose
}: PurchaseInvoiceLineFormProps) => {
  const { t } = useLingui();
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
    storageUnitId: string | null;
    minimumOrderQuantity?: number;
    taxAmount: number;
    taxPercent: number;
    priceBreaks: Array<{ quantity: number; unitPrice: number }>;
    fallbackUnitPrice: number;
  }>({
    itemId: initialValues.itemId ?? "",
    description: initialValues.description ?? "",
    quantity: initialValues.quantity ?? 1,
    supplierUnitPrice: initialValues.supplierUnitPrice ?? 0,
    supplierShippingCost: initialValues.supplierShippingCost ?? 0,
    purchaseUom: initialValues.purchaseUnitOfMeasureCode ?? "",
    inventoryUom: initialValues.inventoryUnitOfMeasureCode ?? "",
    conversionFactor: initialValues.conversionFactor ?? 1,
    storageUnitId: initialValues.storageUnitId ?? "",
    minimumOrderQuantity: undefined,
    taxAmount: initialValues.supplierTaxAmount ?? 0,
    taxPercent: initialValues.taxPercent ?? 0,
    priceBreaks: [],
    fallbackUnitPrice: initialValues.supplierUnitPrice ?? 0
  });

  // update tax amount when quantity or unit price changes
  useEffect(() => {
    const subtotal =
      itemData.supplierUnitPrice * itemData.quantity +
      itemData.supplierShippingCost;
    if (itemData.taxPercent !== 0) {
      setItemData((d) => ({
        ...d,
        taxAmount: subtotal * itemData.taxPercent
      }));
    }
  }, [
    itemData.supplierUnitPrice,
    itemData.quantity,
    itemData.supplierShippingCost,
    itemData.taxPercent
  ]);

  const isEditing = initialValues.id !== undefined;
  const isGLAccount = initialValues.invoiceLineType === "G/L Account";
  const [activeTab, setActiveTab] = useState<"direct" | "indirect">(
    isGLAccount ? "indirect" : "direct"
  );

  const [indirectData, setIndirectData] = useState<{
    accountId: string;
    costCenterId: string;
    description: string;
    quantity: number;
    requiredDate: string | null;
    supplierUnitPrice: number;
    supplierShippingCost: number;
    taxAmount: number;
    taxPercent: number;
  }>({
    accountId: initialValues.accountId ?? "",
    costCenterId: initialValues.costCenterId ?? "",
    description: initialValues.description ?? "",
    quantity: initialValues.quantity ?? 1,
    requiredDate: initialValues.requiredDate ?? null,
    supplierUnitPrice: initialValues.supplierUnitPrice ?? 0,
    supplierShippingCost: initialValues.supplierShippingCost ?? 0,
    taxAmount: initialValues.supplierTaxAmount ?? 0,
    taxPercent: initialValues.taxPercent ?? 0
  });

  useEffect(() => {
    const subtotal =
      indirectData.supplierUnitPrice * indirectData.quantity +
      indirectData.supplierShippingCost;
    if (indirectData.taxPercent !== 0) {
      setIndirectData((d) => ({
        ...d,
        taxAmount: subtotal * indirectData.taxPercent
      }));
    }
  }, [
    indirectData.supplierUnitPrice,
    indirectData.quantity,
    indirectData.supplierShippingCost,
    indirectData.taxPercent
  ]);

  // Load price breaks
  useMount(() => {
    if (!isEditing || !initialValues.itemId) return;
    const supplierId = routeData?.purchaseInvoice?.supplierId;
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
      storageUnitId: "",
      minimumOrderQuantity: undefined,
      taxAmount: 0,
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
            .eq("supplierId", routeData?.purchaseInvoice.supplierId!)
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
        const exchangeRate = routeData?.purchaseInvoice?.exchangeRate ?? 1;
        const initialQty = supplierPart?.data?.minimumOrderQuantity ?? 1;
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
          quantity: initialQty,
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
          storageUnitId: inventory.data?.defaultStorageUnitId ?? null,
          taxAmount: 0,
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
              validator={purchaseInvoiceLineValidator}
              method="post"
              action={
                isEditing
                  ? path.to.purchaseInvoiceLine(invoiceId, initialValues.id!)
                  : path.to.newPurchaseInvoiceLine(invoiceId)
              }
              className="w-full"
              isDisabled={!isEditable}
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
                        : (getItemReadableId(items, itemData?.itemId) ?? "...")
                      : "New Purchase Invoice Line"}
                  </ModalCardTitle>
                  <ModalCardDescription>
                    {isEditing ? (
                      <div className="flex flex-col items-start gap-1">
                        <span>{itemData?.description}</span>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">
                            {initialValues?.quantity}
                          </Badge>
                          <Badge variant="green">
                            {currencyFormatter.format(
                              (initialValues?.supplierUnitPrice ?? 0) +
                                (initialValues?.supplierShippingCost ?? 0)
                            )}{" "}
                            {initialValues?.purchaseUnitOfMeasureCode}
                          </Badge>
                          {(initialValues?.taxPercent ?? 0) > 0 ? (
                            <Badge variant="red">
                              {percentFormatter.format(
                                initialValues?.taxPercent ?? 0
                              )}{" "}
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
                <Hidden name="invoiceId" />
                <Hidden
                  name="exchangeRate"
                  value={routeData?.purchaseInvoice?.exchangeRate ?? 1}
                />

                <TabsContent value="direct">
                  <Hidden name="invoiceLineType" value={itemType} />
                  <Hidden name="description" value={itemData.description} />
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
                        locationId={locationId}
                        replenishmentSystem="Buy"
                        onChange={(value) => {
                          onItemChange(value?.value as string);
                        }}
                        onTypeChange={onTypeChange}
                      />

                      <FormControl className="col-span-2">
                        <FormLabel isOptional>
                          <Trans>Description</Trans>
                        </FormLabel>
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

                      {[
                        "Item",
                        "Part",
                        "Material",
                        "Tool",
                        "Consumable"
                      ].includes(itemType) && (
                        <>
                          <NumberControlled
                            minValue={itemData.minimumOrderQuantity}
                            name="quantity"
                            label={t`Quantity`}
                            value={itemData.quantity}
                            onChange={(value) => {
                              const exchangeRate =
                                routeData?.purchaseInvoice?.exchangeRate ?? 1;
                              setItemData((d) => ({
                                ...d,
                                quantity: value,
                                supplierUnitPrice: resolveSupplierPrice(
                                  d.priceBreaks,
                                  value,
                                  d.fallbackUnitPrice,
                                  exchangeRate
                                )
                              }));
                            }}
                          />

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

                          <NumberControlled
                            name="supplierUnitPrice"
                            label={t`Supplier Unit Price`}
                            value={itemData.supplierUnitPrice}
                            formatOptions={{
                              style: "currency",
                              currency:
                                routeData?.purchaseInvoice?.currencyCode ??
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
                            value={itemData.supplierShippingCost}
                            minValue={0}
                            formatOptions={{
                              style: "currency",
                              currency:
                                routeData?.purchaseInvoice?.currencyCode ??
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
                            value={itemData.taxAmount}
                            formatOptions={{
                              style: "currency",
                              currency:
                                routeData?.purchaseInvoice?.currencyCode ??
                                company.baseCurrencyCode
                            }}
                            onChange={(value) => {
                              const subtotal =
                                itemData.supplierUnitPrice * itemData.quantity +
                                itemData.supplierShippingCost;
                              setItemData((d) => ({
                                ...d,
                                taxAmount: value,
                                taxPercent: subtotal > 0 ? value / subtotal : 0
                              }));
                            }}
                          />

                          <Location
                            name="locationId"
                            label={t`Delivery Location`}
                            value={locationId}
                            onChange={onLocationChange}
                          />
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
                        </>
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
                            itemData.supplierUnitPrice * itemData.quantity +
                            itemData.supplierShippingCost;
                          setItemData((d) => ({
                            ...d,
                            taxPercent: value,
                            taxAmount: subtotal * value
                          }));
                        }}
                      />
                      <CustomFormFields table="purchaseInvoiceLine" />
                    </div>
                  </VStack>
                </TabsContent>

                <TabsContent value="indirect">
                  <Hidden name="invoiceLineType" value="G/L Account" />
                  <Hidden name="description" value={indirectData.description} />
                  <VStack>
                    <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
                      <Account
                        name="accountId"
                        label={t`GL Account`}
                        classes={["Asset", "Expense"]}
                      />
                      <InputControlled
                        label={t`Description`}
                        name="description"
                        value={indirectData.description}
                        isOptional={false}
                        onChange={(newValue) =>
                          setIndirectData((d) => ({
                            ...d,
                            description: newValue
                          }))
                        }
                      />
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
                        name="quantity"
                        label={t`Quantity`}
                        value={indirectData.quantity}
                        onChange={(value) =>
                          setIndirectData((d) => ({
                            ...d,
                            quantity: value
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
                            routeData?.purchaseInvoice?.currencyCode ??
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
                            routeData?.purchaseInvoice?.currencyCode ??
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
                        value={indirectData.taxAmount}
                        formatOptions={{
                          style: "currency",
                          currency:
                            routeData?.purchaseInvoice?.currencyCode ??
                            company.baseCurrencyCode
                        }}
                        onChange={(value) => {
                          const subtotal =
                            indirectData.supplierUnitPrice *
                              indirectData.quantity +
                            indirectData.supplierShippingCost;
                          setIndirectData((d) => ({
                            ...d,
                            taxAmount: value,
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
                              indirectData.quantity +
                            indirectData.supplierShippingCost;
                          setIndirectData((d) => ({
                            ...d,
                            taxPercent: value,
                            taxAmount: subtotal * value
                          }));
                        }}
                      />
                      <CustomFormFields table="purchaseInvoiceLine" />
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
  );
};

export default PurchaseInvoiceLineForm;
