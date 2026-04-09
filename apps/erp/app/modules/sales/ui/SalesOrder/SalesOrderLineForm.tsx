import { useCarbon } from "@carbon/auth";

import { ValidatedForm } from "@carbon/form";
import {
  Badge,
  CardAction,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Label,
  ModalCard,
  ModalCardBody,
  ModalCardContent,
  ModalCardDescription,
  ModalCardFooter,
  ModalCardHeader,
  ModalCardProvider,
  ModalCardTitle,
  useDisclosure,
  VStack
} from "@carbon/react";
import { getItemReadableId } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { BsThreeDotsVertical } from "react-icons/bs";
import { LuChevronRight, LuPlus, LuTrash, LuTruck } from "react-icons/lu";
import { useParams } from "react-router";
import type { z } from "zod";
import { MethodIcon } from "~/components";
import {
  CustomFormFields,
  DatePicker,
  Hidden,
  InputControlled,
  Item,
  Location,
  Number,
  NumberControlled,
  SelectControlled,
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
import { getDefaultShelfForJob } from "~/modules/inventory/inventory.service";
import { methodType } from "~/modules/shared";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import {
  isSalesOrderLocked,
  salesOrderLineValidator
} from "../../sales.models";
import type {
  SalesOrder,
  SalesOrderLine,
  SalesOrderLineType
} from "../../types";
import DeleteSalesOrderLine from "./DeleteSalesOrderLine";

type SalesOrderLineFormProps = {
  initialValues: z.infer<typeof salesOrderLineValidator>;
  type?: "card" | "modal";
  onClose?: () => void;
};

const SalesOrderLineForm = ({
  initialValues,
  type,
  onClose
}: SalesOrderLineFormProps) => {
  const { t } = useLingui();
  const { t: tShared } = useLingui();
  const permissions = usePermissions();
  const { carbon } = useCarbon();
  const { company } = useUser();
  const { orderId } = useParams();

  if (!orderId) throw new Error("orderId not found");

  const routeData = useRouteData<{
    salesOrder: SalesOrder;
  }>(path.to.salesOrder(orderId));

  const isLocked = isSalesOrderLocked(routeData?.salesOrder?.status);
  const isEditable = !isLocked;

  const baseCurrency = company?.baseCurrencyCode ?? "USD";

  const [lineType, setLineType] = useState(initialValues.salesOrderLineType);
  const [locationId, setLocationId] = useState(initialValues.locationId ?? "");
  const [itemData, setItemData] = useState<{
    itemId: string;
    methodType: string;
    description: string;
    unitPrice: number;
    uom: string;
    shelfId: string;
    modelUploadId: string | null;
  }>({
    itemId: initialValues.itemId ?? "",
    description: initialValues.description ?? "",
    methodType: initialValues.methodType ?? "",
    unitPrice: initialValues.unitPrice ?? 0,
    uom: initialValues.unitOfMeasureCode ?? "",
    shelfId: initialValues.shelfId ?? "",
    modelUploadId: initialValues.modelUploadId ?? null
  });

  const isEditing = initialValues.id !== undefined;

  const onTypeChange = (t: SalesOrderLineType) => {
    // @ts-ignore
    setLineType(t);
    setItemData({
      itemId: "",
      description: "",
      unitPrice: 0,
      methodType: "",
      uom: "EA",
      shelfId: "",
      modelUploadId: null
    });
  };

  const currencyFormatter = useCurrencyFormatter();
  const percentFormatter = usePercentFormatter();

  const onChange = async (itemId: string) => {
    if (!itemId) return;
    if (!carbon || !company.id) return;
    const [item, price] = await Promise.all([
      carbon
        .from("item")
        .select(
          "name, readableIdWithRevision, defaultMethodType, unitOfMeasureCode, modelUploadId"
        )
        .eq("id", itemId)
        .eq("companyId", company.id)
        .single(),
      carbon
        .from("itemUnitSalePrice")
        .select("unitSalePrice")
        .eq("itemId", itemId)
        .eq("companyId", company.id)
        .maybeSingle()
    ]);

    // Get default shelf or shelf with highest quantity
    const defaultShelfId = locationId
      ? await getDefaultShelfForJob(carbon, itemId, locationId, company.id)
      : null;

    setItemData({
      itemId,
      description: item.data?.name ?? "",
      methodType: item.data?.defaultMethodType ?? "",
      unitPrice: price.data?.unitSalePrice ?? 0,
      uom: item.data?.unitOfMeasureCode ?? "EA",
      shelfId: defaultShelfId ?? "",
      modelUploadId: item.data?.modelUploadId ?? null
    });
  };

  const onLocationChange = async (newLocation: { value: string } | null) => {
    if (!carbon) throw new Error("carbon is not defined");
    if (typeof newLocation?.value !== "string")
      throw new Error("locationId is not a string");

    setLocationId(newLocation.value);
    if (!itemData.itemId) return;

    // Get default shelf or shelf with highest quantity for the new location
    const defaultShelfId = await getDefaultShelfForJob(
      carbon,
      itemData.itemId,
      newLocation.value,
      company.id
    );

    setItemData((d) => ({
      ...d,
      shelfId: defaultShelfId ?? ""
    }));
  };

  const costsDisclosure = useDisclosure();
  const deleteDisclosure = useDisclosure();
  const [items] = useItems();

  return (
    <>
      <ModalCardProvider type={type}>
        <ModalCard
          onClose={onClose}
          isCollapsible={isEditing}
          defaultCollapsed={false}
        >
          <ModalCardContent size="xxlarge">
            <ValidatedForm
              defaultValues={initialValues}
              validator={salesOrderLineValidator}
              method="post"
              action={
                isEditing
                  ? path.to.salesOrderLine(orderId, initialValues.id!)
                  : path.to.newSalesOrderLine(orderId)
              }
              className="w-full"
              isDisabled={isEditing && isLocked}
              onSubmit={() => {
                if (type === "modal") onClose?.();
              }}
            >
              <HStack className="w-full justify-between items-start">
                <ModalCardHeader>
                  <ModalCardTitle
                    className={cn(
                      isEditing && !itemData?.itemId && "text-muted-foreground"
                    )}
                  >
                    {isEditing
                      ? getItemReadableId(items, itemData?.itemId) || "..."
                      : t`New Sales Order Line`}
                  </ModalCardTitle>
                  <ModalCardDescription>
                    {isEditing ? (
                      <div className="flex flex-col items-start gap-1">
                        <span>{itemData?.description}</span>
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className="flex items-center gap-2"
                          >
                            {initialValues?.saleQuantity}
                            <MethodIcon type={itemData.methodType} />
                          </Badge>
                          <Badge variant="green">
                            {currencyFormatter.format(
                              initialValues?.unitPrice ?? 0
                            )}{" "}
                            {initialValues?.unitOfMeasureCode}
                          </Badge>
                          {initialValues?.taxPercent > 0 ? (
                            <Badge variant="red">
                              {percentFormatter.format(
                                initialValues?.taxPercent
                              )}{" "}
                              {t`Tax`}
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      t`A sales order line contains order details for a particular item`
                    )}
                  </ModalCardDescription>
                </ModalCardHeader>
                {isEditing &&
                  permissions.can("update", "sales") &&
                  !isLocked && (
                    <CardAction className="pr-12">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <IconButton
                            icon={<BsThreeDotsVertical />}
                            aria-label={t`More`}
                            variant="ghost"
                          />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            destructive
                            onClick={deleteDisclosure.onOpen}
                          >
                            <DropdownMenuIcon icon={<LuTrash />} />
                            <Trans>Delete Line</Trans>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </CardAction>
                  )}
              </HStack>
              <ModalCardBody>
                <Hidden name="id" />
                <Hidden name="salesOrderId" />

                {!isEditing && (
                  <Hidden
                    name="description"
                    value={itemData?.description ?? ""}
                  />
                )}
                <Hidden
                  name="modelUploadId"
                  value={itemData?.modelUploadId ?? undefined}
                />
                <VStack>
                  <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
                    <Item
                      name="itemId"
                      label={lineType}
                      type={lineType as "Part"}
                      typeFieldName="salesOrderLineType"
                      value={itemData.itemId}
                      onChange={(value) => {
                        onChange(value?.value as string);
                      }}
                      onTypeChange={onTypeChange}
                    />

                    {isEditing && (
                      <InputControlled
                        name="description"
                        label={t`Short Description`}
                        onChange={(value) => {
                          setItemData((d) => ({
                            ...d,
                            description: value
                          }));
                        }}
                        value={itemData.description}
                      />
                    )}

                    {lineType !== "Comment" && (
                      <>
                        <SelectControlled
                          name="methodType"
                          label={t`Method`}
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
                        <Number name="saleQuantity" label={t`Quantity`} />
                        <UnitOfMeasure
                          name="unitOfMeasureCode"
                          label={t`Unit of Measure`}
                          value={itemData.uom}
                        />
                        <NumberControlled
                          name="unitPrice"
                          label={t`Unit Price`}
                          value={itemData.unitPrice}
                          formatOptions={{
                            style: "currency",
                            currency: baseCurrency
                          }}
                          onChange={(value) =>
                            setItemData((d) => ({
                              ...d,
                              unitPrice: value
                            }))
                          }
                        />
                        <DatePicker
                          name="promisedDate"
                          label={t`Promised Date`}
                        />
                        {[
                          "Part",
                          "Material",
                          "Service",
                          "Tool",
                          "Consumable"
                        ].includes(lineType) && (
                          <Location
                            name="locationId"
                            label={t`Location`}
                            onChange={onLocationChange}
                          />
                        )}
                        {[
                          "Part",
                          "Material",
                          "Tool",
                          "Fixture",
                          "Consumable"
                        ].includes(lineType) && (
                          <Shelf
                            name="shelfId"
                            label={t`Shelf`}
                            locationId={locationId}
                            itemId={itemData.itemId}
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
                      </>
                    )}
                    <CustomFormFields table="salesOrderLine" />
                  </div>

                  {lineType !== "Comment" && (
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
                            {(initialValues?.taxPercent ?? 0) > 0 && (
                              <Badge variant="red">
                                {percentFormatter.format(
                                  initialValues?.taxPercent ?? 0
                                )}{" "}
                                {t`Tax`}
                              </Badge>
                            )}
                            {(initialValues?.shippingCost ?? 0) > 0 && (
                              <Badge
                                variant="secondary"
                                className="flex items-center gap-1"
                              >
                                <LuTruck />
                                <span>
                                  {currencyFormatter.format(
                                    initialValues?.shippingCost ?? 0
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
                                    {t`Add-On`}
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
                          <Number
                            name="taxPercent"
                            label={t`Tax Percent`}
                            minValue={0}
                            maxValue={1}
                            step={0.0001}
                            formatOptions={{
                              style: "percent",
                              minimumFractionDigits: 0,
                              maximumFractionDigits: 2
                            }}
                          />
                          <Number
                            name="shippingCost"
                            label={t`Shipping Cost`}
                            minValue={0}
                            formatOptions={{
                              style: "currency",
                              currency: baseCurrency
                            }}
                          />
                          <Number
                            name="addOnCost"
                            label={t`Add-On Cost`}
                            formatOptions={{
                              style: "currency",
                              currency: baseCurrency
                            }}
                          />
                          <Number
                            name="nonTaxableAddOnCost"
                            label={t`Non-Taxable Add-On Cost`}
                            formatOptions={{
                              style: "currency",
                              currency: baseCurrency
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </VStack>
              </ModalCardBody>
              <ModalCardFooter>
                <Submit
                  isDisabled={
                    !isEditable ||
                    (isEditing
                      ? !permissions.can("update", "sales")
                      : !permissions.can("create", "sales"))
                  }
                >
                  {tShared({ id: "Save", message: "Save" })}
                </Submit>
              </ModalCardFooter>
            </ValidatedForm>
          </ModalCardContent>
        </ModalCard>
      </ModalCardProvider>
      {isEditing && deleteDisclosure.isOpen && (
        <DeleteSalesOrderLine
          line={initialValues as SalesOrderLine}
          onCancel={deleteDisclosure.onClose}
        />
      )}
    </>
  );
};

export default SalesOrderLineForm;
