// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

"use client";
import { useCarbon } from "@carbon/auth";
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
  useDisclosure,
  useViewport
} from "@carbon/react";
import { getItemReadableId, INPUT_FORMAT } from "@carbon/utils";
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
  LuPackage,
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
  Number,
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
import { CompactEmpty } from "~/components/Table/components/Compact/CompactEmpty";
import {
  useCurrencyDecimals,
  usePermissions,
  useRouteData,
  useUrlParams,
  useUser
} from "~/hooks";
import { ItemTrackingType } from "~/modules/items";
import {
  MaterialRowDetails,
  MaterialRowTitle
} from "~/modules/items/ui/Item/MethodRow";
import type { MethodItemType, MethodType } from "~/modules/shared";
import type { Item as ItemType } from "~/stores";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import type { jobOperationValidator } from "../../production.models";
import {
  jobMaterialValidator,
  jobMaterialValidatorForReleasedJob
} from "../../production.models";
import type { Job } from "../../types";

type Material = z.infer<typeof jobMaterialValidator> & {
  requiresBatchTracking: boolean;
  requiresSerialTracking: boolean;
  item?: {
    replenishmentSystem: string | null;
  } | null;
};

type Operation = z.infer<typeof jobOperationValidator> & {
  // The same operations data BillOfProcess gets — carries its steps at runtime, so the BoM
  // editor can offer a per-step assignment. Narrow type, optional here.
  jobOperationStep?: { id: string; name: string | null }[];
};

type ItemWithData = SortableItem & {
  data: Material;
};

