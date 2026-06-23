import { useCarbon } from "@carbon/auth";
import { Combobox, ValidatedForm } from "@carbon/form";
import {
  Alert,
  AlertTitle,
  Badge,
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
import { getItemReadableId } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import {
  LuBox,
  LuChevronRight,
  LuCircleAlert,
  LuLandmark,
  LuPlus,
  LuTruck
} from "react-icons/lu";
import { useParams } from "react-router";
import type { z } from "zod";
import { MethodIcon } from "~/components";
import {
  CustomFormFields,
  Hidden,
  Item,
  Location,
  Number,
  NumberControlled,
  SelectControlled,
  StorageUnit,
  Submit
} from "~/components/Form";
import {
  useCurrencyFormatter,
  usePercentFormatter,
  usePermissions,
  useRouteData,
  useUser
} from "~/hooks";
import type { SalesInvoice } from "~/modules/invoicing";
import { salesInvoiceLineValidator } from "~/modules/invoicing";
import type { MethodItemType } from "~/modules/shared";
import { methodType } from "~/modules/shared";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import { isSalesInvoiceLocked } from "../../invoicing.models";

type SalesInvoiceLineFormProps = {
  initialValues: z.infer<typeof salesInvoiceLineValidator> & {
    taxPercent?: number;
    assetReadableId?: string;
    assetName?: string;
  };
  isSalesOrderLine?: boolean;
  type?: "card" | "modal";
  onClose?: () => void;
};

const SalesInvoiceLineForm = ({
  initialValues,
  type,
  isSalesOrderLine = false,
  onClose
}: SalesInvoiceLineFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { carbon } = useCarbon();

  const { company, defaults } = useUser();
  const { invoiceId } = useParams();

  if (!invoiceId) throw new Error("invoiceId not found");

  const [items] = useItems();
  const routeData = useRouteData<{
    salesInvoice: SalesInvoice;
  }>(path.to.salesInvoice(invoiceId));

  const isLocked = isSalesInvoiceLocked(routeData?.salesInvoice?.status);
  const isEditable = !isLocked;

  const [itemType, setItemType] = useState<MethodItemType>(
    initialValues.invoiceLineType as MethodItemType
  );
  const [locationId, setLocationId] = useState(defaults.locationId ?? "");
  const [itemData, setItemData] = useState<{
    itemId: string;
    methodType: string;
    description: string;
    quantity: number;
    unitPrice: number;
    shippingCost: number;
    unitOfMeasureCode: string;
    storageUnitId: string | null;
    taxAmount: number;
    taxPercent: number;
  }>({
    itemId: initialValues.itemId ?? "",
    methodType: initialValues.methodType ?? "",
    description: initialValues.description ?? "",
    quantity: initialValues.quantity ?? 1,
    unitPrice: initialValues.unitPrice ?? 0,
    shippingCost: initialValues.shippingCost ?? 0,
    unitOfMeasureCode: initialValues.unitOfMeasureCode ?? "",
    storageUnitId: initialValues.storageUnitId ?? "",
    taxAmount:
      ((initialValues.unitPrice ?? 0) * (initialValues.quantity ?? 1) +
        (initialValues.shippingCost ?? 0)) *
      (initialValues.taxPercent ?? 0),
    taxPercent: initialValues.taxPercent ?? 0
  });

  // update tax amount when quantity or unit price changes
  useEffect(() => {
    const subtotal =
      itemData.unitPrice * itemData.quantity + itemData.shippingCost;
    if (itemData.taxPercent !== 0) {
      setItemData((d) => ({
        ...d,
        taxAmount: subtotal * itemData.taxPercent
      }));
    }
  }, [
    itemData.unitPrice,
    itemData.quantity,
    itemData.shippingCost,
    itemData.taxPercent
  ]);

  const isFixedAsset = initialValues.invoiceLineType === "Fixed Asset";
  const [activeTab, setActiveTab] = useState<"item" | "asset">(
    isFixedAsset ? "asset" : "item"
  );

  const [assetOptions, setAssetOptions] = useState<
    { value: string; label: string }[]
  >([]);
  const [assetData, setAssetData] = useState<{
    assetId: string;
    description: string;
    quantity: number;
    unitPrice: number;
    taxPercent: number;
    taxAmount: number;
    shippingCost: number;
    addOnCost: number;
    nonTaxableAddOnCost: number;
  }>({
    assetId: initialValues.assetId ?? "",
    description: initialValues.description ?? "",
    quantity: initialValues.quantity ?? 1,
    unitPrice: initialValues.unitPrice ?? 0,
    taxPercent: initialValues.taxPercent ?? 0,
    taxAmount: 0,
    shippingCost: initialValues.shippingCost ?? 0,
    addOnCost: initialValues.addOnCost ?? 0,
    nonTaxableAddOnCost: initialValues.nonTaxableAddOnCost ?? 0
  });

  useMount(() => {
    if (!carbon || !company.id) return;
    (async () => {
      const assets = await carbon
        .from("fixedAsset")
        .select("id, fixedAssetId, name")
        .eq("companyId", company.id)
        .in("status", ["Active", "Fully Depreciated"])
        .order("fixedAssetId");
      const options = (assets.data ?? []).map((a) => ({
        value: a.id,
        label: `${a.fixedAssetId} — ${a.name}`
      }));
      if (
        initialValues.assetId &&
        !options.some((o) => o.value === initialValues.assetId)
      ) {
        const current = await carbon
          .from("fixedAsset")
          .select("id, fixedAssetId, name")
          .eq("id", initialValues.assetId)
          .single();
        if (current.data) {
          options.unshift({
            value: current.data.id,
            label: `${current.data.fixedAssetId} — ${current.data.name}`
          });
        }
      }
      setAssetOptions(options);
    })();
  });

  const costsDisclosure = useDisclosure();
  const assetCostsDisclosure = useDisclosure();
  const isEditing = initialValues.id !== undefined;
  const hasInvalidMethodType =
    itemData.methodType === "Make to Order" && !isSalesOrderLine;
  const isDisabled = !isEditable
    ? true
    : hasInvalidMethodType
      ? true
      : isEditing
        ? !permissions.can("update", "purchasing")
        : !permissions.can("create", "purchasing");

  const onTypeChange = (t: MethodItemType | "Item") => {
    if (t === itemType) return;
    setItemType(t as MethodItemType);
    setItemData({
      itemId: "",
      methodType: "",
      description: "",
      quantity: 1,
      unitPrice: 0,
      shippingCost: 0,
      unitOfMeasureCode: "",
      storageUnitId: "",
      taxAmount: 0,
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
      // @ts-expect-error
      case "Service":
      // @ts-expect-error
      case "Fixture":
        const [item, inventory] = await Promise.all([
          carbon
            .from("item")
            .select(
              "name, readableIdWithRevision, type, unitOfMeasureCode, defaultMethodType, itemTrackingType, itemCost(unitCost)"
            )
            .eq("id", itemId)
            .eq("companyId", company.id)
            .single(),
          carbon
            .from("pickMethod")
            .select("defaultStorageUnitId")
            .eq("itemId", itemId)
            .eq("companyId", company.id)
            .eq("locationId", locationId!)
            .maybeSingle()
        ]);

        const itemCost = item?.data?.itemCost?.[0];
        const trackingType = item?.data?.itemTrackingType;

        // Check if item requires a sales order (excluding Make items which can be changed to Pick)
        if (trackingType === "Batch" || trackingType === "Serial") {
          const errorMessage =
            trackingType === "Batch"
              ? t`Batch items require a sales order`
              : t`Serial items require a sales order`;
          toast.error(errorMessage);
          setItemData({
            itemId: "",
            methodType: "",
            description: "",
            quantity: 1,
            unitPrice: 0,
            shippingCost: 0,
            unitOfMeasureCode: "",
            storageUnitId: "",
            taxAmount: 0,
            taxPercent: 0
          });
          return;
        }

        setItemData((prev) => ({
          ...prev,
          itemId: itemId,
          description: item.data?.name ?? "",
          methodType: item.data?.defaultMethodType ?? "",
          unitPrice:
            (itemCost?.unitCost ?? 0) /
            (routeData?.salesInvoice?.exchangeRate ?? 1),
          shippingCost: 0,
          unitOfMeasureCode: item.data?.unitOfMeasureCode ?? "EA",
          storageUnitId: inventory.data?.defaultStorageUnitId ?? null,
          taxAmount: 0,
          taxPercent: 0
        }));

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

  const currencyFormatter = useCurrencyFormatter();
  const percentFormatter = usePercentFormatter();

  const invoiceCurrency =
    routeData?.salesInvoice?.currencyCode ?? company.baseCurrencyCode;

  return (
    <Tabs
      value={activeTab}
      onValueChange={(v) => setActiveTab(v as "item" | "asset")}
      className="w-full"
    >
      <ModalCardProvider type={type}>
        <ModalCard
          onClose={onClose}
          isCollapsible={isEditing}
          defaultCollapsed={false}
        >
          <ModalCardContent size="xxlarge">
            <ValidatedForm
              defaultValues={initialValues}
              validator={salesInvoiceLineValidator}
              method="post"
              action={
                isEditing
                  ? path.to.salesInvoiceLine(invoiceId, initialValues.id!)
                  : path.to.newSalesInvoiceLine(invoiceId)
              }
              className="w-full"
              isDisabled={isEditing && isLocked}
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
                        !isFixedAsset &&
                        !itemData?.itemId &&
                        "text-muted-foreground"
                    )}
                  >
                    {isEditing ? (
                      isFixedAsset ? (
                        initialValues.assetReadableId || "Fixed Asset"
                      ) : (
                        (getItemReadableId(items, itemData?.itemId) ?? "...")
                      )
                    ) : (
                      <Trans>New Sales Invoice Line</Trans>
                    )}
                  </ModalCardTitle>
                  <ModalCardDescription>
                    {isEditing ? (
                      <div className="flex flex-col items-start gap-1">
                        <span>
                          {isFixedAsset
                            ? initialValues.assetName || assetData.description
                            : itemData?.description}
                        </span>
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className="flex items-center gap-2"
                          >
                            {initialValues?.quantity}{" "}
                            {!isFixedAsset && (
                              <MethodIcon type={itemData.methodType} />
                            )}
                          </Badge>
                          <Badge variant="green">
                            {currencyFormatter.format(
                              initialValues?.unitPrice ?? 0
                            )}{" "}
                            {initialValues?.unitOfMeasureCode}
                          </Badge>
                          {(initialValues?.taxPercent ?? 0) > 0 ? (
                            <Badge variant="red">
                              {percentFormatter.format(
                                initialValues?.taxPercent ?? 0
                              )}{" "}
                              {t`Tax`}
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      t`A sales invoice line contains invoice details for a particular item`
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
                  value={routeData?.salesInvoice?.exchangeRate ?? 1}
                />

                <TabsContent value="item">
                  <Hidden name="invoiceLineType" value={itemType} />
                  <Hidden name="description" value={itemData.description} />
                  <Hidden
                    name="unitOfMeasureCode"
                    value={itemData?.unitOfMeasureCode}
                  />

                  <VStack>
                    {hasInvalidMethodType && (
                      <Alert variant="destructive" className="mb-4">
                        <LuCircleAlert className="w-4 h-4" />
                        <AlertTitle>
                          <Trans>
                            Make items cannot be invoiced directly. Change
                            method to Pick to continue.
                          </Trans>
                        </AlertTitle>
                      </Alert>
                    )}
                    <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
                      <Item
                        name="itemId"
                        label={itemType}
                        // @ts-ignore
                        type={itemType}
                        locationId={locationId}
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
                      ].includes(itemType) && (
                        <>
                          <div className="space-y-2">
                            <SelectControlled
                              name="methodType"
                              label={t`Method`}
                              termId="method-type"
                              options={
                                methodType.map((m) => ({
                                  label: (
                                    <span className="flex items-center gap-2">
                                      <MethodIcon type={m} />
                                      {m}
                                    </span>
                                  ),
                                  value: m
                                })) ?? []
                              }
                              value={itemData.methodType}
                              onChange={(newValue) => {
                                if (newValue)
                                  setItemData((d) => ({
                                    ...d,
                                    methodType: newValue?.value
                                  }));
                              }}
                            />
                          </div>

                          <NumberControlled
                            name="quantity"
                            label={t`Quantity`}
                            value={itemData.quantity}
                            onChange={(value) => {
                              setItemData((d) => ({
                                ...d,
                                quantity: value
                              }));
                            }}
                          />

                          <NumberControlled
                            name="unitPrice"
                            label={t`Unit Price`}
                            value={itemData.unitPrice}
                            formatOptions={{
                              style: "currency",
                              currency: invoiceCurrency
                            }}
                            onChange={(value) =>
                              setItemData((d) => ({
                                ...d,
                                unitPrice: value
                              }))
                            }
                          />
                          <Location
                            name="locationId"
                            label={t`Shipping Location`}
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
                      <CustomFormFields table="salesInvoiceLine" />
                    </div>

                    {[
                      "Item",
                      "Part",
                      "Material",
                      "Tool",
                      "Consumable",
                      "Service",
                      "Fixture"
                    ].includes(itemType) && (
                      <div className="w-full">
                        <div className="w-full border border-border rounded-md shadow-sm p-4 flex flex-col gap-4 mt-4">
                          <HStack
                            className="w-full justify-between cursor-pointer"
                            onClick={costsDisclosure.onToggle}
                          >
                            <Label>
                              <Trans>Tax & Additional Costs</Trans>
                            </Label>
                            <HStack>
                              {(itemData.taxPercent ?? 0) > 0 && (
                                <Badge variant="red">
                                  {percentFormatter.format(
                                    itemData.taxPercent ?? 0
                                  )}{" "}
                                  <Trans>Tax</Trans>
                                </Badge>
                              )}
                              {(itemData.shippingCost ?? 0) > 0 && (
                                <Badge
                                  variant="secondary"
                                  className="flex items-center gap-1"
                                >
                                  <LuTruck />
                                  <span>
                                    {currencyFormatter.format(
                                      itemData.shippingCost ?? 0
                                    )}
                                  </span>
                                </Badge>
                              )}
                              {(initialValues?.addOnCost ?? 0) > 0 ||
                                ((initialValues?.nonTaxableAddOnCost ?? 0) >
                                  0 && (
                                  <Badge
                                    variant="secondary"
                                    className="flex items-center gap-1"
                                  >
                                    <LuPlus />
                                    <span>
                                      {currencyFormatter.format(
                                        (initialValues?.addOnCost ?? 0) +
                                          (initialValues?.nonTaxableAddOnCost ??
                                            0)
                                      )}{" "}
                                      <Trans>Add-On</Trans>
                                    </span>
                                  </Badge>
                                ))}

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
                                className={`transition-transform ${
                                  costsDisclosure.isOpen ? "rotate-90" : ""
                                }`}
                              />
                            </HStack>
                          </HStack>
                          <div
                            className={`grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3 pb-4 ${
                              costsDisclosure.isOpen ? "" : "hidden"
                            }`}
                          >
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
                                  itemData.unitPrice * itemData.quantity +
                                  itemData.shippingCost;
                                setItemData((d) => ({
                                  ...d,
                                  taxPercent: value,
                                  taxAmount: subtotal * value
                                }));
                              }}
                            />
                            <NumberControlled
                              name="taxAmount"
                              label={t`Tax Amount`}
                              value={itemData.taxAmount}
                              formatOptions={{
                                style: "currency",
                                currency: invoiceCurrency
                              }}
                              onChange={(value) => {
                                const subtotal =
                                  itemData.unitPrice * itemData.quantity +
                                  itemData.shippingCost;
                                setItemData((d) => ({
                                  ...d,
                                  taxAmount: value,
                                  taxPercent:
                                    subtotal > 0 ? value / subtotal : 0
                                }));
                              }}
                            />
                            <NumberControlled
                              name="shippingCost"
                              label={t`Shipping Cost`}
                              value={itemData.shippingCost}
                              minValue={0}
                              formatOptions={{
                                style: "currency",
                                currency: invoiceCurrency
                              }}
                              onChange={(value) =>
                                setItemData((d) => ({
                                  ...d,
                                  shippingCost: value
                                }))
                              }
                            />
                            <Number
                              name="addOnCost"
                              label={t`Add-On Cost`}
                              formatOptions={{
                                style: "currency",
                                currency: invoiceCurrency
                              }}
                            />
                            <Number
                              name="nonTaxableAddOnCost"
                              label={t`Non-Taxable Add-On Cost`}
                              formatOptions={{
                                style: "currency",
                                currency: invoiceCurrency
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </VStack>
                </TabsContent>

                {activeTab === "asset" && (
                  <>
                    <Hidden name="invoiceLineType" value="Fixed Asset" />
                    <Hidden name="description" value={assetData.description} />
                    <VStack>
                      <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
                        <Combobox
                          name="assetId"
                          label={t`Fixed Asset`}
                          termId="fixed-asset"
                          isOptional={false}
                          options={assetOptions}
                          value={assetData.assetId}
                          onChange={(selected) => {
                            setAssetData((d) => ({
                              ...d,
                              assetId: (selected?.value as string) ?? ""
                            }));
                          }}
                        />
                        <Location
                          name="locationId"
                          label={t`Shipping Location`}
                          value={locationId}
                          onChange={onLocationChange}
                        />
                        <FormControl>
                          <FormLabel>
                            <Trans>Description</Trans>
                          </FormLabel>
                          <Input
                            value={assetData.description}
                            onChange={(e) =>
                              setAssetData((d) => ({
                                ...d,
                                description: e.target.value
                              }))
                            }
                          />
                        </FormControl>
                        <NumberControlled
                          name="quantity"
                          label={t`Quantity`}
                          isOptional={false}
                          isDisabled
                          value={1}
                          onChange={() => undefined}
                        />
                        <NumberControlled
                          name="unitPrice"
                          label={t`Unit Price`}
                          isOptional={false}
                          value={assetData.unitPrice}
                          formatOptions={{
                            style: "currency",
                            currency: invoiceCurrency
                          }}
                          onChange={(value) =>
                            setAssetData((d) => ({ ...d, unitPrice: value }))
                          }
                        />
                        <CustomFormFields table="salesInvoiceLine" />
                      </div>

                      <div className="h-4" />

                      <div className="w-full border border-border rounded-md shadow-sm p-4 flex flex-col gap-4">
                        <HStack
                          className="w-full justify-between cursor-pointer"
                          onClick={assetCostsDisclosure.onToggle}
                        >
                          <Label>
                            <Trans>Tax &amp; Additional Costs</Trans>
                          </Label>
                          <HStack>
                            {assetData.taxPercent > 0 && (
                              <Badge variant="red">
                                {percentFormatter.format(assetData.taxPercent)}{" "}
                                <Trans>Tax</Trans>
                              </Badge>
                            )}
                            <IconButton
                              icon={<LuChevronRight />}
                              aria-label={
                                assetCostsDisclosure.isOpen
                                  ? t`Collapse Costs`
                                  : t`Expand Costs`
                              }
                              variant="ghost"
                              size="md"
                              onClick={(e) => {
                                e.stopPropagation();
                                assetCostsDisclosure.onToggle();
                              }}
                              className={`transition-transform ${assetCostsDisclosure.isOpen ? "rotate-90" : ""}`}
                            />
                          </HStack>
                        </HStack>
                        <div
                          className={`grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3 pb-4 ${
                            assetCostsDisclosure.isOpen ? "" : "hidden"
                          }`}
                        >
                          <NumberControlled
                            name="taxPercent"
                            label={t`Tax Percent`}
                            value={assetData.taxPercent}
                            minValue={0}
                            maxValue={1}
                            step={0.0001}
                            formatOptions={{
                              style: "percent",
                              minimumFractionDigits: 0,
                              maximumFractionDigits: 2
                            }}
                            onChange={(value) =>
                              setAssetData((d) => ({
                                ...d,
                                taxPercent: value
                              }))
                            }
                          />
                          <NumberControlled
                            name="shippingCost"
                            label={t`Shipping Cost`}
                            value={assetData.shippingCost}
                            minValue={0}
                            formatOptions={{
                              style: "currency",
                              currency: invoiceCurrency
                            }}
                            onChange={(value) =>
                              setAssetData((d) => ({
                                ...d,
                                shippingCost: value
                              }))
                            }
                          />
                          <NumberControlled
                            name="addOnCost"
                            label={t`Add-On Cost`}
                            value={assetData.addOnCost}
                            formatOptions={{
                              style: "currency",
                              currency: invoiceCurrency
                            }}
                            onChange={(value) =>
                              setAssetData((d) => ({
                                ...d,
                                addOnCost: value
                              }))
                            }
                          />
                          <NumberControlled
                            name="nonTaxableAddOnCost"
                            label={t`Non-Taxable Add-On Cost`}
                            value={assetData.nonTaxableAddOnCost}
                            formatOptions={{
                              style: "currency",
                              currency: invoiceCurrency
                            }}
                            onChange={(value) =>
                              setAssetData((d) => ({
                                ...d,
                                nonTaxableAddOnCost: value
                              }))
                            }
                          />
                        </div>
                      </div>
                    </VStack>
                  </>
                )}
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

export default SalesInvoiceLineForm;
