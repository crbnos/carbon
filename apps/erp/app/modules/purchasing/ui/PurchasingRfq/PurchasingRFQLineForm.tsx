// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
  MENU_ITEM_SHORTCUTS,
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
import { distinctItemText } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { BsThreeDotsVertical } from "react-icons/bs";
import { LuTrash } from "react-icons/lu";
import { Link, useParams } from "react-router";
import type { z } from "zod";
import { MethodItemTypeIcon } from "~/components";
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
import { EACH_UNIT_OF_MEASURE_CODE } from "~/modules/items";
import { getLinkToItemDetails } from "~/modules/items/ui/Item/ItemForm";
import { itemType as itemTypes } from "~/modules/shared";
import type { ItemType } from "~/modules/shared/types";
import { path } from "~/utils/path";
import {
  isRfqLocked,
  purchasingRfqLineValidator
} from "../../purchasing.models";
import type { PurchasingRFQ, PurchasingRFQLine } from "../../types";
import DeletePurchasingRFQLine from "./DeletePurchasingRFQLine";

type PurchasingRFQLineFormProps = {
  initialValues: z.infer<typeof purchasingRfqLineValidator> & {
    itemType: ItemType;
  };
  type?: "card" | "modal";
  onClose?: () => void;
};

const PurchasingRFQLineForm = ({
  initialValues,
  type,
  onClose
}: PurchasingRFQLineFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { company } = useUser();
  const { carbon } = useCarbon();

  const { rfqId } = useParams();

  if (!rfqId) throw new Error("rfqId not found");

  const routeData = useRouteData<{
    rfqSummary: PurchasingRFQ;
  }>(path.to.purchasingRfq(rfqId));

  const isLocked = isRfqLocked(routeData?.rfqSummary?.status);

  const isEditing = initialValues.id !== undefined;

  const [itemType, setItemType] = useState<ItemType>(initialValues.itemType);
  const isService = itemType === "Service";
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
      toast.error(t`Failed to load item details`);
      return;
    }

    // A service is always bought and "stocked" in EA, 1:1.
    const isServiceItem = item.data?.type === "Service";
    const newItemData = {
      ...itemData,
      itemId,
      itemReadableId: item.data?.readableIdWithRevision ?? "",
      description: item.data?.name ?? "",
      inventoryUom: isServiceItem
        ? EACH_UNIT_OF_MEASURE_CODE
        : (item.data?.unitOfMeasureCode ?? "EA"),
      purchaseUom: isServiceItem
        ? EACH_UNIT_OF_MEASURE_CODE
        : (item.data?.unitOfMeasureCode ?? "EA"),
      conversionFactor: 1
    };

    setItemData(newItemData);
    if (item.data?.type) {
      setItemType(item.data.type as ItemType);
    }
  };

  const deleteDisclosure = useDisclosure();
  const canDelete = !isLocked && permissions.can("update", "purchasing");
  const canViewItem = !!itemData.itemId && itemTypes.includes(itemType);

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
              isDisabled={isEditing && isLocked}
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
                        {distinctItemText(
                          itemData?.itemReadableId || "RFQ Line",
                          itemData?.description
                        ) && <span>{itemData?.description}</span>}
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
                {isEditing && (canDelete || canViewItem) && (
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
                        {canDelete && (
                          <DropdownMenuItem
                            shortcut={MENU_ITEM_SHORTCUTS.delete}
                            destructive
                            onClick={deleteDisclosure.onOpen}
                          >
                            <DropdownMenuIcon icon={<LuTrash />} />
                            <Trans>Delete Line</Trans>
                          </DropdownMenuItem>
                        )}
                        {canViewItem && (
                          <DropdownMenuItem
                            shortcut={MENU_ITEM_SHORTCUTS.view}
                            asChild
                          >
                            <Link
                              to={getLinkToItemDetails(
                                itemType,
                                itemData.itemId
                              )}
                            >
                              <DropdownMenuIcon
                                icon={<MethodItemTypeIcon type={itemType} />}
                              />
                              <Trans>View Item Master</Trans>
                            </Link>
                          </DropdownMenuItem>
                        )}
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
                  value={
                    isService
                      ? EACH_UNIT_OF_MEASURE_CODE
                      : itemData?.inventoryUom || itemData?.purchaseUom || "EA"
                  }
                />
                {/* A service is always bought in EA, so no unit of measure
                    or conversion factor is asked for. */}
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
                    <div className="col-span-2 max-md:col-span-full grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-2 auto-rows-min">
                      <Item
                        autoFocus
                        name="itemId"
                        label={t`Part`}
                        type={itemType}
                        value={itemData.itemId}
                        includeInactive
                        locationId={
                          routeData?.rfqSummary?.locationId ?? undefined
                        }
                        onChange={(value) => {
                          onItemChange(value?.value as string);
                        }}
                        onTypeChange={(type) => {
                          setItemType(type as ItemType);
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
                        label={t`Description`}
                        value={itemData.description}
                        isReadOnly={!!itemData.itemId}
                      />
                      {!isService && (
                        <>
                          <UnitOfMeasure
                            name="purchaseUnitOfMeasureCode"
                            label={t`Purchase Unit of Measure`}
                            termId="item-purchasing-uom"
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
                            termId="conversion-factor"
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

                      <CustomFormFields table="purchasingRfqLine" />
                    </div>
                    <div className="flex gap-y-4">
                      <ArrayNumeric
                        name="quantity"
                        label={t`Quantity`}
                        termId="quantity-breaks"
                        defaults={[1, 25, 50, 100]}
                        isDisabled={isLocked}
                      />
                    </div>
                  </div>
                </VStack>
              </ModalCardBody>
              <ModalCardFooter>
                <Submit
                  isDisabled={
                    isLocked ||
                    (isEditing
                      ? !permissions.can("update", "purchasing")
                      : !permissions.can("create", "purchasing"))
                  }
                >
                  <Trans>Save</Trans>
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
