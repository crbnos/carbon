// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

"use client";
import { useCarbon } from "@carbon/auth";
import type { Database } from "@carbon/database";
import { ValidatedForm } from "@carbon/form";
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Label,
  toast,
  useDebounce,
  useDisclosure
} from "@carbon/react";
import {
  distinctItemText,
  getItemReadableId,
  INPUT_FORMAT
} from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { motion } from "motion/react";
import { nanoid } from "nanoid";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  LuArrowLeft,
  LuChevronDown,
  LuChevronRight,
  LuGitPullRequest,
  LuGitPullRequestCreate,
  LuGitPullRequestCreateArrow,
  LuRedoDot
} from "react-icons/lu";
import { useFetcher, useFetchers, useParams } from "react-router";
import type { z } from "zod";
import { MethodIcon } from "~/components";
import {
  DefaultMethodType,
  Hidden,
  InputControlled,
  Item,
  NumberControlled,
  Select,
  StorageUnit,
  Submit,
  UnitOfMeasure
} from "~/components/Form";
import { useStorageUnits } from "~/components/Form/StorageUnit";
import type {
  Item as SortableItem,
  SortableItemRenderProps
} from "~/components/SortableList";
import {
  SortableList,
  SortableListItem,
  SortableListItemPanel,
  SortableListItemToggle
} from "~/components/SortableList";
import {
  useCurrencyDecimals,
  usePermissions,
  useRouteData,
  useUrlParams,
  useUser
} from "~/hooks";
import { lookupBuyPrice as lookupBuyPriceAsync } from "~/modules/items";
import {
  MaterialRowDetails,
  MaterialRowTitle
} from "~/modules/items/ui/Item/MethodRow";
import type { MethodItemType, MethodType } from "~/modules/shared";
import type { Item as ItemType } from "~/stores";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import type { quoteOperationValidator } from "../../sales.models";
import { quoteMaterialValidator } from "../../sales.models";
import type { Quotation } from "../../types";

type Material = z.infer<typeof quoteMaterialValidator> & {
  item: {
    name: string;
    itemTrackingType: Database["public"]["Enums"]["itemTrackingType"];
    replenishmentSystem: string | null;
  };
};

type Operation = z.infer<typeof quoteOperationValidator>;

type ItemWithData = SortableItem & {
  data: Material;
};

type QuoteBillOfMaterialProps = {
  quoteMakeMethodId: string;
  materials: Material[];
  operations: Operation[];
};

type OrderState = {
  [key: string]: number;
};

type CheckedState = {
  [key: string]: boolean;
};

type TemporaryItems = {
  [key: string]: Material;
};

function makeItems(
  items: ItemType[],
  materials: Material[],
  orderState: OrderState,
  checkedState: CheckedState
): ItemWithData[] {
  return materials.map((material) => {
    const order = material.id
      ? (orderState[material.id] ?? material.order)
      : material.order;
    const checked = material.id ? (checkedState[material.id] ?? false) : false;
    return makeItem(items, material, order, checked);
  });
}

function makeItem(
  items: ItemType[],
  material: Material,
  order: number,
  checked: boolean
): ItemWithData {
  const itemReadableId = getItemReadableId(items, material.itemId);
  return {
    id: material.id!,
    title: (
      <MaterialRowTitle
        readableId={itemReadableId}
        description={
          distinctItemText(itemReadableId, material?.description)
            ? material.description
            : null
        }
        itemId={material.itemId}
        itemType={material.itemType}
      />
    ),
    checked: checked,
    details: (
      <MaterialRowDetails
        trackingType={material.item?.itemTrackingType}
        methodType={material.methodType}
        isKit={material.kit}
        quantity={material.quantity}
        itemType={material.itemType}
      />
    ),
    data: {
      ...material,
      order
    }
  };
}

const initialMethodMaterial: Omit<Material, "quoteMakeMethodId" | "order"> & {
  description: string;
} = {
  itemId: "",
  itemReadableId: "",
  // @ts-expect-error
  itemType: "Item" as const,
  methodType: "Purchase to Order" as const,
  description: "",
  quantity: 1,
  unitCost: 0,
  unitOfMeasureCode: "EA"
};

