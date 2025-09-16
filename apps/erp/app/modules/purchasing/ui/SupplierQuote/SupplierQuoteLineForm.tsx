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
  ConversionFactor,
  CustomFormFields,
  Hidden,
  InputControlled,
  Item,
  Submit,
  UnitOfMeasure,
} from "~/components/Form";
import { usePermissions, useRouteData, useUser } from "~/hooks";

import type { MethodItemType } from "~/modules/shared/types";
import { path } from "~/utils/path";
import { supplierQuoteLineValidator } from "../../purchasing.models";
import type { SupplierQuote } from "../../types";
import DeleteSupplierQuoteLine from "./DeleteSupplierQuoteLine";

type SupplierQuoteLineFormProps = {
  initialValues: z.infer<typeof supplierQuoteLineValidator> & {
    itemType: MethodItemType;
  };
  type?: "card" | "modal";
  onClose?: () => void;
};

const SupplierQuoteLineForm = ({
  initialValues,
  type,
  onClose,
}: SupplierQuoteLineFormProps) => {
  const permissions = usePermissions();
  const { company } = useUser();
  const { carbon } = useCarbon();

  const { id } = useParams();

  if (!id) throw new Error("id not found");

  const routeData = useRouteData<{
    quote: SupplierQuote;
  }>(path.to.supplierQuote(id));

  const isEditable = ["Active"].includes(routeData?.quote?.status ?? "");

  const isEditing = initialValues.id !== undefined;

  const [itemType, setItemType] = useState(initialValues.itemType);
  const [itemData, setItemData] = useState<{
    supplierPartId: string;
    description: string;
    itemId: string;
    inventoryUom: string;
    purchaseUom: string;
    conversionFactor: number;
  }>({
    supplierPartId: initialValues.supplierPartId ?? "",
    itemId: initialValues.itemId ?? "",
    description: initialValues.description ?? "",
    inventoryUom: initialValues.inventoryUnitOfMeasureCode ?? "",
    purchaseUom: initialValues.purchaseUnitOfMeasureCode ?? "",
    conversionFactor: initialValues.conversionFactor ?? 1,
  });

  const onSupplierPartChange = async (supplierPartId: string) => {
    if (!carbon || !routeData?.quote?.supplierId) return;

    const supplierPart = await carbon
      .from("supplierPart")
      .select("supplierPartId, itemId")
      .eq("supplierPartId", supplierPartId)
      .eq("supplierId", routeData?.quote?.supplierId!)
      .maybeSingle();

    if (supplierPart.error) {
      toast.error("Failed to load supplier part details");
      return;
    }

    if (supplierPart.data && supplierPart.data.itemId && !itemData.itemId) {
      onItemChange(supplierPart.data.itemId);
    }
  };

  const onItemChange = async (itemId: string) => {
    if (!carbon) return;

    const [item, supplierPart] = await Promise.all([
      carbon
        .from("item")
        .select("name, readableIdWithRevision, type, unitOfMeasureCode")
        .eq("id", itemId)
        .eq("companyId", company.id)
        .single(),
      carbon
        .from("supplierPart")
        .select("supplierPartId, supplierUnitOfMeasureCode, conversionFactor")
        .eq("itemId", itemId)
        .eq("supplierId", routeData?.quote?.supplierId!)
        .maybeSingle(),
    ]);

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
      purchaseUom:
        supplierPart.data?.supplierUnitOfMeasureCode ??
        item.data?.unitOfMeasureCode ??
        "EA",
      conversionFactor: supplierPart.data?.conversionFactor ?? 1,
    };

    if (supplierPart.data && !itemData.supplierPartId) {
      newItemData.supplierPartId = supplierPart.data.supplierPartId ?? "";
    }

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
          defaultCollapsed={isEditing}
          isCollapsible={isEditing}
        >
          <ModalCardContent size="xxlarge">
            <ValidatedForm
              defaultValues={initialValues}
              validator={supplierQuoteLineValidator}
              method="post"
              action={
                isEditing
                  ? path.to.supplierQuoteLine(id, initialValues.id!)
                  : path.to.newSupplierQuoteLine(id)
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
                      ? "Supplier Quote Line"
                      : "New Supplier Quote Line"}
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
                      "A quote line contains pricing and lead times for a particular part"
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
                <Hidden name="supplierQuoteId" />
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
                            conversionFactor: 1,
                            supplierPartId: "",
                          });
                        }}
                      />

                      <InputControlled
                        name="description"
                        label="Short Description"
                        value={itemData.description}
                      />

                      <InputControlled
                        name="supplierPartId"
                        label="Supplier Part Number"
                        value={itemData.supplierPartId}
                        onChange={(newValue) => {
                          setItemData((d) => ({
                            ...d,
                            supplierPartId: newValue,
                          }));
                        }}
                        onBlur={(e) => onSupplierPartChange(e.target.value)}
                      />
                      <UnitOfMeasure
                        name="purchaseUnitOfMeasureCode"
                        label="Purchase Unit of Measure"
                        value={itemData.purchaseUom}
                        onChange={(newValue) => {
                          if (newValue) {
                            setItemData((d) => ({
                              ...d,
                              purchaseUom: newValue?.value as string,
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
                            conversionFactor: value,
                          }));
                        }}
                      />

                      <CustomFormFields table="supplierQuoteLine" />
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
      {isEditing && deleteDisclosure.isOpen && initialValues.id && (
        <DeleteSupplierQuoteLine
          line={{
            itemId: itemData.itemId ?? "",
            id: initialValues.id,
          }}
          onCancel={deleteDisclosure.onClose}
        />
      )}
    </>
  );
};

export default SupplierQuoteLineForm;
