// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import { convertUnitPrice } from "@carbon/database/supplier-part-price";
import {
  Combobox,
  DatePicker,
  InputControlled,
  ValidatedForm
} from "@carbon/form";
import {
  Badge,
  Button,
  cn,
  FormControl,
  FormLabel,
  HStack,
  IconButton,
  Input,
  Label,
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
  toast,
  useDisclosure,
  useMount,
  VStack
} from "@carbon/react";
import {
  distinctItemText,
  getItemReadableId,
  INPUT_FORMAT
} from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuBox, LuChevronRight, LuLandmark, LuReceipt } from "react-icons/lu";
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
  TaxFields,
  UnitOfMeasure,
  useTaxPair
} from "~/components/Form";
import { itemTypeLabel } from "~/components/Form/itemTypeLabel";
import {
  useCurrencyDecimals,
  useCurrencyFormatter,
  usePercentFormatter,
  usePermissions,
  useRouteData,
  useUser
} from "~/hooks";
import type { PurchaseInvoice } from "~/modules/invoicing";
import { purchaseInvoiceLineValidator } from "~/modules/invoicing";
import {
  EACH_UNIT_OF_MEASURE_CODE,
  getSupplierPartPricing
} from "~/modules/items";
import {
  type ItemType,
  itemType,
  resolveSupplierPrice,
  type SupplierPartPricing
} from "~/modules/shared";
import { useItems } from "~/stores";
import { path } from "~/utils/path";

type PurchaseInvoiceLineFormProps = {
  initialValues: z.infer<typeof purchaseInvoiceLineValidator> & {
    taxPercent?: number;
    assetReadableId?: string;
    assetName?: string;
  };
  type?: "card" | "modal";
  onClose?: () => void;
};