const usePendingMaterials = () => {
  const { quoteId, lineId } = useParams();
  if (!quoteId) throw new Error("quoteId not found");
  if (!lineId) throw new Error("lineId not found");

  type PendingItem = ReturnType<typeof useFetchers>[number] & {
    formData: FormData;
  };

  return useFetchers()
    .filter((fetcher): fetcher is PendingItem => {
      return (
        (fetcher.formAction === path.to.newQuoteMaterial(quoteId, lineId) ||
          fetcher.formAction?.includes(
            `/quote/methods/${quoteId}/${lineId}/material`
          )) ??
        false
      );
    })
    .reduce<z.infer<typeof quoteMaterialValidator>[]>((acc, fetcher) => {
      const formData = fetcher.formData;
      const material = quoteMaterialValidator.safeParse(
        Object.fromEntries(formData)
      );

      if (material.success) {
        return [...acc, material.data];
      }
      return acc;
    }, []);
};

const QuoteBillOfMaterial = ({
  quoteMakeMethodId,
  materials: initialMaterials,
  operations
}: QuoteBillOfMaterialProps) => {
  const { quoteId, lineId } = useParams();
  if (!quoteId) throw new Error("quoteId not found");
  if (!lineId) throw new Error("lineId not found");

  const fetcher = useFetcher<{}>();
  const permissions = usePermissions();

  const addItemButtonRef = useRef<HTMLButtonElement>(null);

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [temporaryItems, setTemporaryItems] = useState<TemporaryItems>({});
  const [checkedState, setCheckedState] = useState<CheckedState>({});
  // Only the rows this session has reordered. Every other row takes its order
  // from the loaded data: a copy of all of them taken at mount hid a reorder
  // made anywhere else until the page was reloaded.
  const [orderState, setOrderState] = useState<OrderState>({});

  const materialsById = new Map<string, Material>();

  // Add initial materials to map
  initialMaterials.forEach((material) => {
    if (!material.id) return;
    materialsById.set(material.id, material);
  });

  const pendingMaterials = usePendingMaterials();

  // Replace existing materials with pending ones
  pendingMaterials.forEach((pendingMaterial) => {
    if (!pendingMaterial.id) {
      materialsById.set("temporary", {
        ...pendingMaterial,
        description: "",
        item: {
          name: "",
          itemTrackingType: "Inventory",
          replenishmentSystem: null
        }
      });
    } else {
      materialsById.set(pendingMaterial.id, {
        ...materialsById.get(pendingMaterial.id)!,
        ...pendingMaterial
      });
    }
  });

  // Add temporary items
  Object.entries(temporaryItems).forEach(([id, material]) => {
    materialsById.set(id, material);
  });

  const [storedItems] = useItems();

  const items = makeItems(
    storedItems,
    Array.from(materialsById.values()),
    orderState,
    checkedState
  ).sort((a, b) => a.data.order - b.data.order);

  const quoteData = useRouteData<{ quote: Quotation }>(path.to.quote(quoteId));
  const isDisabled = quoteData?.quote?.status !== "Draft";
  const isReadOnly = isDisabled || !permissions.can("update", "sales");

  const onToggleItem = (id: string) => {
    if (!permissions.can("update", "sales") || isDisabled) return;
    setCheckedState((prev) => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const onAddItem = () => {
    if (!permissions.can("update", "sales") || isDisabled) return;
    const materialId = nanoid();
    setSelectedItemId(materialId);
    setSearchParams({ materialId: materialId });

    let newOrder = 1;
    if (items.length) {
      newOrder = Math.max(...items.map((item) => item.data.order)) + 1;
    }

    const newMaterial: Material = {
      ...initialMethodMaterial,
      id: materialId,
      order: newOrder,
      quoteMakeMethodId
    };

    setTemporaryItems((prev) => ({
      ...prev,
      [materialId]: newMaterial
    }));

    setOrderState((prev) => ({
      ...prev,
      [materialId]: newOrder
    }));
  };

  const onRemoveItem = async (id: string) => {
    if (!permissions.can("update", "sales") || isDisabled) return;

    // Check if this is a temporary item (exists in temporaryItems state)
    if (temporaryItems[id]) {
      setTemporaryItems((prev) => {
        const { [id]: _, ...rest } = prev;
        return rest;
      });
    } else {
      fetcher.submit(new FormData(), {
        method: "post",
        action: path.to.deleteQuoteMaterial(quoteId, lineId, id)
      });
    }

    setSelectedItemId(null);
    setOrderState((prev) => {
      const { [id]: _, ...rest } = prev;
      return rest;
    });
  };

  const updateSortOrder = useDebounce(
    (updates: Record<string, number>) => {
      let formData = new FormData();
      formData.append("updates", JSON.stringify(updates));
      fetcher.submit(formData, {
        method: "post",
        action: path.to.quoteMaterialsOrder
      });
    },
    1000,
    true
  );

  const onReorder = (items: ItemWithData[]) => {
    if (!permissions.can("update", "sales") || isDisabled) return;

    // Create new order state
    const newOrderState = items.reduce<OrderState>((acc, item, index) => {
      acc[item.id] = index + 1;
      return acc;
    }, {});

    // Update order state immediately
    setOrderState(newOrderState);

    // Only send non-temporary items to the server
    const updates = Object.entries(newOrderState).reduce<
      Record<string, number>
    >((acc, [id, order]) => {
      if (!temporaryItems[id]) {
        acc[id] = order;
      }
      return acc;
    }, {});

    if (Object.keys(updates).length > 0) {
      updateSortOrder(updates);
    }
  };

  const onCloseOnDrag = useCallback(() => {
    setCheckedState((prev) => {
      const newState = { ...prev };
      let changed = false;

      items.forEach((item) => {
        if (item.checked) {
          newState[item.id] = false;
          changed = true;
        }
      });

      return changed ? newState : prev;
    });
  }, [items]);

  const [searchParams, setSearchParams] = useUrlParams();
  const selectedMaterialId = searchParams.get("materialId");
  const onSelectItem = (id: string | null) => {
    setSearchParams({ materialId: id });
    setSelectedItemId(id);
  };

  const renderListItem = ({
    item,
    items,
    order,
    onToggleItem,
    onRemoveItem
  }: SortableItemRenderProps<ItemWithData>) => {
    const isOpen = item.id === selectedItemId;

    return (
      <SortableListItem<Material>
        isReadOnly={isReadOnly}
        item={item}
        items={items}
        order={order}
        key={item.id}
        isExpanded={isOpen}
        isHighlighted={item.id === selectedMaterialId}
        onSelectItem={onSelectItem}
        onToggleItem={onToggleItem}
        onRemoveItem={onRemoveItem}
        handleDrag={onCloseOnDrag}
        renderExtra={(item) => (
          <div>
            <SortableListItemToggle
              isOpen={isOpen}
              onToggle={() => onSelectItem(isOpen ? null : item.id)}
            />
            <SortableListItemPanel isOpen={isOpen}>
              <MaterialForm
                item={item}
                isDisabled={isDisabled}
                setSelectedItemId={setSelectedItemId}
                quoteOperations={operations}
                temporaryItems={temporaryItems}
                setTemporaryItems={setTemporaryItems}
                orderState={orderState}
                setOrderState={setOrderState}
                onSubmit={() => {
                  setSelectedItemId(null);
                  addItemButtonRef.current?.scrollIntoView({
                    behavior: "smooth",
                    block: "nearest",
                    inline: "center"
                  });
                }}
              />
            </SortableListItemPanel>
          </div>
        )}
      />
    );
  };

  return (
    <Card>
      <HStack className="justify-between">
        <CardHeader>
          <CardTitle>
            <Trans>Bill of Material</Trans>
          </CardTitle>
        </CardHeader>

        <CardAction>
          <Button
            ref={addItemButtonRef}
            variant="secondary"
            isDisabled={isDisabled || !permissions.can("update", "sales")}
            onClick={onAddItem}
          >
            <Trans>Add Item</Trans>
          </Button>
        </CardAction>
      </HStack>
      <CardContent>
        <SortableList
          isReadOnly={isReadOnly}
          items={items}
          onReorder={onReorder}
          onToggleItem={onToggleItem}
          onRemoveItem={onRemoveItem}
          renderItem={renderListItem}
        />
      </CardContent>
    </Card>
  );
};

export default QuoteBillOfMaterial;

function MaterialForm({
  item,
  isDisabled,
  setSelectedItemId,
  quoteOperations,
  temporaryItems,
  setTemporaryItems,
  orderState,
  setOrderState,
  onSubmit
}: {
  item: ItemWithData;
  isDisabled: boolean;

  setSelectedItemId: Dispatch<SetStateAction<string | null>>;
  quoteOperations: Operation[];
  temporaryItems: TemporaryItems;
  setTemporaryItems: Dispatch<SetStateAction<TemporaryItems>>;
  orderState: OrderState;
  setOrderState: Dispatch<SetStateAction<OrderState>>;
  onSubmit: () => void;
}) {
  const { t } = useLingui();
  const { quoteId, lineId } = useParams();

  if (!quoteId) throw new Error("quoteId not found");
  if (!lineId) throw new Error("lineId not found");

  const { carbon } = useCarbon();
  const methodMaterialFetcher = useFetcher<{
    id: string;
    success: boolean;
    message: string;
  }>();
  const params = useParams();
  const { company } = useUser();
  const routeData = useRouteData<{ quote: Quotation }>(path.to.quote(quoteId));

  const baseCurrency = company?.baseCurrencyCode ?? "USD";
  const currencyDecimals = useCurrencyDecimals(baseCurrency);

  useEffect(() => {
    // Remove from temporary items after successful submission
    if (methodMaterialFetcher.data && methodMaterialFetcher.data.id) {
      // Clear temporary item after successful save
      setTemporaryItems((prev) => {
        const { [item.id]: _, ...rest } = prev;
        return rest;
      });

      if (methodMaterialFetcher.data.success) {
        toast.success(methodMaterialFetcher.data.message);
      }
      onSubmit();
    }
  }, [item.id, methodMaterialFetcher.data, setTemporaryItems, onSubmit]);

  const [itemType, setItemType] = useState<MethodItemType>(item.data.itemType);
  const [itemData, setItemData] = useState<{
    itemId: string;
    methodType: MethodType;
    description: string;
    unitCost: number;
    unitCostSource: "system" | "manual";
    unitOfMeasureCode: string;
    quantity: number;
    kit: boolean;
    storageUnitId?: string;
    quoteOperationId?: string;
    requiresBatchTracking: boolean;
    requiresSerialTracking: boolean;
    itemReplenishmentSystem: string;
  }>({
    itemId: item.data.itemId ?? "",
    methodType: item.data.methodType ?? "Pull from Inventory",
    description: item.data.description ?? "",
    unitCost: item.data.unitCost ?? 0,
    unitCostSource: item.data.unitCostSource === "manual" ? "manual" : "system",
    unitOfMeasureCode: item.data.unitOfMeasureCode ?? "EA",
    quantity: item.data.quantity ?? 1,
    kit: item.data.kit ?? false,
    storageUnitId: item.data.storageUnitId,
    quoteOperationId: item.data.quoteOperationId,
    requiresBatchTracking: item.data.item?.itemTrackingType === "Batch",
    requiresSerialTracking: item.data.item?.itemTrackingType === "Serial",
    itemReplenishmentSystem: item.data.item?.replenishmentSystem ?? "Buy"
  });

  const onTypeChange = (value: MethodItemType | "Item") => {
    if (value === itemType) return;
    setItemType(value as MethodItemType);
    setItemData({
      itemId: "",
      methodType: "Pull from Inventory",
      quantity: 1,
      unitCost: 0,
      unitCostSource: "system",
      description: "",
      unitOfMeasureCode: "EA",
      kit: false,
      requiresBatchTracking: false,
      requiresSerialTracking: false,
      itemReplenishmentSystem: "Buy"
    });
  };

  const lookupBuyPriceFn = useCallback(
    async (itemId: string, qty: number, fallbackCost: number) => {
      if (!carbon) return fallbackCost;
      return lookupBuyPriceAsync(carbon, itemId, qty, fallbackCost);
    },
    [carbon]
  );

  const onItemChange = async (itemId: string) => {
    if (!carbon) return;
    if (itemId === params.itemId) {
      toast.error(t`An item cannot be added to itself.`);
      return;
    }

    const [item, itemCost] = await Promise.all([
      carbon
        .from("item")
        .select(
          "name, readableIdWithRevision, type, unitOfMeasureCode, defaultMethodType, itemTrackingType, replenishmentSystem"
        )
        .eq("id", itemId)
        .eq("companyId", company.id)
        .single(),
      carbon.from("itemCost").select("unitCost").eq("itemId", itemId).single()
    ]);

    if (item.error) {
      toast.error(t`Failed to load item details`);
      return;
    }

    let unitCost = itemCost.data?.unitCost ?? 0;
    const isBuyPart = item.data?.defaultMethodType === "Purchase to Order";

    if (isBuyPart) {
      unitCost = await lookupBuyPriceFn(
        itemId,
        itemData.quantity ?? 1,
        unitCost
      );
    }

    setItemData((d) => ({
      ...d,
      itemId,
      description: item.data?.name ?? "",
      unitCost,
      unitCostSource: "system",
      unitOfMeasureCode: item.data?.unitOfMeasureCode ?? "EA",
      methodType: item.data?.defaultMethodType ?? "Pull from Inventory",
      requiresBatchTracking: item.data?.itemTrackingType === "Batch",
      requiresSerialTracking: item.data?.itemTrackingType === "Serial",
      itemReplenishmentSystem: item.data?.replenishmentSystem ?? "Buy"
    }));

    if (item.data?.type) {
      setItemType(item.data.type as MethodItemType);
    }
  };

  const onQuantityChange = useCallback(
    async (newQty: number) => {
      setItemData((d) => ({ ...d, quantity: newQty }));

      if (itemData.methodType !== "Purchase to Order" || !itemData.itemId)
        return;
      // A typed cost survives a quantity change.
      if (itemData.unitCostSource === "manual") return;
      if (!carbon) return;

      const itemCost = await carbon
        .from("itemCost")
        .select("unitCost")
        .eq("itemId", itemData.itemId)
        .single();

      const fallbackCost = itemCost.data?.unitCost ?? 0;
      const unitCost = await lookupBuyPriceFn(
        itemData.itemId,
        newQty,
        fallbackCost
      );

      // Re-checked here because the guard above reads a captured value, and a
      // cost can be typed while the awaits are in flight.
      setItemData((d) =>
        d.unitCostSource === "manual" ? d : { ...d, unitCost }
      );
    },
    [
      carbon,
      itemData.methodType,
      itemData.itemId,
      itemData.unitCostSource,
      lookupBuyPriceFn
    ]
  );

  const sourceDisclosure = useDisclosure();
  const backflushDisclosure = useDisclosure();
  const locationId = routeData?.quote?.locationId ?? undefined;
  const storageUnits = useStorageUnits(locationId);

  const isTracked =
    itemData.requiresBatchTracking || itemData.requiresSerialTracking;

  return (
    <ValidatedForm
      action={
        temporaryItems[item.id]
          ? path.to.newQuoteMaterial(quoteId, lineId)
          : path.to.quoteMaterial(quoteId, lineId, item.id!)
      }
      method="post"
      defaultValues={item.data}
      validator={quoteMaterialValidator}
      className="w-full flex flex-col gap-y-4"
      fetcher={methodMaterialFetcher}
    >
      <div>
        <Hidden name="id" />
        <Hidden name="quoteMakeMethodId" />
        <Hidden name="kit" value={itemData.kit.toString()} />
        <Hidden name="order" />
        <Hidden name="unitCostSource" value={itemData.unitCostSource} />

        {itemData.methodType === "Make to Order" && (
          <Hidden name="unitCost" value={itemData.unitCost} />
        )}
      </div>
      <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
        <Item
          blacklist={[params.itemId!]}
          isReadOnly={isDisabled}
          name="itemId"
          label={itemType}
          includeInactive
          locationId={locationId}
          validItemTypes={["Consumable", "Material", "Part"]}
          type={itemType}
          onChange={(value) => {
            onItemChange(value?.value as string);
          }}
          onTypeChange={onTypeChange}
        />

        <NumberControlled
          name="quantity"
          label={t`Quantity`}
          value={itemData.quantity}
          onChange={onQuantityChange}
        />
        <UnitOfMeasure
          name="unitOfMeasureCode"
          value={itemData.unitOfMeasureCode}
          onChange={(newValue) =>
            setItemData((d) => ({
              ...d,
              unitOfMeasureCode: newValue?.value ?? "EA"
            }))
          }
        />
        <InputControlled
          name="description"
          label={t`Description`}
          value={itemData.description}
          onChange={(newValue) => {
            setItemData((d) => ({ ...d, description: newValue }));
          }}
          className="col-span-2 max-md:col-span-full"
        />
        {itemData.methodType !== "Make to Order" && (
          <NumberControlled
            name="unitCost"
            label={t`Unit Cost`}
            value={itemData.unitCost}
            minValue={0}
            formatOptions={INPUT_FORMAT.rate(baseCurrency, currencyDecimals)}
            onChange={(newValue) =>
              setItemData((d) => ({
                ...d,
                unitCost: newValue,
                unitCostSource: "manual"
              }))
            }
          />
        )}
      </div>
      <div className="border border-border rounded-md shadow-sm p-4 flex flex-col gap-4 w-full">
        <HStack
          className="w-full justify-between cursor-pointer max-md:flex-wrap max-md:gap-y-2"
          onClick={sourceDisclosure.onToggle}
        >
          <HStack>
            {itemData.methodType === "Make to Order" ? (
              <>
                <LuGitPullRequestCreate />
                <Label>
                  <Trans>Finish To</Trans>
                </Label>
              </>
            ) : (
              <>
                <LuGitPullRequest />
                <Label>
                  <Trans>Pull From</Trans>
                </Label>
              </>
            )}
          </HStack>
          <HStack className="max-md:flex-wrap max-md:gap-y-1">
            <Badge variant="secondary">
              <MethodIcon type={itemData.methodType} className="size-3 mr-1" />
              {itemData.methodType === "Purchase to Order"
                ? t`Purchase to Order`
                : itemData.methodType === "Pull from Inventory"
                  ? t`Pull from Inventory`
                  : t`Make to Order`}
            </Badge>
            <LuArrowLeft
              className={cn(
                itemData.methodType !== "Pull from Inventory"
                  ? "rotate-180"
                  : ""
              )}
            />
            <Badge variant="secondary">
              <LuGitPullRequest className="size-3 mr-1" />
              {storageUnits.options?.find(
                (s) => s.value === itemData.storageUnitId
              )?.label ??
                (itemData.methodType === "Make to Order"
                  ? "WIP"
                  : "Default Storage Unit")}
            </Badge>
            <IconButton
              icon={<LuChevronRight />}
              aria-label={
                sourceDisclosure.isOpen ? "Collapse Source" : "Expand Source"
              }
              variant="ghost"
              size="md"
              onClick={(e) => {
                e.stopPropagation();
                sourceDisclosure.onToggle();
              }}
              className={`transition-transform ${
                sourceDisclosure.isOpen ? "rotate-90" : ""
              }`}
            />
          </HStack>
        </HStack>
        <div
          className={`grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3 pb-4 ${
            sourceDisclosure.isOpen ? "" : "hidden"
          }`}
        >
          <DefaultMethodType
            name="methodType"
            label={t`Method Type`}
            value={itemData.methodType}
            onChange={(value) => {
              setItemData((d) => ({
                ...d,
                methodType: value?.value as MethodType
              }));
            }}
            replenishmentSystem={itemData.itemReplenishmentSystem}
            termId="method-type"
          />
          <StorageUnit
            name="storageUnitId"
            label={t`Storage Unit`}
            locationId={locationId}
            itemId={itemData.itemId}
          />
        </div>
      </div>
      <div className="border border-border rounded-md shadow-sm p-4 flex flex-col gap-4 w-full">
        <HStack
          className="w-full justify-between cursor-pointer"
          onClick={backflushDisclosure.onToggle}
        >
          <HStack>
            <LuGitPullRequestCreateArrow />
            <Label>
              {isTracked ? <Trans>Operation</Trans> : <Trans>Backflush</Trans>}
            </Label>
          </HStack>
          <HStack>
            <Badge
              variant={quoteOperations.length > 0 ? "secondary" : "destructive"}
            >
              <LuRedoDot className="size-3 mr-1" />
              {itemData.quoteOperationId
                ? quoteOperations.find(
                    (o) => o.id === itemData.quoteOperationId
                  )?.description || "Selected Operation"
                : "First Operation"}
            </Badge>
            <IconButton
              icon={<LuChevronRight />}
              aria-label={
                backflushDisclosure.isOpen
                  ? "Collapse Operation"
                  : "Expand Operation"
              }
              variant="ghost"
              size="md"
              onClick={(e) => {
                e.stopPropagation();
                backflushDisclosure.onToggle();
              }}
              className={`transition-transform ${
                backflushDisclosure.isOpen ? "rotate-90" : ""
              }`}
            />
          </HStack>
        </HStack>
        <div
          className={`grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3 pb-4 ${
            backflushDisclosure.isOpen ? "" : "hidden"
          }`}
        >
          <Select
            name="quoteOperationId"
            label={t`Operation`}
            isClearable
            options={quoteOperations.map((o) => ({
              value: o.id!,
              label: o.description
            }))}
            onChange={(newValue) => {
              setItemData((d) => ({
                ...d,
                quoteOperationId: newValue?.value as string
              }));
            }}
            termId="operation"
          />
        </div>
      </div>
      <motion.div
        className="flex flex-1 items-center justify-end w-full pt-2"
        initial={{ opacity: 0, filter: "blur(4px)" }}
        animate={{ opacity: 1, filter: "blur(0px)" }}
        transition={{
          type: "spring",
          bounce: 0,
          duration: 0.25
        }}
      >
        <motion.div
          layout
          className="flex items-center justify-between gap-2 w-full"
        >
          {itemData.methodType === "Make to Order" ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  leftIcon={
                    <MethodIcon type={"Make to Order"} isKit={itemData.kit} />
                  }
                  variant="secondary"
                  size="sm"
                  rightIcon={<LuChevronDown />}
                >
                  {itemData.kit ? t`Kit` : t`Subassembly`}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuRadioGroup
                  value={itemData.kit ? "Kit" : "Subassembly"}
                  onValueChange={(value) => {
                    setItemData((d) => ({
                      ...d,
                      kit: value === "Kit"
                    }));
                  }}
                >
                  <DropdownMenuRadioItem value="Subassembly">
                    <Trans>Subassembly</Trans>
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="Kit">
                    <Trans>Kit</Trans>
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div />
          )}

          <Submit
            isDisabled={isDisabled || methodMaterialFetcher.state !== "idle"}
            isLoading={methodMaterialFetcher.state === "submitting"}
          >
            <Trans>Save</Trans>
          </Submit>
        </motion.div>
      </motion.div>
    </ValidatedForm>
  );
}