type JobBillOfMaterialProps = {
  jobMakeMethodId: string;
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
        description={material?.description}
        itemId={material.itemId}
        itemType={material.itemType}
        supersessionMode={
          items.find((i) => i.id === material.itemId)?.supersessionMode
        }
      />
    ),
    checked: checked,
    details: (
      <MaterialRowDetails
        trackingType={
          material.requiresBatchTracking
            ? "Batch"
            : material.requiresSerialTracking
              ? "Serial"
              : null
        }
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

const initialMethodMaterial: Omit<Material, "jobMakeMethodId" | "order"> & {
  description: string;
} = {
  itemId: "",
  // @ts-expect-error
  itemType: "Item" as const,
  methodType: "Purchase to Order" as const,
  description: "",
  quantity: 1,
  unitCost: 0,
  unitOfMeasureCode: "EA"
};

const usePendingMaterials = () => {
  const { jobId } = useParams();
  if (!jobId) throw new Error("jobId not found");

  type PendingItem = ReturnType<typeof useFetchers>[number] & {
    formData: FormData;
  };

  return useFetchers()
    .filter((fetcher): fetcher is PendingItem => {
      return (
        (fetcher.formAction === path.to.newJobMaterial(jobId) ||
          fetcher.formAction?.includes(`/job/${jobId}/material`)) ??
        false
      );
    })
    .reduce<z.infer<typeof jobMaterialValidator>[]>((acc, fetcher) => {
      const formData = fetcher.formData;
      const material = jobMaterialValidator.safeParse(
        Object.fromEntries(formData)
      );

      if (material.success) {
        return [...acc, material.data];
      }
      return acc;
    }, []);
};

const JobBillOfMaterial = ({
  jobMakeMethodId,
  materials: initialMaterials,
  operations
}: JobBillOfMaterialProps) => {
  const { jobId } = useParams();
  if (!jobId) throw new Error("jobId not found");

  const fetcher = useFetcher<{}>();
  const permissions = usePermissions();

  const addItemButtonRef = useRef<HTMLButtonElement>(null);
  const { isPhone } = useViewport();

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [temporaryItems, setTemporaryItems] = useState<TemporaryItems>({});
  const [checkedState, setCheckedState] = useState<CheckedState>({});
  // Only the rows this session has reordered. Every other row takes its order
  // from the loaded data: a copy of all of them taken at mount hid a reorder
  // made anywhere else until the page was reloaded.
  const [orderState, setOrderState] = useState<OrderState>({});

  const materialsById = new Map<string, Material>();

  initialMaterials.forEach((material) => {
    if (!material.id) return;
    materialsById.set(material.id, material);
  });

  const pendingMaterials = usePendingMaterials();

  pendingMaterials.forEach((pendingMaterial) => {
    if (!pendingMaterial.id) {
      materialsById.set("temporary", {
        ...pendingMaterial,
        description: "",
        requiresBatchTracking: false,
        requiresSerialTracking: false
      });
    } else {
      materialsById.set(pendingMaterial.id, {
        ...materialsById.get(pendingMaterial.id)!,
        ...pendingMaterial
      });
    }
  });

  Object.entries(temporaryItems).forEach(([id, material]) => {
    materialsById.set(id, material);
  });

  const [storeItems] = useItems();
  const items = makeItems(
    storeItems,
    Array.from(materialsById.values()),
    orderState,
    checkedState
  ).sort((a, b) => a.data.order - b.data.order);

  const jobData = useRouteData<{ job: Job }>(path.to.job(jobId));
  const isDisabled = ["Completed", "Cancelled"].includes(
    jobData?.job?.status ?? ""
  );
  const isReadOnly = isDisabled || !permissions.can("update", "production");

  const onToggleItem = (id: string) => {
    if (!permissions.can("update", "production") || isDisabled) return;
    setCheckedState((prev) => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const onAddItem = () => {
    if (!permissions.can("update", "production") || isDisabled) return;
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
      jobMakeMethodId
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
    if (!permissions.can("update", "production") || isDisabled) return;

    // Check if this is a temporary item (exists in temporaryItems state)
    if (temporaryItems[id]) {
      setTemporaryItems((prev) => {
        const { [id]: _, ...rest } = prev;
        return rest;
      });
    } else {
      fetcher.submit(new FormData(), {
        method: "post",
        action: path.to.deleteJobMaterial(jobId, id)
      });
    }

    setSelectedItemId(null);
    setOrderState((prev) => {
      const { [id]: _, ...rest } = prev;
      return rest;
    });
  };

  const onReorder = (items: ItemWithData[]) => {
    if (!permissions.can("update", "production") || isDisabled) return;

    const newOrderState = items.reduce<OrderState>((acc, item, index) => {
      acc[item.id] = index + 1;
      return acc;
    }, {});

    setOrderState(newOrderState);

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

  const updateSortOrder = useDebounce(
    (updates: Record<string, number>) => {
      let formData = new FormData();
      formData.append("updates", JSON.stringify(updates));
      fetcher.submit(formData, {
        method: "post",
        action: path.to.jobMaterialsOrder
      });
    },
    1000,
    true
  );

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
              className="mt-3.5"
              onToggle={() => {
                if (isOpen) {
                  if (temporaryItems[item.id]) {
                    setTemporaryItems((prev) => {
                      const { [item.id]: _, ...rest } = prev;
                      return rest;
                    });

                    setOrderState((prev) => {
                      const order = prev[item.id];
                      const { [item.id]: _, ...rest } = prev;
                      return {
                        ...rest,
                        [item.id]: order
                      };
                    });
                  }
                  onSelectItem(null);
                } else {
                  onSelectItem(item.id);
                }
              }}
            />
            <SortableListItemPanel isOpen={isOpen}>
              <MaterialForm
                item={item}
                isDisabled={isDisabled}
                job={jobData?.job}
                setSelectedItemId={setSelectedItemId}
                jobOperations={operations}
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
            isDisabled={isDisabled || !permissions.can("update", "production")}
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
          emptyState={
            isPhone ? (
              <CompactEmpty
                className="py-10"
                icon={<LuPackage />}
                heading={<Trans>No materials yet</Trans>}
                description={<Trans>Add the materials this job uses.</Trans>}
                primaryAction={
                  <Button
                    variant="secondary"
                    isDisabled={
                      isDisabled || !permissions.can("update", "production")
                    }
                    onClick={onAddItem}
                  >
                    <Trans>Add Item</Trans>
                  </Button>
                }
              />
            ) : undefined
          }
        />
      </CardContent>
    </Card>
  );
};

export default JobBillOfMaterial;

function MaterialForm({
  item,
  isDisabled,
  job,
  jobOperations,
  temporaryItems,
  orderState,
  setSelectedItemId,
  setTemporaryItems,
  setOrderState,
  onSubmit
}: {
  item: ItemWithData;
  isDisabled: boolean;
  job?: Job;
  jobOperations: Operation[];
  orderState: OrderState;
  temporaryItems: TemporaryItems;
  setTemporaryItems: Dispatch<SetStateAction<TemporaryItems>>;
  setSelectedItemId: Dispatch<SetStateAction<string | null>>;
  setOrderState: Dispatch<SetStateAction<OrderState>>;
  onSubmit: () => void;
}) {
  const { jobId } = useParams();
  const { t } = useLingui();
  if (!jobId) throw new Error("jobId not found");

  const routeData = useRouteData<{
    job: Job;
  }>(path.to.job(jobId));

  const { carbon } = useCarbon();
  const methodMaterialFetcher = useFetcher<{
    id: string;
    success: boolean;
    message: string;
  }>();
  const params = useParams();
  const { company } = useUser();

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

      if (methodMaterialFetcher.data?.success) {
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
    jobOperationId: string;
    jobOperationStepIds?: string[];
    unitCost: number;
    unitOfMeasureCode: string;
    quantity: number;
    kit: boolean;
    requiresBatchTracking: boolean;
    requiresSerialTracking: boolean;
    storageUnitId?: string;
    itemReplenishmentSystem: string;
  }>({
    itemId: item.data.itemId ?? "",
    methodType: item.data.methodType ?? "Pull from Inventory",
    description: item.data.description ?? "",
    jobOperationId: item.data.jobOperationId ?? "",
    jobOperationStepIds: (
      (item.data as { jobMaterialStep?: { jobOperationStepId: string }[] })
        .jobMaterialStep ?? []
    ).map((s) => s.jobOperationStepId),
    unitCost: item.data.unitCost ?? 0,
    unitOfMeasureCode: item.data.unitOfMeasureCode ?? "EA",
    quantity: item.data.quantity ?? 1,
    kit: item.data.kit ?? false,
    requiresBatchTracking: item.data.requiresBatchTracking ?? false,
    requiresSerialTracking: item.data.requiresSerialTracking ?? false,
    storageUnitId: item.data.storageUnitId ?? undefined,
    itemReplenishmentSystem: item.data.item?.replenishmentSystem ?? "Buy"
  });

  const onTypeChange = (value: MethodItemType | "Item") => {
    if (value === itemType) return;
    setItemType(value as MethodItemType);

    setItemData({
      itemId: "",
      methodType: "" as "Pull from Inventory",
      quantity: 1,
      unitCost: 0,
      description: "",
      unitOfMeasureCode: "EA",
      jobOperationId: "",
      kit: false,
      requiresBatchTracking: false,
      requiresSerialTracking: false,
      storageUnitId: "",
      itemReplenishmentSystem: "Buy"
    });
  };

  const onItemChange = async (itemId: string) => {
    if (!carbon) return;
    if (itemId === params.itemId) {
      toast.error(t`An item cannot be added to itself.`);
      return;
    }

    const [item, itemCost, pickMethod] = await Promise.all([
      carbon
        .from("item")
        .select(
          "name, readableIdWithRevision, type, unitOfMeasureCode, defaultMethodType, itemTrackingType, replenishmentSystem"
        )
        .eq("id", itemId)
        .eq("companyId", company.id)
        .single(),
      carbon.from("itemCost").select("unitCost").eq("itemId", itemId).single(),
      carbon
        .from("pickMethod")
        .select("defaultStorageUnitId")
        .eq("itemId", itemId)
        .eq("companyId", company.id)
        .eq("locationId", locationId!)
        .maybeSingle()
    ]);

    if (item.error) {
      toast.error(t`Failed to load item details`);
      return;
    }

    setItemData((d) => ({
      ...d,
      itemId,
      description: item.data?.name ?? "",
      unitCost: itemCost.data?.unitCost ?? 0,
      unitOfMeasureCode: item.data?.unitOfMeasureCode ?? "EA",
      methodType: item.data?.defaultMethodType ?? "Pull from Inventory",
      requiresBatchTracking:
        item.data?.itemTrackingType === ItemTrackingType.Batch,
      requiresSerialTracking:
        item.data?.itemTrackingType === ItemTrackingType.Serial,
      storageUnitId: pickMethod.data?.defaultStorageUnitId ?? "",
      itemReplenishmentSystem: item.data?.replenishmentSystem ?? "Buy"
    }));

    if (item.data?.type) {
      setItemType(item.data.type as MethodItemType);
    }
  };

  const sourceDisclosure = useDisclosure();
  const isReleased =
    !["Draft", "Planned"].includes(job?.status ?? "") &&
    jobOperations?.length > 0;
  const backflushDisclosure = useDisclosure({
    defaultIsOpen: isReleased
  });
  const locationId = routeData?.job?.locationId ?? undefined;
  const storageUnits = useStorageUnits(locationId);

  const isTracked =
    itemData.requiresBatchTracking || itemData.requiresSerialTracking;

  return (
    <ValidatedForm
      action={
        temporaryItems[item.id]
          ? path.to.newJobMaterial(jobId)
          : path.to.jobMaterial(jobId, item.id!)
      }
      method="post"
      defaultValues={item.data}
      validator={
        ["Draft", "Planned"].includes(job?.status ?? "") ||
        jobOperations?.length === 0
          ? jobMaterialValidator
          : jobMaterialValidatorForReleasedJob
      }
      className="w-full flex flex-col gap-y-4"
      fetcher={methodMaterialFetcher}
    >
      <div>
        <Hidden name="id" />
        <Hidden name="jobMakeMethodId" />
        <Hidden name="kit" value={itemData.kit.toString()} />
        <Hidden name="order" />
        <Hidden
          name="requiresBatchTracking"
          value={itemData.requiresBatchTracking.toString()}
        />
        <Hidden
          name="requiresSerialTracking"
          value={itemData.requiresSerialTracking.toString()}
        />
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

        <Number name="quantity" label={t`Quantity`} />
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
                  ? t`WIP`
                  : t`Default Storage Unit`)}
            </Badge>
            <IconButton
              icon={<LuChevronRight />}
              aria-label={
                sourceDisclosure.isOpen ? "Collapse Source" : "Expand Source"
              }
              variant="ghost"
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
            termId="method-type"
            value={itemData.methodType}
            onChange={(value) => {
              setItemData((d) => ({
                ...d,
                methodType: value?.value as MethodType
              }));
            }}
            replenishmentSystem={itemData.itemReplenishmentSystem}
          />
          <StorageUnit
            name="storageUnitId"
            label={t`Storage Unit`}
            value={itemData.storageUnitId}
            onChange={(value) => {
              setItemData((d) => ({
                ...d,
                storageUnitId: value?.id ?? ""
              }));
            }}
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
              variant={jobOperations.length > 0 ? "secondary" : "destructive"}
            >
              <LuRedoDot className="size-3 mr-1" />
              {itemData.jobOperationId
                ? jobOperations.find((o) => o.id === itemData.jobOperationId)
                    ?.description || t`Selected Operation`
                : t`First Operation`}
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
            name="jobOperationId"
            label={t`Operation`}
            termId="operation"
            isClearable
            options={jobOperations.map((o) => ({
              value: o.id!,
              label: o.description
            }))}
            onChange={(newValue) => {
              setItemData((d) => ({
                ...d,
                jobOperationId: newValue?.value as string,
                // Steps belong to an operation — clear them when the operation changes.
                jobOperationStepIds: []
              }));
            }}
          />
          {/* Part ↔ step assignment now lives on the STEP (the BoP step editor's "Parts"
              picker), not here — so there is no per-material "Steps" dropdown in the BOM. */}
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
