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

import { ValidatedForm } from "@carbon/form";
import { useParams } from "@remix-run/react";
import { useState } from "react";
import { BsThreeDotsVertical } from "react-icons/bs";
import { LuTrash } from "react-icons/lu";
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
  UnitOfMeasure,
} from "~/components/Form";
import {
  useCurrencyFormatter,
  usePercentFormatter,
  usePermissions,
  useRouteData,
  useUser,
} from "~/hooks";

import { useCarbon } from "@carbon/auth";
import { getItemReadableId } from "@carbon/utils";
import { methodType } from "~/modules/shared";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import { salesOrderLineValidator } from "../../sales.models";
import type {
  SalesOrder,
  SalesOrderLine,
  SalesOrderLineType,
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
  onClose,
}: SalesOrderLineFormProps) => {
  const permissions = usePermissions();
  const { carbon } = useCarbon();
  const { company } = useUser();
  const { orderId } = useParams();

  if (!orderId) throw new Error("orderId not found");

  const routeData = useRouteData<{
    salesOrder: SalesOrder;
  }>(path.to.salesOrder(orderId));

  const isEditable = ["Draft", "To Review"].includes(
    routeData?.salesOrder?.status ?? ""
  );

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
    modelUploadId: initialValues.modelUploadId ?? null,
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
      modelUploadId: null,
    });
  };

  const currencyFormatter = useCurrencyFormatter();
  const percentFormatter = usePercentFormatter();

  const onChange = async (itemId: string) => {
    if (!itemId) return;
    if (!carbon || !company.id) return;
    const [item, shelf, price] = await Promise.all([
      carbon
        .from("item")
        .select(
          "name, readableIdWithRevision, defaultMethodType, unitOfMeasureCode, modelUploadId"
        )
        .eq("id", itemId)
        .eq("companyId", company.id)
        .single(),
      carbon
        .from("pickMethod")
        .select("defaultShelfId")
        .eq("itemId", itemId)
        .eq("companyId", company.id)
        .eq("locationId", locationId)
        .maybeSingle(),
      carbon
        .from("itemUnitSalePrice")
        .select("unitSalePrice")
        .eq("itemId", itemId)
        .eq("companyId", company.id)
        .maybeSingle(),
    ]);

    setItemData({
      itemId,
      description: item.data?.name ?? "",
      methodType: item.data?.defaultMethodType ?? "",
      unitPrice: price.data?.unitSalePrice ?? 0,
      uom: item.data?.unitOfMeasureCode ?? "EA",
      shelfId: shelf.data?.defaultShelfId ?? "",
      modelUploadId: item.data?.modelUploadId ?? null,
    });
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

  const deleteDisclosure = useDisclosure();
  const [items] = useItems();

  return (
    <>
      <ModalCardProvider type={type}>
        <ModalCard
          onClose={onClose}
          isCollapsible={isEditing}
          defaultCollapsed={isEditing}
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
                      : "New Sales Order Line"}
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
                              (initialValues?.unitPrice ?? 0) +
                                (initialValues?.addOnCost ?? 0) +
                                (initialValues?.shippingCost ?? 0)
                            )}{" "}
                            {initialValues?.unitOfMeasureCode}
                          </Badge>
                          {initialValues?.taxPercent > 0 ? (
                            <Badge variant="red">
                              {percentFormatter.format(
                                initialValues?.taxPercent
                              )}{" "}
                              Tax
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      "A sales order line contains order details for a particular item"
                    )}
                  </ModalCardDescription>
                </ModalCardHeader>
                {isEditing && permissions.can("update", "sales") && (
                  <CardAction className="pr-12">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <IconButton
                          icon={<BsThreeDotsVertical />}
                          aria-label="More"
                          variant="ghost"
                        />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          destructive
                          onClick={deleteDisclosure.onOpen}
                        >
                          <DropdownMenuIcon icon={<LuTrash />} />
                          Delete Line
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
                        label="Short Description"
                        onChange={(value) => {
                          setItemData((d) => ({
                            ...d,
                            description: value,
                          }));
                        }}
                        value={itemData.description}
                      />
                    )}

                    {lineType !== "Comment" && (
                      <>
                        <SelectControlled
                          name="methodType"
                          label="Method"
                          options={
                            methodType.map((m) => ({
                              label: (
                                <span className="flex items-center gap-2">
                                  <MethodIcon type={m} />
                                  {m}
                                </span>
                              ),
                              value: m,
                            })) ?? []
                          }
                          value={itemData.methodType}
                          onChange={(newValue) => {
                            if (newValue)
                              setItemData((d) => ({
                                ...d,
                                methodType: newValue?.value,
                              }));
                          }}
                        />
                        <Number name="saleQuantity" label="Quantity" />
                        <UnitOfMeasure
                          name="unitOfMeasureCode"
                          label="Unit of Measure"
                          value={itemData.uom}
                        />
                        <NumberControlled
                          name="unitPrice"
                          label="Unit Price"
                          value={itemData.unitPrice}
                          formatOptions={{
                            style: "currency",
                            currency: baseCurrency,
                          }}
                          onChange={(value) =>
                            setItemData((d) => ({
                              ...d,
                              unitPrice: value,
                            }))
                          }
                        />
                        <Number
                          name="shippingCost"
                          label="Shipping Cost"
                          minValue={0}
                          formatOptions={{
                            style: "currency",
                            currency: baseCurrency,
                          }}
                        />
                        <Number
                          name="addOnCost"
                          label="Add-On Cost"
                          formatOptions={{
                            style: "currency",
                            currency: baseCurrency,
                          }}
                        />

                        <Number
                          name="taxPercent"
                          label="Tax Percent"
                          minValue={0}
                          maxValue={1}
                          step={0.0001}
                          formatOptions={{
                            style: "percent",
                            minimumFractionDigits: 0,
                            maximumFractionDigits: 2,
                          }}
                        />

                        <DatePicker name="promisedDate" label="Promised Date" />
                        {[
                          "Part",
                          "Material",
                          "Service",
                          "Tool",
                          "Consumable",
                        ].includes(lineType) && (
                          <Location
                            name="locationId"
                            label="Location"
                            onChange={onLocationChange}
                          />
                        )}
                        {[
                          "Part",
                          "Material",
                          "Tool",
                          "Fixture",
                          "Consumable",
                        ].includes(lineType) && (
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
                    <CustomFormFields table="salesOrderLine" />
                  </div>
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
                  Save
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
