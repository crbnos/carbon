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
  toast,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useDebounce,
  VStack,
} from "@carbon/react";
import { Link, useFetcher, useFetchers, useParams } from "@remix-run/react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useState } from "react";
import {
  LuChevronDown,
  LuExternalLink,
  LuSettings2,
  LuX,
} from "react-icons/lu";
import type { z } from "zod";
import { MethodIcon, MethodItemTypeIcon, TrackingTypeIcon } from "~/components";
import {
  DefaultMethodType,
  Hidden,
  InputControlled,
  Item,
  Number,
  NumberControlled,
  Select,
  Submit,
  UnitOfMeasure,
} from "~/components/Form";
import type {
  Item as SortableItem,
  SortableItemRenderProps,
} from "~/components/SortableList";
import { SortableList, SortableListItem } from "~/components/SortableList";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import { getLinkToItemDetails } from "~/modules/items/ui/Item/ItemForm";
import type { MethodItemType, MethodType } from "~/modules/shared";
import { useBom } from "~/stores";
import { path } from "~/utils/path";
import type { jobOperationValidator } from "../../production.models";
import {
  jobMaterialValidator,
  jobMaterialValidatorForReleasedJob,
} from "../../production.models";
import type { Job } from "../../types";

type Material = z.infer<typeof jobMaterialValidator> & {
  requiresBatchTracking: boolean;
  requiresSerialTracking: boolean;
};

type Operation = z.infer<typeof jobOperationValidator>;

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
  materials: Material[],
  orderState: OrderState,
  checkedState: CheckedState
): ItemWithData[] {
  return materials.map((material) => {
    const order = material.id
      ? orderState[material.id] ?? material.order
      : material.order;
    const checked = material.id ? checkedState[material.id] ?? false : false;
    return makeItem(material, order, checked);
  });
}

function makeItem(
  material: Material,
  order: number,
  checked: boolean
): ItemWithData {
  return {
    id: material.id!,
    title: (
      <VStack spacing={0} className="py-1 cursor-pointer">
        <div className="flex items-center gap-2 group">
          <h3 className="font-semibold truncate">{material.itemReadableId}</h3>
          {material.itemId && material.itemType && (
            <Link to={getLinkToItemDetails(material.itemType, material.itemId)}>
              <LuExternalLink className="h-4 w-4 opacity-0 group-hover:opacity-100" />
            </Link>
          )}
        </div>
        {material?.description && (
          <span className="text-xs text-muted-foreground">
            {material.description}{" "}
          </span>
        )}
      </VStack>
    ),
    checked: checked,
    details: (
      <HStack spacing={2}>
        {material.requiresBatchTracking ? (
          <Tooltip>
            <TooltipTrigger>
              <Badge variant="secondary">
                <TrackingTypeIcon type="Batch" />
              </Badge>
            </TooltipTrigger>
            <TooltipContent>Batch Tracking</TooltipContent>
          </Tooltip>
        ) : material.requiresSerialTracking ? (
          <Tooltip>
            <TooltipTrigger>
              <Badge variant="secondary">
                <TrackingTypeIcon type="Serial" />
              </Badge>
            </TooltipTrigger>
            <TooltipContent>Serial Tracking</TooltipContent>
          </Tooltip>
        ) : null}

        <Tooltip>
          <TooltipTrigger>
            <Badge variant="secondary">
              <MethodIcon type={material.methodType} isKit={material.kit} />
            </Badge>
          </TooltipTrigger>
          <TooltipContent>{material.methodType}</TooltipContent>
        </Tooltip>
        <Badge variant="secondary">{material.quantity}</Badge>

        <Tooltip>
          <TooltipTrigger>
            <Badge variant="secondary">
              <MethodItemTypeIcon type={material.itemType} />
            </Badge>
          </TooltipTrigger>
          <TooltipContent>{material.itemType}</TooltipContent>
        </Tooltip>
      </HStack>
    ),
    data: {
      ...material,
      order,
    },
  };
}

