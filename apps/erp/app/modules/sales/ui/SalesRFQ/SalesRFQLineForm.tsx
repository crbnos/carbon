import {
  Badge,
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
  toast,
  useDisclosure,
  VStack,
} from "@carbon/react";

import { useCarbon } from "@carbon/auth";
import { ValidatedForm } from "@carbon/form";
import { useParams } from "@remix-run/react";
import { useState } from "react";
import { BsThreeDotsVertical } from "react-icons/bs";
import { LuTrash } from "react-icons/lu";
import type { z } from "zod";
import {
  ArrayNumeric,
  CustomFormFields,
  Hidden,
  InputControlled,
  Item,
  Submit,
  UnitOfMeasure,
} from "~/components/Form";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import { path } from "~/utils/path";
import { salesRfqLineValidator } from "../../sales.models";
import type { SalesRFQ, SalesRFQLine } from "../../types";
import DeleteSalesRFQLine from "./DeleteSalesRFQLine";

type SalesRFQLineFormProps = {
  initialValues: z.infer<typeof salesRfqLineValidator>;
  type?: "card" | "modal";
  onClose?: () => void;
};

const SalesRFQLineForm = ({
  initialValues,
  type,
  onClose,
}: SalesRFQLineFormProps) => {
  const permissions = usePermissions();
  const { company } = useUser();
  const { carbon } = useCarbon();

  const { rfqId } = useParams();

  if (!rfqId) throw new Error("rfqId not found");

  const routeData = useRouteData<{
    rfqSummary: SalesRFQ;
  }>(path.to.salesRfq(rfqId));

  const isEditable = ["Draft", "Ready for Quote"].includes(
    routeData?.rfqSummary?.status ?? ""
  );

  const isEditing = initialValues.id !== undefined;

  const [itemData, setItemData] = useState<{
    customerPartId: string;
    customerPartRevision: string;
    itemId: string;
    description: string;
    unitOfMeasureCode: string;
    modelUploadId: string | null;
  }>({
    customerPartId: initialValues.customerPartId ?? "",
    customerPartRevision: initialValues.customerPartRevision ?? "",
    itemId: initialValues.itemId ?? "",
    description: initialValues.description ?? "",
    unitOfMeasureCode: initialValues.unitOfMeasureCode ?? "EA",
    modelUploadId: initialValues.modelUploadId ?? null,
  });

  const onCustomerPartChange = async (customerPartId: string) => {
    if (!carbon || !routeData?.rfqSummary?.customerId) return;

    const customerPart = await carbon
      .from("customerPartToItem")
      .select("itemId")
      .eq("customerPartId", customerPartId)
      .eq("customerPartRevision", itemData.customerPartRevision ?? "")
      .eq("customerId", routeData?.rfqSummary?.customerId!)
      .maybeSingle();

    if (customerPart.error) {
      toast.error("Failed to load customer part details");
      return;
    }

    if (customerPart.data && customerPart.data.itemId && !itemData.itemId) {
      onItemChange(customerPart.data.itemId);
    }
  };

  const onCustomerPartRevisionChange = async (customerPartRevision: string) => {
    if (
      !carbon ||
      !routeData?.rfqSummary?.customerId ||
      !itemData.customerPartId
    )
      return;

    const customerPart = await carbon
      .from("customerPartToItem")
      .select("itemId")
      .eq("customerPartId", itemData.customerPartId)
      .eq("customerPartRevision", customerPartRevision ?? "")
      .eq("customerId", routeData?.rfqSummary?.customerId!)
      .maybeSingle();

    if (customerPart.error) {
      toast.error("Failed to load customer part details");
      return;
    }

    if (customerPart.data && customerPart.data.itemId && !itemData.itemId) {
      onItemChange(customerPart.data.itemId);
    }
  };

  const onItemChange = async (itemId: string) => {
    if (!carbon) return;

    const [item, customerPart] = await Promise.all([
      carbon
        .from("item")
        .select("name, unitOfMeasureCode, modelUploadId")
        .eq("id", itemId)
        .eq("companyId", company.id)
        .single(),
      carbon
        .from("customerPartToItem")
        .select("customerPartId, customerPartRevision")
        .eq("itemId", itemId)
        .eq("customerId", routeData?.rfqSummary?.customerId!)
        .maybeSingle(),
    ]);

    if (item.error) {
      toast.error("Failed to load item details");
      return;
    }

    const newItemData = {
      ...itemData,
      itemId,
      description: item.data?.name ?? "",
      unitOfMeasureCode: item.data?.unitOfMeasureCode ?? "EA",
      modelUploadId: item.data?.modelUploadId ?? null,
    };

    if (customerPart.data && !itemData.customerPartId) {
      newItemData.customerPartId = customerPart.data.customerPartId;
      newItemData.customerPartRevision =
        customerPart.data.customerPartRevision ?? "";
    }

    setItemData(newItemData);
  };

  const deleteDisclosure = useDisclosure();

  return (
    <>
      <ModalCardProvider type={type}>
        <ModalCard
          onClose={onClose}
          isCollapsible={isEditing}
          defaultCollapsed={isEditing}
        >
          <ModalCardContent>
            <ValidatedForm
              defaultValues={initialValues}
              validator={salesRfqLineValidator}
              method="post"
              action={
                isEditing
                  ? path.to.salesRfqLine(rfqId, initialValues.id!)
                  : path.to.newSalesRFQLine(rfqId)
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
                      ? `${itemData?.customerPartId}${
                          itemData?.customerPartRevision
                            ? `.${itemData?.customerPartRevision}`
                            : ""
                        }`
                      : "New RFQ Line"}
                  </ModalCardTitle>
                  <ModalCardDescription>
                    {isEditing ? (
                      <div className="flex flex-col items-start gap-1">
                        <span>{itemData?.description}</span>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">
                            {initialValues?.quantity.join(", ")}
                          </Badge>
                        </div>
                      </div>
                    ) : (
                      "An RFQ line contains part and quantity information about the requested item"
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
                          disabled={!isEditable}
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
                <Hidden name="salesRfqId" />
                <Hidden name="order" />
                <Hidden
                  name="modelUploadId"
                  value={itemData.modelUploadId ?? undefined}
                />
                <VStack>
                  <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
                    <div className="col-span-2 grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-2 auto-rows-min">
                      <InputControlled
                        name="customerPartId"
                        label="Customer Part Number"
                        value={itemData.customerPartId}
                        onChange={(newValue) => {
                          setItemData((d) => ({
                            ...d,
                            customerPartId: newValue,
                          }));
                        }}
                        onBlur={(e) => onCustomerPartChange(e.target.value)}
                        autoFocus
                      />
                      <InputControlled
                        name="customerPartRevision"
                        label="Customer Part Revision"
                        value={itemData.customerPartRevision}
                        onChange={(newValue) => {
                          setItemData((d) => ({
                            ...d,
                            customerPartRevision: newValue,
                          }));
                        }}
                        onBlur={(e) =>
                          onCustomerPartRevisionChange(e.target.value)
                        }
                      />
                      <Item
                        name="itemId"
                        label="Part"
                        type="Part"
                        value={itemData.itemId}
                        includeInactive
                        onChange={(value) => {
                          onItemChange(value?.value as string);
                        }}
                      />
                      <InputControlled
                        name="description"
                        label="Short Description"
                        value={itemData.description}
                        isReadOnly={!!itemData.itemId}
                      />
                      <UnitOfMeasure
                        name="unitOfMeasureCode"
                        value={itemData.unitOfMeasureCode}
                        onChange={(newValue) =>
                          setItemData((d) => ({
                            ...d,
                            unitOfMeasureCode: newValue?.value ?? "EA",
                          }))
                        }
                      />

                      <CustomFormFields table="salesRfqLine" />
                    </div>
                    <div className="flex gap-y-4">
                      <ArrayNumeric
                        name="quantity"
                        label="Quantity"
                        defaults={[1, 25, 50, 100]}
                      />
                    </div>
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
        <DeleteSalesRFQLine
          line={initialValues as SalesRFQLine}
          onCancel={deleteDisclosure.onClose}
        />
      )}
    </>
  );
};

export default SalesRFQLineForm;
