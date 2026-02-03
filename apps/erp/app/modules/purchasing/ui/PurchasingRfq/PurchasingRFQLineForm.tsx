import { useCarbon } from "@carbon/auth";
import { ValidatedForm } from "@carbon/form";
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
  VStack
} from "@carbon/react";
import { useState } from "react";
import { BsThreeDotsVertical } from "react-icons/bs";
import { LuTrash } from "react-icons/lu";
import { useParams } from "react-router";
import type { z } from "zod";
import {
  ArrayNumeric,
  ConversionFactor,
  CustomFormFields,
  Hidden,
  InputControlled,
  Item,
  Submit,
  UnitOfMeasure
} from "~/components/Form";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import type { MethodItemType } from "~/modules/shared/types";
import { path } from "~/utils/path";
import { purchasingRfqLineValidator } from "../../purchasing.models";
import type { PurchasingRFQ, PurchasingRFQLine } from "../../types";
import DeletePurchasingRFQLine from "./DeletePurchasingRFQLine";

type PurchasingRFQLineFormProps = {
  initialValues: z.infer<typeof purchasingRfqLineValidator> & {
    itemType: MethodItemType;
  };
  type?: "card" | "modal";
  onClose?: () => void;
};

const PurchasingRFQLineForm = ({
  initialValues,
  type,
  onClose
}: PurchasingRFQLineFormProps) => {
  const permissions = usePermissions();
  const { company } = useUser();
  const { carbon } = useCarbon();

  const { rfqId } = useParams();

  if (!rfqId) throw new Error("rfqId not found");

  const routeData = useRouteData<{
    rfqSummary: PurchasingRFQ;
  }>(path.to.purchasingRfq(rfqId));

  const isEditable = ["Draft"].includes(routeData?.rfqSummary?.status ?? "");

  const isEditing = initialValues.id !== undefined;

  const [itemType, setItemType] = useState<MethodItemType>(
    initialValues.itemType
  );
  const [itemData, setItemData] = useState<{
    itemId: string;
    itemReadableId: string;
    description: string;
    inventoryUom: string;
    purchaseUom: string;
    conversionFactor: number;
  }>({
    itemId: initialValues.itemId ?? "",
    itemReadableId: "",
    description: initialValues.description ?? "",
    inventoryUom: initialValues.inventoryUnitOfMeasureCode ?? "",
    purchaseUom: initialValues.purchaseUnitOfMeasureCode ?? "",
    conversionFactor: initialValues.conversionFactor ?? 1
  });

  const onItemChange = async (itemId: string) => {
    if (!carbon) return;

    const item = await carbon
      .from("item")
      .select("name, readableIdWithRevision, type, unitOfMeasureCode")
      .eq("id", itemId)
      .eq("companyId", company.id)
      .single();

    if (item.error) {
      toast.error("Failed to load item details");
      return;
    }

    const newItemData = {
      ...itemData,
      itemId,
      itemReadableId: item.data?.readableIdWithRevision ?? "",
      description: item.data?.name ?? "",
      inventoryUom: item.data?.unitOfMeasureCode ?? "EA",
      purchaseUom: item.data?.unitOfMeasureCode ?? "EA",
      conversionFactor: 1
    };

    setItemData(newItemData);
    if (item.data?.type) {
      setItemType(item.data.type as MethodItemType);
    }
  };

  const deleteDisclosure = useDisclosure();

  return (
    <>
      <ModalCardProvider type={type}>
        <ModalCard
          onClose={onClose}
          isCollapsible={isEditing}
          defaultCollapsed={false}
        >
          <ModalCardContent>
            <ValidatedForm
              defaultValues={initialValues}
              validator={purchasingRfqLineValidator}
              method="post"
              action={
                isEditing
                  ? path.to.purchasingRfqLine(rfqId, initialValues.id!)
                  : path.to.newPurchasingRFQLine(rfqId)
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
                      ? itemData?.itemReadableId || "RFQ Line"
                      : "New RFQ Line"}
                  </ModalCardTitle>
                  <ModalCardDescription>
                    {isEditing ? (
                      <div className="flex flex-col items-start gap-1">
                        <span>{itemData?.description}</span>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">
                            {initialValues?.quantity?.join(", ")}
                          </Badge>
                        </div>
                      </div>
                    ) : (
                      "An RFQ line contains part and quantity information about the requested item"
                    )}
                  </ModalCardDescription>
                </ModalCardHeader>
                {isEditing && permissions.can("update", "purchasing") && (
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
                <Hidden name="purchasingRfqId" />
                <Hidden name="order" />
                <Hidden
                  name="inventoryUnitOfMeasureCode"
                  value={itemData?.inventoryUom}
                />
                <VStack>
                  <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
                    <div className="col-span-2 grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-2 auto-rows-min">
                      <Item
                        autoFocus
                        name="itemId"
                        label="Part"
                        type={itemType}
                        value={itemData.itemId}
                        includeInactive
                        onChange={(value) => {
                          onItemChange(value?.value as string);
                        }}
                        onTypeChange={(type) => {
                          setItemType(type as MethodItemType);
                          setItemData({
                            ...itemData,
                            itemId: "",
                            description: "",
                            inventoryUom: "",
                            purchaseUom: "",
                            conversionFactor: 1
                          });
                        }}
                      />
                      <InputControlled
                        name="description"
                        label="Description"
                        value={itemData.description}
                        isReadOnly={!!itemData.itemId}
                      />
                      <UnitOfMeasure
                        name="purchaseUnitOfMeasureCode"
                        label="Purchase Unit of Measure"
                        value={itemData.purchaseUom}
                        onChange={(newValue) =>
                          setItemData((d) => ({
                            ...d,
                            purchaseUom: newValue?.value ?? "EA"
                          }))
                        }
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

                      <CustomFormFields table="purchasingRfqLine" />
                    </div>
                    <div className="flex gap-y-4">
                      <ArrayNumeric
                        name="quantity"
                        label="Quantity"
                        defaults={[1, 25, 50, 100]}
                        isDisabled={!isEditable}
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
                      ? !permissions.can("update", "purchasing")
                      : !permissions.can("create", "purchasing"))
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
        <DeletePurchasingRFQLine
          line={initialValues as PurchasingRFQLine}
          onCancel={deleteDisclosure.onClose}
        />
      )}
    </>
  );
};

export default PurchasingRFQLineForm;