const initialMethodMaterial: Omit<Material, "jobMakeMethodId" | "order"> & {
  description: string;
} = {
  itemId: "",
  itemReadableId: "",
  // @ts-ignore
  itemType: "Item" as const,
  methodType: "Buy" as const,
  description: "",
  quantity: 1,
  unitCost: 0,
  unitOfMeasureCode: "EA",
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
  operations,
}: JobBillOfMaterialProps) => {
  const { jobId } = useParams();
  if (!jobId) throw new Error("jobId not found");

  const fetcher = useFetcher<{}>();
  const permissions = usePermissions();

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [temporaryItems, setTemporaryItems] = useState<TemporaryItems>({});
  const [checkedState, setCheckedState] = useState<CheckedState>({});
  const [orderState, setOrderState] = useState<OrderState>(() => {
    return initialMaterials.reduce((acc, material) => {
      acc[material.id!] = material.order;
      return acc;
    }, {} as OrderState);
  });

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
        requiresSerialTracking: false,
      });
    } else {
      materialsById.set(pendingMaterial.id, {
        ...materialsById.get(pendingMaterial.id)!,
        ...pendingMaterial,
      });
    }
  });

  Object.entries(temporaryItems).forEach(([id, material]) => {
    materialsById.set(id, material);
  });

  const items = makeItems(
    Array.from(materialsById.values()),
    orderState,
    checkedState
  ).sort((a, b) => a.data.order - b.data.order);

  const jobData = useRouteData<{ job: Job }>(path.to.job(jobId));
  const isDisabled = ["Completed", "Cancelled"].includes(
    jobData?.job?.status ?? ""
  );

  const onToggleItem = (id: string) => {
    if (!permissions.can("update", "production") || isDisabled) return;
    setCheckedState((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const onAddItem = () => {
    if (!permissions.can("update", "production") || isDisabled) return;
    const temporaryId = Math.random().toString(16).slice(2);
    setSelectedItemId(temporaryId);

    let newOrder = 1;
    if (items.length) {
      newOrder = Math.max(...items.map((item) => item.data.order)) + 1;
    }

    setTemporaryItems((prev) => ({
      ...prev,
      [temporaryId]: {
        ...initialMethodMaterial,
        id: temporaryId,
        order: newOrder,
        jobMakeMethodId,
      } as Material,
    }));

    setOrderState((prev) => ({
      ...prev,
      [temporaryId]: newOrder,
    }));
  };

  const onRemoveItem = async (id: string) => {
    if (!permissions.can("update", "production") || isDisabled) return;

    if (isTemporaryId(id)) {
      setTemporaryItems((prev) => {
        const { [id]: _, ...rest } = prev;
        return rest;
      });
      return;
    }

    fetcher.submit(new FormData(), {
      method: "post",
      action: path.to.deleteJobMaterial(jobId, id),
    });

    setTemporaryItems((prev) => {
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
      if (!isTemporaryId(id)) {
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
        action: path.to.jobMaterialsOrder,
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

  const [selectedMaterialId, setSelectedMaterialId] = useBom();
  const onSelectItem = (id: string | null) => {
    setSelectedMaterialId(id);
    setSelectedItemId(id);
  };

  const renderListItem = ({
    item,
    items,
    order,
    onToggleItem,
    onRemoveItem,
  }: SortableItemRenderProps<ItemWithData>) => {
    const isOpen = item.id === selectedItemId;

    return (
      <SortableListItem<Material>
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
        className="my-2 "
        renderExtra={(item) => (
          <div key={`${isOpen}`}>
            <motion.button
              layout
              onClick={
                isOpen
                  ? () => {
                      if (isTemporaryId(item.id)) {
                        setTemporaryItems((prev) => {
                          const { [item.id]: _, ...rest } = prev;
                          return rest;
                        });

                        setOrderState((prev) => {
                          const order = prev[item.id];
                          const { [item.id]: _, ...rest } = prev;
                          return {
                            ...rest,
                            [item.id]: order,
                          };
                        });
                      }
                      onSelectItem(null);
                    }
                  : () => {
                      onSelectItem(item.id);
                    }
              }
              key="collapse"
              className={cn("absolute right-3 top-3 z-10")}
            >
              {isOpen ? (
                <motion.span
                  initial={{ opacity: 0, filter: "blur(4px)" }}
                  animate={{ opacity: 1, filter: "blur(0px)" }}
                  exit={{ opacity: 1, filter: "blur(0px)" }}
                  transition={{
                    type: "spring",
                    duration: 1.95,
                  }}
                >
                  <LuX className="h-5 w-5 text-foreground" />
                </motion.span>
              ) : (
                <motion.span
                  initial={{ opacity: 0, filter: "blur(4px)" }}
                  animate={{ opacity: 1, filter: "blur(0px)" }}
                  exit={{ opacity: 1, filter: "blur(0px)" }}
                  transition={{
                    type: "spring",
                    duration: 0.95,
                  }}
                >
                  <LuSettings2 className="stroke-1 mt-3.5 h-5 w-5 text-foreground/80  hover:stroke-primary/70 " />
                </motion.span>
              )}
            </motion.button>

            <LayoutGroup id={`${item.id}`}>
              <AnimatePresence mode="popLayout">
                {isOpen ? (
                  <motion.div className="flex w-full flex-col ">
                    <div className=" w-full p-2">
                      <motion.div
                        initial={{
                          y: 0,
                          opacity: 0,
                          filter: "blur(4px)",
                        }}
                        animate={{
                          y: 0,
                          opacity: 1,
                          filter: "blur(0px)",
                        }}
                        transition={{
                          type: "spring",
                          duration: 0.15,
                        }}
                        layout
                        className="w-full "
                      >
                        <motion.div
                          initial={{ opacity: 0, filter: "blur(4px)" }}
                          animate={{ opacity: 1, filter: "blur(0px)" }}
                          transition={{
                            type: "spring",
                            bounce: 0.2,
                            duration: 0.75,
                            delay: 0.15,
                          }}
                        >
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
                          />
                        </motion.div>
                      </motion.div>
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </LayoutGroup>
          </div>
        )}
      />
    );
  };

  return (
    <Card>
      <HStack className="justify-between">
        <CardHeader>
          <CardTitle>Bill of Material</CardTitle>
        </CardHeader>

        <CardAction>
          <Button
            variant="secondary"
            isDisabled={
              isDisabled ||
              !permissions.can("update", "production") ||
              selectedItemId !== null
            }
            onClick={onAddItem}
          >
            Add Material
          </Button>
        </CardAction>
      </HStack>
      <CardContent>
        <SortableList
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

export default JobBillOfMaterial;

function isTemporaryId(id: string) {
  return id.length < 20;
}

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
}) {
  const { jobId } = useParams();
  if (!jobId) throw new Error("jobId not found");

  const { carbon } = useCarbon();
  const methodMaterialFetcher = useFetcher<{ id: string }>();
  const params = useParams();
  const { company } = useUser();

  const baseCurrency = company?.baseCurrencyCode ?? "USD";

  useEffect(() => {
    if (methodMaterialFetcher.data && methodMaterialFetcher.data.id) {
      if (isTemporaryId(item.id)) {
        setTemporaryItems((prev) => {
          const { [item.id]: _, ...rest } = prev;
          return rest;
        });

        setOrderState((prev) => {
          const order = prev[item.id];
          const { [item.id]: _, ...rest } = prev;
          return {
            ...rest,
            [methodMaterialFetcher.data!.id!]: order,
          };
        });
      }
      setSelectedItemId(null);
    }
  }, [
    item.id,
    methodMaterialFetcher.data,
    setTemporaryItems,
    setOrderState,
    setSelectedItemId,
  ]);

  const [itemType, setItemType] = useState<MethodItemType>(item.data.itemType);
  const [itemData, setItemData] = useState<{
    itemId: string;
    itemReadableId: string;
    methodType: MethodType;
    description: string;
    unitCost: number;
    unitOfMeasureCode: string;
    quantity: number;
    kit: boolean;
    requiresBatchTracking: boolean;
    requiresSerialTracking: boolean;
  }>({
    itemId: item.data.itemId ?? "",
    itemReadableId: item.data.itemReadableId ?? "",
    methodType: item.data.methodType ?? "Buy",
    description: item.data.description ?? "",
    unitCost: item.data.unitCost ?? 0,
    unitOfMeasureCode: item.data.unitOfMeasureCode ?? "EA",
    quantity: item.data.quantity ?? 1,
    kit: item.data.kit ?? false,
    requiresBatchTracking: item.data.requiresBatchTracking ?? false,
    requiresSerialTracking: item.data.requiresSerialTracking ?? false,
  });

  const onTypeChange = (value: MethodItemType | "Item") => {
    if (value === itemType) return;
    setItemType(value as MethodItemType);

    setItemData({
      itemId: "",
      itemReadableId: "",
      methodType: "" as "Buy",
      quantity: 1,
      unitCost: 0,
      description: "",
      unitOfMeasureCode: "EA",
      kit: false,
      requiresBatchTracking: false,
      requiresSerialTracking: false,
    });
  };

  const onItemChange = async (itemId: string) => {
    if (!carbon) return;
    if (itemId === params.itemId) {
      toast.error("An item cannot be added to itself.");
      return;
    }

    const [item, itemCost] = await Promise.all([
      carbon
        .from("item")
        .select(
          "name, readableIdWithRevision, type, unitOfMeasureCode, defaultMethodType, itemTrackingType"
        )
        .eq("id", itemId)
        .eq("companyId", company.id)
        .single(),
      carbon.from("itemCost").select("unitCost").eq("itemId", itemId).single(),
    ]);

    if (item.error) {
      toast.error("Failed to load item details");
      return;
    }

    setItemData((d) => ({
      ...d,
      itemId,
      itemReadableId: item.data?.readableIdWithRevision ?? "",
      description: item.data?.name ?? "",
      unitCost: itemCost.data?.unitCost ?? 0,
      unitOfMeasureCode: item.data?.unitOfMeasureCode ?? "EA",
      methodType: item.data?.defaultMethodType ?? "Buy",
      requiresBatchTracking: item.data?.itemTrackingType === "Batch",
      requiresSerialTracking: item.data?.itemTrackingType === "Serial",
    }));

    if (item.data?.type) {
      setItemType(item.data.type as MethodItemType);
    }
  };

  return (
    <ValidatedForm
      action={
        isTemporaryId(item.id)
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
      className="w-full"
      fetcher={methodMaterialFetcher}
      onSubmit={() => {
        if (!isTemporaryId(item.id)) {
          setSelectedItemId(null);
        }
      }}
    >
      <Hidden name="id" />
      <Hidden name="jobMakeMethodId" />
      <Hidden name="itemReadableId" value={itemData.itemReadableId} />
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
      {itemData.methodType === "Make" && (
        <Hidden name="unitCost" value={itemData.unitCost} />
      )}
      <VStack>
        <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
          <Item
            disabledItems={[params.itemId!]}
            isReadOnly={isDisabled}
            name="itemId"
            label={itemType}
            includeInactive
            validItemTypes={["Consumable", "Material", "Part"]}
            type={itemType}
            onChange={(value) => {
              onItemChange(value?.value as string);
            }}
            onTypeChange={onTypeChange}
          />
          <InputControlled
            name="description"
            label="Description"
            value={itemData.description}
            onChange={(newValue) => {
              setItemData((d) => ({ ...d, description: newValue }));
            }}
          />
          <Select
            name="jobOperationId"
            label="Operation"
            isClearable
            options={jobOperations.map((o) => ({
              value: o.id!,
              label: o.description,
            }))}
          />

          <DefaultMethodType
            name="methodType"
            label="Method Type"
            value={itemData.methodType}
            replenishmentSystem="Buy and Make"
          />
          <Number name="quantity" label="Quantity per Parent" />
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

          {itemData.methodType !== "Make" && (
            <NumberControlled
              name="unitCost"
              label="Unit Cost"
              value={itemData.unitCost}
              minValue={0}
              formatOptions={{
                style: "currency",
                currency: baseCurrency,
              }}
            />
          )}
        </div>

        <motion.div
          className="flex flex-1 items-center justify-end w-full pt-2"
          initial={{ opacity: 0, filter: "blur(4px)" }}
          animate={{ opacity: 1, filter: "blur(0px)" }}
          transition={{
            type: "spring",
            bounce: 0,
            duration: 0.55,
          }}
        >
          <motion.div
            layout
            className="flex items-center justify-between gap-2 w-full"
          >
            {itemData.methodType === "Make" ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    leftIcon={<MethodIcon type={"Make"} isKit={itemData.kit} />}
                    variant="secondary"
                    size="sm"
                    rightIcon={<LuChevronDown />}
                  >
                    {itemData.kit ? "Kit" : "Subassembly"}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuRadioGroup
                    value={itemData.kit ? "Kit" : "Subassembly"}
                    onValueChange={(value) => {
                      setItemData((d) => ({
                        ...d,
                        kit: value === "Kit",
                      }));
                    }}
                  >
                    <DropdownMenuRadioItem value="Subassembly">
                      Subassembly
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="Kit">
                      Kit
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <div />
            )}

            <Submit isDisabled={isDisabled}>Save</Submit>
          </motion.div>
        </motion.div>
      </VStack>
    </ValidatedForm>
  );
}
