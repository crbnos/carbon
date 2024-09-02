import {
  CardAction,
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
import { useFetcher, useParams } from "@remix-run/react";
import { useEffect, useMemo, useState } from "react";
import { BsThreeDotsVertical } from "react-icons/bs";
import { LuTrash } from "react-icons/lu";
import type { z } from "zod";
import {
  ComboboxControlled,
  CustomFormFields,
  DatePicker,
  Hidden,
  Item,
  Location,
  Number,
  NumberControlled,
  Select,
  Submit,
  UnitOfMeasure,
} from "~/components/Form";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import { useSupabase } from "~/lib/supabase";
import type { getShelvesList } from "~/modules/items";
import type {
  SalesOrder,
  SalesOrderLine,
  SalesOrderLineType,
} from "~/modules/sales";
import { salesOrderLineType, salesOrderLineValidator } from "~/modules/sales";
import { path } from "~/utils/path";
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
  const { supabase } = useSupabase();
  const { company, defaults } = useUser();
  const { orderId } = useParams();

  if (!orderId) throw new Error("orderId not found");

  const routeData = useRouteData<{
    salesOrder: SalesOrder;
  }>(path.to.salesOrder(orderId));

  const isEditable = ["Draft", "To Review"].includes(
    routeData?.salesOrder?.status ?? ""
  );

  const [lineType, setLineType] = useState(initialValues.salesOrderLineType);
  const [locationId, setLocationId] = useState(defaults.locationId ?? "");
  const [itemData, setItemData] = useState<{
    itemId: string;
    itemReadableId?: string;
    description: string;
    unitPrice: number;
    uom: string;
    shelfId: string;
    modelUploadId: string | null;
  }>({
    itemId: initialValues.itemId ?? "",
    itemReadableId: initialValues.itemReadableId ?? "",
    description: initialValues.description ?? "",
    unitPrice: initialValues.unitPrice ?? 0,
    uom: initialValues.unitOfMeasureCode ?? "",
    shelfId: initialValues.shelfId ?? "",
    modelUploadId: initialValues.modelUploadId ?? null,
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

  const salesOrderLineTypeOptions = salesOrderLineType.map((type) => ({
    label: type,
    value: type,
  }));

  const onTypeChange = (t: SalesOrderLineType) => {
    // @ts-ignore
    setLineType(t);
    setItemData({
      itemId: "",
      itemReadableId: "",
      description: "",
      unitPrice: 0,
      uom: "EA",
      shelfId: "",
      modelUploadId: null,
    });
  };

  const onChange = async (itemId: string) => {
    if (!itemId) return;
    if (!supabase || !company.id) return;
    const [item, shelf, price] = await Promise.all([
      supabase
        .from("item")
        .select("name, readableId, unitOfMeasureCode, modelUploadId")
        .eq("id", itemId)
        .eq("companyId", company.id)
        .single(),
      supabase
        .from("pickMethod")
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
      uom: item.data?.unitOfMeasureCode ?? "EA",
      shelfId: shelf.data?.defaultShelfId ?? "",
      modelUploadId: item.data?.modelUploadId ?? null,
    });
  };

  const onLocationChange = async (newLocation: { value: string } | null) => {
    if (!supabase) throw new Error("supabase is not defined");
    if (typeof newLocation?.value !== "string")
      throw new Error("locationId is not a string");

    setLocationId(newLocation.value);
    if (!itemData.itemId) return;
    const shelf = await supabase
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

  return (
    <>
      <ModalCardProvider type={type}>
        <ModalCard onClose={onClose}>
          <ModalCardContent>
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
                  <ModalCardTitle>
                    {isEditing
                      ? itemData?.itemReadableId ?? "Sales Order Line"
                      : "New Sales Order Line"}
                  </ModalCardTitle>
                  <ModalCardDescription>
                    {isEditing
                      ? itemData?.description
                      : "A sales order line contains order details for a particular item"}
                  </ModalCardDescription>
                </ModalCardHeader>
                {isEditing && permissions.can("update", "sales") && (
                  <CardAction>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <IconButton
                          icon={<BsThreeDotsVertical />}
                          aria-label="More"
                          variant="secondary"
                        />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={deleteDisclosure.onOpen}>
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
                <Hidden
                  name="itemReadableId"
                  value={itemData?.itemReadableId}
                />

                <Hidden
                  name="modelUploadId"
                  value={itemData?.modelUploadId ?? undefined}
                />
                <VStack>
                  <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
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
                    ].includes(lineType) && (
                      <Item
                        name="itemId"
                        label={lineType}
                        // @ts-ignore
                        type={lineType}
                        onChange={(value) => {
                          onChange(value?.value as string);
                        }}
                      />
                    )}

                    {lineType !== "Comment" && (
                      <>
                        <Number name="saleQuantity" label="Quantity" />

                        <NumberControlled
                          name="unitPrice"
                          label="Unit Price"
                          value={itemData.unitPrice}
                          formatOptions={{
                            style: "currency",
                            currency: "USD",
                          }}
                          onChange={(value) =>
                            setItemData((d) => ({
                              ...d,
                              unitPrice: value,
                            }))
                          }
                        />
                        <Number
                          name="addOnCost"
                          label="Add-On Cost"
                          formatOptions={{
                            style: "currency",
                            currency: "USD",
                          }}
                        />
                        <UnitOfMeasure
                          name="unitOfMeasureCode"
                          label="Unit of Measure"
                          value={itemData.uom}
                        />
                        <DatePicker name="promisedDate" label="Promised Date" />
                        {[
                          "Part",
                          "Material",
                          "Service",
                          "Tool",
                          "Fixture",
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