const PurchaseInvoiceLineForm = ({
  initialValues,
  type,
  onClose
}: PurchaseInvoiceLineFormProps) => {
  const { t, i18n } = useLingui();
  const permissions = usePermissions();
  const { carbon } = useCarbon();

  const [items] = useItems();
  const { company, defaults } = useUser();
  const { invoiceId } = useParams();

  if (!invoiceId) throw new Error("invoiceId not found");

  const routeData = useRouteData<{
    purchaseInvoice: PurchaseInvoice;
    currency: { decimalPlaces: number } | null;
  }>(path.to.purchaseInvoice(invoiceId));

  const isEditable = ["Draft"].includes(
    routeData?.purchaseInvoice?.status ?? ""
  );
  // Settlement decimals come from the document currency's row (loader data);
  // 2 is only the last resort for a currency-less document
  // The loader's currency row is the primary source — it is correct on first
  // paint, which matters because these formatters take part in the blur commit.
  // The hook covers documents whose loader doesn't carry the row; the single
  // documented last-resort lives inside it rather than as a literal here.
  const invoiceCurrency =
    routeData?.purchaseInvoice?.currencyCode ?? company.baseCurrencyCode;
  const configuredDecimals = useCurrencyDecimals(invoiceCurrency);
  const currencyDecimals =
    routeData?.currency?.decimalPlaces ?? configuredDecimals;

  const [lineType, setLineType] = useState<ItemType>(
    initialValues.invoiceLineType as ItemType
  );
  // The picker's type filter. It starts on every item type; the line's own
  // type (above) is a real enum value — "Item" is not one — and follows the
  // selected item.
  const [itemFilter, setItemFilter] = useState<ItemType | "Item">("Item");
  const isService = lineType === "Service";
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
    pricing: SupplierPartPricing | null;
    // In the INVOICE's currency: the price used when the supplier part has
    // none for the quantity.
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
    pricing: null,
    fallbackUnitPrice: initialValues.supplierUnitPrice ?? 0
  });

  // The invoice's currency and rate: what a supplier part's price converts into.
  const invoiceCurrencyRate = {
    currencyCode: invoiceCurrency,
    exchangeRate: routeData?.purchaseInvoice?.exchangeRate ?? 1
  };

  // Re-derive the tax amount when the line's base changes — never on mount, so
  // a saved manual override survives being reopened.
  const itemTax = useTaxPair({
    unitPrice: itemData.supplierUnitPrice,
    quantity: itemData.quantity,
    shippingCost: itemData.supplierShippingCost,
    percent: itemData.taxPercent,
    amount: itemData.taxAmount,
    currency: invoiceCurrency,
    currencyDecimals,
    onChange: ({ percent, amount }) =>
      setItemData((d) => ({ ...d, taxPercent: percent, taxAmount: amount }))
  });

  const isEditing = initialValues.id !== undefined;
  const isGLAccount = initialValues.invoiceLineType === "G/L Account";
  const isFixedAsset = initialValues.invoiceLineType === "Fixed Asset";
  const [activeTab, setActiveTab] = useState<"item" | "gl-account" | "asset">(
    isFixedAsset ? "asset" : isGLAccount ? "gl-account" : "item"
  );

  const [assetOptions, setAssetOptions] = useState<
    { value: string; label: string; locationId: string | null }[]
  >([]);

  useMount(() => {
    (async () => {
      const assets = await carbon
        .from("fixedAsset")
        .select("id, fixedAssetId, name, locationId")
        .eq("companyId", company.id)
        // Under Construction too: a CIP asset collects purchased cost.
        .in("status", ["Draft", "Under Construction"])
        .order("fixedAssetId");
      const options = (assets.data ?? []).map((a) => ({
        value: a.id,
        label: `${a.fixedAssetId} — ${a.name}`,
        locationId: a.locationId
      }));
      if (
        initialValues.assetId &&
        !options.some((o) => o.value === initialValues.assetId)
      ) {
        const current = await carbon
          .from("fixedAsset")
          .select("id, fixedAssetId, name, locationId")
          .eq("id", initialValues.assetId)
          .single();
        if (current.data) {
          options.unshift({
            value: current.data.id,
            label: `${current.data.fixedAssetId} — ${current.data.name}`,
            locationId: current.data.locationId
          });
        }
      }
      setAssetOptions(options);
    })();
  });

  const costsDisclosure = useDisclosure();
  const indirectCostsDisclosure = useDisclosure();

  const [indirectData, setIndirectData] = useState<{
    accountId: string;
    assetId: string;
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
    assetId: initialValues.assetId ?? "",
    costCenterId: initialValues.costCenterId ?? "",
    description: initialValues.description ?? "",
    quantity: initialValues.quantity ?? 1,
    requiredDate: initialValues.requiredDate ?? null,
    supplierUnitPrice: initialValues.supplierUnitPrice ?? 0,
    supplierShippingCost: initialValues.supplierShippingCost ?? 0,
    taxAmount: initialValues.supplierTaxAmount ?? 0,
    taxPercent: initialValues.taxPercent ?? 0
  });

  const indirectTax = useTaxPair({
    unitPrice: indirectData.supplierUnitPrice,
    quantity: indirectData.quantity,
    shippingCost: indirectData.supplierShippingCost,
    percent: indirectData.taxPercent,
    amount: indirectData.taxAmount,
    currency: invoiceCurrency,
    currencyDecimals,
    onChange: ({ percent, amount }) =>
      setIndirectData((d) => ({ ...d, taxPercent: percent, taxAmount: amount }))
  });

  // Load price breaks. The part's own price is left out: below every break
  // the line keeps the price it already has.
  useMount(() => {
    if (!isEditing || !initialValues.itemId) return;
    const supplierId = routeData?.purchaseInvoice?.supplierId;
    if (!supplierId) return;

    (async () => {
      const supplierPart = await carbon
        .from("supplierPart")
        .select("id, companyId, currencyCode, supplierUnitPrice")
        .eq("itemId", initialValues.itemId!)
        .eq("companyId", company.id)
        .eq("supplierId", supplierId)
        .maybeSingle();

      if (supplierPart?.data?.id) {
        const pricing = await getSupplierPartPricing(
          carbon,
          supplierPart.data,
          company.baseCurrencyCode,
          invoiceCurrency
        );
        if (pricing.data) {
          setItemData((d) => ({
            ...d,
            pricing: { ...pricing.data, supplierUnitPrice: null }
          }));
        }
      }
    })();
  });

  const isDisabled = isEditing
    ? !permissions.can("update", "purchasing")
    : !permissions.can("create", "purchasing");

  // These badges render DOCUMENT-currency values, so both formatters take the
  // document's currency and decimals. Defaulting to base currency is what
  // printed a JPY shipping cost as "$20.00".
  const currencyFormatter = useCurrencyFormatter({
    currency: invoiceCurrency,
    decimalPlaces: currencyDecimals
  });
  const priceFormatter = useCurrencyFormatter({
    rate: true,
    currency: invoiceCurrency,
    decimalPlaces: currencyDecimals
  });
  const percentFormatter = usePercentFormatter();

  const onTypeChange = (t: ItemType | "Item") => {
    if (t === itemFilter) return;
    setItemFilter(t);
    // Widening to every type keeps the selected item; narrowing to another
    // type clears it.
    if (t === "Item" || t === lineType) return;
    setLineType(t as ItemType);
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
      pricing: null,
      fallbackUnitPrice: 0
    });
  };

  const onItemChange = async (itemId: string) => {
    if (!carbon) throw new Error("Carbon client not found");
    switch (lineType) {
      // @ts-expect-error
      case "Item":
      case "Consumable":
      case "Material":
      case "Part":
      case "Tool":
      case "Service":
      // @ts-expect-error
      case "Fixture":
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
        const initialQty = supplierPart?.data?.minimumOrderQuantity ?? 1;
        // The item's cost is in BASE currency; the line wants the invoice's.
        const fallbackUnitPrice = convertUnitPrice(
          itemCost?.unitCost ?? 0,
          { currencyCode: company.baseCurrencyCode, exchangeRate: 1 },
          invoiceCurrencyRate
        );

        // The supplier's price is in the supplier part's currency, converted
        // into the invoice's at the current rate.
        const pricing = supplierPart?.data
          ? await getSupplierPartPricing(
              carbon,
              supplierPart.data,
              company.baseCurrencyCode,
              invoiceCurrency
            )
          : null;
        if (pricing?.error) {
          toast.error(pricing.error.message);
        }
        const resolvedPrice = resolveSupplierPrice(
          pricing?.data ?? null,
          initialQty,
          invoiceCurrencyRate,
          fallbackUnitPrice
        );

        // A service is always bought and "stocked" in EA, 1:1.
        const isServiceItem = item.data?.type === "Service";
        setItemData({
          itemId: itemId,
          description: item.data?.name ?? "",
          quantity: initialQty,
          supplierUnitPrice: resolvedPrice,
          supplierShippingCost: 0,
          purchaseUom: isServiceItem
            ? EACH_UNIT_OF_MEASURE_CODE
            : (supplierPart?.data?.supplierUnitOfMeasureCode ??
              itemReplenishment?.purchasingUnitOfMeasureCode ??
              item.data?.unitOfMeasureCode ??
              "EA"),
          inventoryUom: isServiceItem
            ? EACH_UNIT_OF_MEASURE_CODE
            : (item.data?.unitOfMeasureCode ?? "EA"),
          conversionFactor: isServiceItem
            ? 1
            : (supplierPart?.data?.conversionFactor ??
              itemReplenishment?.conversionFactor ??
              1),
          storageUnitId: inventory.data?.defaultStorageUnitId ?? null,
          taxAmount: 0,
          taxPercent: 0,
          pricing: pricing?.data ?? null,
          fallbackUnitPrice
        });

        if (item.data?.type) {
          setLineType(item.data.type as ItemType);
        }

        break;
      default:
        throw new Error(
          `Invalid invoice line type: ${lineType} is not implemented`
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

  const lineSubtitle = isFixedAsset
    ? initialValues.assetName || indirectData.description
    : isGLAccount
      ? "G/L Account"
      : distinctItemText(
          getItemReadableId(items, itemData?.itemId),
          itemData?.description
        );

  return (
    <Tabs
      value={activeTab}
      onValueChange={(v) => setActiveTab(v as "item" | "gl-account" | "asset")}
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
                        !isFixedAsset &&
                        !itemData?.itemId &&
                        "text-muted-foreground"
                    )}
                  >
                    {isEditing
                      ? isFixedAsset
                        ? initialValues.assetReadableId || "Fixed Asset"
                        : isGLAccount
                          ? indirectData.description || "G/L Account"
                          : (getItemReadableId(items, itemData?.itemId) ??
                            "...")
                      : "New Purchase Invoice Line"}
                  </ModalCardTitle>
                  <ModalCardDescription>
                    {isEditing ? (
                      <div className="flex flex-col items-start gap-1">
                        {lineSubtitle && <span>{lineSubtitle}</span>}
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">
                            {initialValues?.quantity}
                          </Badge>
                          <Badge variant="green">
                            {priceFormatter.format(
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
                      <TabsTrigger value="item">
                        <LuBox className="mr-1" />
                        <Trans>Item</Trans>
                      </TabsTrigger>
                      <TabsTrigger value="gl-account">
                        <LuReceipt className="mr-1" />
                        <Trans>GL Account</Trans>
                      </TabsTrigger>
                      <TabsTrigger value="asset">
                        <LuLandmark className="mr-1" />
                        <Trans>Asset</Trans>
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

                <TabsContent value="item">
                  <Hidden name="invoiceLineType" value={lineType} />
                  {activeTab === "item" && (
                    <Hidden name="description" value={itemData.description} />
                  )}
                  <Hidden
                    name="inventoryUnitOfMeasureCode"
                    value={
                      isService
                        ? EACH_UNIT_OF_MEASURE_CODE
                        : itemData?.inventoryUom
                    }
                  />
                  {/* A service is always bought in EA, so no unit of
                      measure or conversion factor is asked for. */}
                  {isService && (
                    <>
                      <Hidden
                        name="purchaseUnitOfMeasureCode"
                        value={EACH_UNIT_OF_MEASURE_CODE}
                      />
                      <Hidden name="conversionFactor" value={1} />
                    </>
                  )}
                  <VStack>
                    <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
                      <Item
                        autoFocus={!isEditing}
                        name="itemId"
                        label={i18n._(itemTypeLabel(itemFilter))}
                        type={itemFilter}
                        validItemTypes={[...itemType]}
                        locationId={locationId}
                        replenishmentSystem="Buy"
                        // Required by a refine rather than the schema object,
                        // so the field can't infer this for itself.
                        isOptional={false}
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
                        "Consumable",
                        "Service",
                        "Fixture"
                      ].includes(lineType) && (
                        <>
                          <NumberControlled
                            minValue={itemData.minimumOrderQuantity}
                            name="quantity"
                            label={t`Quantity`}
                            value={itemData.quantity}
                            onChange={(value) => {
                              setItemData((d) => ({
                                ...d,
                                quantity: value,
                                supplierUnitPrice: resolveSupplierPrice(
                                  d.pricing,
                                  value,
                                  invoiceCurrencyRate,
                                  d.fallbackUnitPrice
                                )
                              }));
                            }}
                          />

                          {!isService && (
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
                            label={t`Supplier Unit Price`}
                            value={itemData.supplierUnitPrice}
                            formatOptions={INPUT_FORMAT.rate(
                              invoiceCurrency,
                              currencyDecimals
                            )}
                            onChange={(value) =>
                              setItemData((d) => ({
                                ...d,
                                supplierUnitPrice: value
                              }))
                            }
                          />

                          <Location
                            name="locationId"
                            label={t`Delivery Location`}
                            value={locationId}
                            onChange={onLocationChange}
                          />
                          {lineType !== "Service" && (
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
                        </>
                      )}
                      <CustomFormFields table="purchaseInvoiceLine" />
                    </div>

                    <div className="w-full border border-border rounded-md shadow-sm p-4 flex flex-col gap-4 mt-4">
                      <HStack
                        className="w-full justify-between cursor-pointer"
                        onClick={costsDisclosure.onToggle}
                      >
                        <Label>
                          <Trans>Tax &amp; Shipping</Trans>
                        </Label>
                        <HStack>
                          {itemData.taxPercent > 0 && (
                            <Badge variant="red">
                              {percentFormatter.format(itemData.taxPercent)}{" "}
                              <Trans>Tax</Trans>
                            </Badge>
                          )}
                          {itemData.supplierShippingCost > 0 && (
                            <Badge variant="secondary">
                              {currencyFormatter.format(
                                itemData.supplierShippingCost
                              )}
                            </Badge>
                          )}
                          <IconButton
                            icon={<LuChevronRight />}
                            aria-label={
                              costsDisclosure.isOpen
                                ? t`Collapse Costs`
                                : t`Expand Costs`
                            }
                            variant="ghost"
                            size="md"
                            onClick={(e) => {
                              e.stopPropagation();
                              costsDisclosure.onToggle();
                            }}
                            className={`transition-transform ${costsDisclosure.isOpen ? "rotate-90" : ""}`}
                          />
                        </HStack>
                      </HStack>
                      <div
                        className={`grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3 pb-4 ${
                          costsDisclosure.isOpen ? "" : "hidden"
                        }`}
                      >
                        <NumberControlled
                          name="supplierShippingCost"
                          label={t`Shipping`}
                          value={itemData.supplierShippingCost}
                          minValue={0}
                          formatOptions={INPUT_FORMAT.money(
                            invoiceCurrency,
                            currencyDecimals
                          )}
                          onChange={(value) =>
                            setItemData((d) => ({
                              ...d,
                              supplierShippingCost: value
                            }))
                          }
                        />
                        <TaxFields
                          {...itemTax}
                          amountName="supplierTaxAmount"
                          percentName="taxPercent"
                        />
                      </div>
                    </div>
                  </VStack>
                </TabsContent>

                {(activeTab === "gl-account" || activeTab === "asset") && (
                  <>
                    <Hidden
                      name="invoiceLineType"
                      value={
                        activeTab === "asset" ? "Fixed Asset" : "G/L Account"
                      }
                    />

                    <VStack>
                      <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
                        {activeTab === "gl-account" ? (
                          <>
                            <Account
                              name="accountId"
                              label={t`GL Account`}
                              classes={["Expense"]}
                              isOptional={false}
                            />
                            <CostCenter
                              name="costCenterId"
                              label={t`Cost Center`}
                              termId="cost-center"
                              isOptional
                            />
                          </>
                        ) : (
                          <>
                            <Combobox
                              name="assetId"
                              label={t`Fixed Asset`}
                              termId="fixed-asset"
                              isOptional={false}
                              options={assetOptions}
                              value={indirectData.assetId}
                              onChange={(selected) => {
                                setIndirectData((d) => ({
                                  ...d,
                                  assetId: (selected?.value as string) ?? ""
                                }));
                                const asset = assetOptions.find(
                                  (o) => o.value === selected?.value
                                );
                                if (asset?.locationId && !locationId) {
                                  setLocationId(asset.locationId);
                                }
                              }}
                            />
                            <Location
                              name="locationId"
                              label={t`Location`}
                              value={locationId}
                              onChange={(newLocation) => {
                                setLocationId(newLocation?.value ?? "");
                              }}
                            />
                          </>
                        )}
                        <InputControlled
                          className={
                            activeTab === "asset" ? "col-span-1" : "col-span-3"
                          }
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
                          isOptional={false}
                          isDisabled={activeTab === "asset"}
                          value={
                            activeTab === "asset" ? 1 : indirectData.quantity
                          }
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
                          isOptional={false}
                          value={indirectData.supplierUnitPrice}
                          formatOptions={INPUT_FORMAT.rate(
                            invoiceCurrency,
                            currencyDecimals
                          )}
                          onChange={(value) =>
                            setIndirectData((d) => ({
                              ...d,
                              supplierUnitPrice: value
                            }))
                          }
                        />
                        <CustomFormFields table="purchaseInvoiceLine" />
                      </div>

                      <div className="h-4" />

                      <div className="w-full border border-border rounded-md shadow-sm p-4 flex flex-col gap-4">
                        <HStack
                          className="w-full justify-between cursor-pointer"
                          onClick={indirectCostsDisclosure.onToggle}
                        >
                          <Label>
                            <Trans>Tax &amp; Shipping</Trans>
                          </Label>
                          <HStack>
                            {indirectData.taxPercent > 0 && (
                              <Badge variant="red">
                                {percentFormatter.format(
                                  indirectData.taxPercent
                                )}{" "}
                                <Trans>Tax</Trans>
                              </Badge>
                            )}
                            {indirectData.supplierShippingCost > 0 && (
                              <Badge variant="secondary">
                                {currencyFormatter.format(
                                  indirectData.supplierShippingCost
                                )}
                              </Badge>
                            )}
                            <IconButton
                              icon={<LuChevronRight />}
                              aria-label={
                                indirectCostsDisclosure.isOpen
                                  ? t`Collapse Costs`
                                  : t`Expand Costs`
                              }
                              variant="ghost"
                              size="md"
                              onClick={(e) => {
                                e.stopPropagation();
                                indirectCostsDisclosure.onToggle();
                              }}
                              className={`transition-transform ${indirectCostsDisclosure.isOpen ? "rotate-90" : ""}`}
                            />
                          </HStack>
                        </HStack>
                        <div
                          className={`grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3 pb-4 ${
                            indirectCostsDisclosure.isOpen ? "" : "hidden"
                          }`}
                        >
                          <NumberControlled
                            name="supplierShippingCost"
                            label={t`Shipping`}
                            minValue={0}
                            value={indirectData.supplierShippingCost}
                            formatOptions={INPUT_FORMAT.money(
                              invoiceCurrency,
                              currencyDecimals
                            )}
                            onChange={(value) =>
                              setIndirectData((d) => ({
                                ...d,
                                supplierShippingCost: value
                              }))
                            }
                          />
                          <TaxFields
                            {...indirectTax}
                            amountName="supplierTaxAmount"
                            percentName="taxPercent"
                          />
                        </div>
                      </div>
                    </VStack>
                  </>
                )}
              </ModalCardBody>
              <ModalCardFooter>
                <HStack className="justify-end gap-2">
                  {onClose && (
                    <Button variant="ghost" onClick={onClose}>
                      <Trans>Cancel</Trans>
                    </Button>
                  )}
                  <Submit isDisabled={isDisabled} withBlocker={false}>
                    <Trans>Save</Trans>
                  </Submit>
                </HStack>
              </ModalCardFooter>
            </ValidatedForm>
          </ModalCardContent>
        </ModalCard>
      </ModalCardProvider>
    </Tabs>
  );
};

export default PurchaseInvoiceLineForm;
