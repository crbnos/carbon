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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
  useDisclosure,
  useThrottle,
  VStack
} from "@carbon/react";
import { getItemReadableId } from "@carbon/utils";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { nanoid } from "nanoid";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  LuArrowLeft,
  LuChevronDown,
  LuChevronRight,
  LuCog,
  LuExternalLink,
  LuGitPullRequest,
  LuGitPullRequestCreate,
  LuGitPullRequestCreateArrow,
  LuLock,
  LuSettings2,
  LuSquareFunction,
  LuX
} from "react-icons/lu";
import {
  Link,
  useFetcher,
  useFetchers,
  useParams,
  useSearchParams
} from "react-router";
import type { z } from "zod";
import { MethodIcon, MethodItemTypeIcon, TrackingTypeIcon } from "~/components";
import { ConfigurationEditor } from "~/components/Configurator/ConfigurationEditor";
import type { Configuration } from "~/components/Configurator/types";
import {
  DefaultMethodType,
  Hidden,
  Item,
  Location,
  // biome-ignore lint/suspicious/noShadowRestrictedNames: suppressed due to migration
  Number,
  Select,
  Shelf,
  Submit,
  UnitOfMeasure
} from "~/components/Form";
import { useShelves } from "~/components/Form/Shelf";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import type {
  Item as SortableItem,
  SortableItemRenderProps
} from "~/components/SortableList";
import { SortableList, SortableListItem } from "~/components/SortableList";
import { usePermissions, useUrlParams, useUser } from "~/hooks";
import type { MethodItemType, MethodType } from "~/modules/shared";
import { methodType } from "~/modules/shared";

import type { Item as ItemType } from "~/stores";
import { useItems } from "~/stores";

import { path } from "~/utils/path";
import type { methodOperationValidator } from "../../items.models";
import { methodMaterialValidator } from "../../items.models";
import type {
  ConfigurationParameter,
  ConfigurationRule,
  MakeMethod
} from "../../types";
import { getLinkToItemDetails } from "./ItemForm";

type Material = z.infer<typeof methodMaterialValidator> & {
  description: string;
  item: {
    name: string;
    itemTrackingType: Database["public"]["Enums"]["itemTrackingType"];
  };
};

type Operation = z.infer<typeof methodOperationValidator>;

type ItemWithData = SortableItem & {
  data: Material;
};

type BillOfMaterialProps = {
  configurable?: boolean;
  makeMethod: MakeMethod;
  materials: Material[];
  operations: Operation[];
  parameters?: ConfigurationParameter[];
  configurationRules?: ConfigurationRule[];
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

const initialMethodMaterial: Omit<Material, "makeMethodId" | "order"> & {
  description: string;
} = {
  itemId: "",
  // @ts-expect-error
  itemType: "Item" as const,
  methodType: "Buy" as const,
  description: "",
  quantity: 1,
  unitOfMeasureCode: "EA",
  shelfIds: {}
};

const BillOfMaterial = ({
  configurable = false,
  configurationRules,
  makeMethod,
  materials: initialMaterials,
  operations,
  parameters
}: BillOfMaterialProps) => {
  const permissions = usePermissions();
  const isReadOnly =
    permissions.can("update", "parts") === false ||
    makeMethod.status !== "Draft";

  const addItemButtonRef = useRef<HTMLButtonElement>(null);

  const [items] = useItems();
  const fetcher = useFetcher<{}>();
  const [searchParams] = useSearchParams();

  const makeMethodId = makeMethod.id;
  const materialId = searchParams.get("materialId");

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
          itemTrackingType: "Inventory"
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

  const rulesByField = new Map(
    configurationRules?.map((rule) => [rule.field, rule]) ?? []
  );

  const materials = makeItems(
    items,
    Array.from(materialsById.values()),
    orderState,
    checkedState,
    rulesByField
  ).sort((a, b) => a.data.order - b.data.order);

  const onToggleItem = (id: string) => {
    if (isReadOnly) return;
    setCheckedState((prev) => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const onAddItem = () => {
    if (isReadOnly) return;
    const materialId = nanoid();
    setSelectedItemId(materialId);
    setSearchParams({ materialId: materialId });

    let newOrder = 1;
    if (materials.length) {
      newOrder = Math.max(...materials.map((item) => item.data.order)) + 1;
    }

    const newMaterial: Material = {
      ...initialMethodMaterial,
      id: materialId,
      order: newOrder,
      makeMethodId
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
    if (isReadOnly) return;

    // Check if this is a temporary item (exists in temporaryItems state)
    if (temporaryItems[id]) {
      setTemporaryItems((prev) => {
        const { [id]: _, ...rest } = prev;
        return rest;
      });
    } else {
      fetcher.submit(new FormData(), {
        method: "post",
        action: path.to.deleteMethodMaterial(id)
      });
    }

    setSelectedItemId(null);
    setOrderState((prev) => {
      const { [id]: _, ...rest } = prev;
      return rest;
    });
  };

  const updateSortOrder = useThrottle((updates: Record<string, number>) => {
    let formData = new FormData();
    formData.append("updates", JSON.stringify(updates));
    fetcher.submit(formData, {
      method: "post",
      action: path.to.methodMaterialsOrder
    });
  }, 1000);

  const onReorder = (items: ItemWithData[]) => {
    if (isReadOnly) return;

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

      materials.forEach((material) => {
        if (material.checked) {
          newState[material.id] = false;
          changed = true;
        }
      });

      return changed ? newState : prev;
    });
  }, [materials]);

  const [, setSearchParams] = useUrlParams();

  const renderListItem = ({
    item,
    items,
    order,
    onToggleItem,
    onRemoveItem
  }: SortableItemRenderProps<ItemWithData>) => {
    const isOpen = item.id === selectedItemId;
    const onSelectItem = (id: string | null) => {
      setSearchParams({ materialId: id });
      setSelectedItemId(id);
    };

    return (
      <SortableListItem<Material>
        isReadOnly={isReadOnly}
        item={item}
        items={items}
        order={order}
        key={item.id}
        isExpanded={isOpen}
        isHighlighted={item.id === materialId}
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
                    duration: 1.95
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
                    duration: 0.95
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
                          filter: "blur(4px)"
                        }}
                        animate={{
                          y: 0,
                          opacity: 1,
                          filter: "blur(0px)"
                        }}
                        transition={{
                          type: "spring",
                          duration: 0.15
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
                            delay: 0.15
                          }}
                        >
                          <MaterialForm
                            configurable={configurable}
                            isReadOnly={isReadOnly}
                            item={item}
                            methodOperations={operations}
                            orderState={orderState}
                            temporaryItems={temporaryItems}
                            rulesByField={rulesByField}
                            onConfigure={onConfigure}
                            setOrderState={setOrderState}
                            setSelectedItemId={setSelectedItemId}
                            setTemporaryItems={setTemporaryItems}
                            onSubmit={() => {
                              setSelectedItemId(null);
                              addItemButtonRef.current?.scrollIntoView({
                                behavior: "smooth",
                                block: "nearest",
                                inline: "center"
                              });
                            }}
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

  const configuratorDisclosure = useDisclosure();
  const [configuration, setConfiguration] = useState<Configuration | null>(
    null
  );

  const onConfigure = (configuration: Configuration) => {
    flushSync(() => {
      setConfiguration(configuration);
    });
    configuratorDisclosure.onOpen();
  };

  return (
    <Card>
      <HStack className="justify-between">
        <CardHeader>
          <CardTitle className="flex flex-row items-center gap-2">
            Bill of Material {isReadOnly && <LuLock />}
          </CardTitle>
        </CardHeader>

        <CardAction>
          <div className="flex items-center gap-2">
            <Button
              ref={addItemButtonRef}
              variant="secondary"
              isDisabled={isReadOnly}
              onClick={onAddItem}
            >
              Add Item
            </Button>
            {configurable && materials.length > 0 && (
              <IconButton
                icon={<LuSquareFunction />}
                aria-label="Configure"
                variant="ghost"
                className={cn(
                  rulesByField.has(
                    `billOfMaterial:${makeMethodId}:${materialId}`
                  ) && "text-emerald-500 hover:text-emerald-500"
                )}
                onClick={() =>
                  onConfigure({
                    label: "Bill of Material",
                    field: `billOfMaterial:${makeMethodId}:${materialId}`,
                    code: rulesByField.get(
                      `billOfMaterial:${makeMethodId}:${materialId}`
                    )?.code,
                    returnType: {
                      type: "list",
                      listOptions: materials
                        .map(
                          (m) => getItemReadableId(items, m.data.itemId) ?? ""
                        )
                        .filter((i) => !!i)
                    }
                  })
                }
              />
            )}
          </div>
        </CardAction>
      </HStack>
      <CardContent>
        <SortableList
          isReadOnly={isReadOnly}
          items={materials}
          onReorder={onReorder}
          onToggleItem={onToggleItem}
          onRemoveItem={onRemoveItem}
          renderItem={renderListItem}
        />
      </CardContent>
      {configuratorDisclosure.isOpen && configuration && (
        <ConfigurationEditor
          configuration={configuration}
          open={configuratorDisclosure.isOpen}
          parameters={parameters ?? []}
          onClose={configuratorDisclosure.onClose}
        />
      )}
    </Card>
  );
};

export default BillOfMaterial;

function MaterialForm({
  configurable,
  isReadOnly,
  item,
  methodOperations,
  temporaryItems,
  rulesByField,
  onConfigure,
  setOrderState,
  setSelectedItemId,
  setTemporaryItems,
  onSubmit
}: {
  configurable: boolean;
  isReadOnly: boolean;
  item: ItemWithData;
  methodOperations: Operation[];
  orderState: OrderState;
  temporaryItems: TemporaryItems;
  rulesByField: Map<string, ConfigurationRule>;
  setSelectedItemId: Dispatch<SetStateAction<string | null>>;
  setTemporaryItems: Dispatch<SetStateAction<TemporaryItems>>;
  setOrderState: Dispatch<SetStateAction<OrderState>>;
  onConfigure: (configuration: Configuration) => void;
  onSubmit: () => void;
}) {
  const { carbon } = useCarbon();
  const methodMaterialFetcher = useFetcher<{
    id: string;
    success: boolean;
    message: string;
  }>();
  const params = useParams();
  const { company, defaults } = useUser();
  const [locationId, setLocationId] = useState<string | undefined>(
    defaults.locationId ?? undefined
  );

  const shelves = useShelves(locationId);

  useEffect(() => {
    if (defaults.locationId) {
      setLocationId(defaults.locationId);
    }
  }, [defaults.locationId]);

  const unitOfMeasures = useUnitOfMeasure();

  const sourceDisclosure = useDisclosure({
    defaultIsOpen: true
  });
  const backflushDisclosure = useDisclosure();

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
    unitOfMeasureCode: string;
    methodOperationId: string | undefined;
    quantity: number;
    kit: boolean;
    shelfIds: Record<string, string>;
  }>({
    itemId: item.data.itemId ?? "",
    methodType: item.data.methodType ?? "Buy",
    description: item.data.description ?? "",
    unitOfMeasureCode: item.data.unitOfMeasureCode ?? "EA",
    methodOperationId: item.data.methodOperationId ?? undefined,
    quantity: item.data.quantity ?? 1,
    kit: item.data.kit ?? false,
    shelfIds: item.data.shelfIds ?? {}
  });

  const onTypeChange = (value: MethodItemType | "Item") => {
    if (value === itemType) return;
    setItemType(value as MethodItemType);

    setItemData({
      itemId: "",
      methodType: "" as "Buy",
      quantity: 1,
      description: "",
      unitOfMeasureCode: "EA",
      kit: false,
      shelfIds: {},
      methodOperationId: undefined
    });
  };

  const onItemChange = async (itemId: string) => {
    if (!carbon) return;
    if (itemId === params.itemId) {
      toast.error("An item cannot be added to itself.");
      return;
    }

    const item = await carbon
      .from("item")
      .select(
        "name, readableIdWithRevision, type, unitOfMeasureCode, defaultMethodType"
      )
      .eq("id", itemId)
      .eq("companyId", company.id)
      .single();

    if (item.error) {
      toast.error("Failed to load item details");
      return;
    }

    setItemData((d) => ({
      ...d,
      itemId,
      description: item.data?.name ?? "",
      unitOfMeasureCode: item.data?.unitOfMeasureCode ?? "EA",
      methodType: item.data?.defaultMethodType ?? "Buy",
      kit: false
    }));
    if (item.data?.type) {
      setItemType(item.data.type as MethodItemType);
    }
  };

  const key = (field: string) => getFieldKey(field, item.id);

  return (
    <ValidatedForm
      action={
        temporaryItems[item.id]
          ? path.to.newMethodMaterial
          : path.to.methodMaterial(item.id!)
      }
      method="post"
      defaultValues={{
        ...item.data
      }}
      validator={methodMaterialValidator}
      className="w-full flex flex-col gap-y-4"
      fetcher={methodMaterialFetcher}
    >
      <div>
        <Hidden name="id" />
        <Hidden name="makeMethodId" />
        <Hidden name="order" />
        <Hidden name="kit" value={itemData.kit.toString()} />
        <Hidden name="shelfIds" value={JSON.stringify(itemData.shelfIds)} />
      </div>

      <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
        <Item
          blacklist={[params.itemId!]}
          name="itemId"
          label={itemType}
          includeInactive
          type={itemType}
          validItemTypes={["Consumable", "Material", "Part"]}
          isConfigured={rulesByField.has(key("itemId"))}
          onChange={(value) => {
            onItemChange(value?.value as string);
          }}
          onConfigure={
            configurable && !temporaryItems[item.id]
              ? () =>
                  onConfigure({
                    label: "Part",
                    field: key("itemId"),
                    code: rulesByField.get(key("itemId"))?.code,
                    defaultValue: itemData.itemId,
                    returnType: {
                      type: "text",
                      helperText:
                        "the unique item identifier of the item (not the part number). you can get the item id from the key icon in the properties panel."
                    }
                  })
              : undefined
          }
          onTypeChange={onTypeChange}
        />
        <Number
          name="quantity"
          label="Quantity"
          isConfigured={rulesByField.has(key("quantity"))}
          onConfigure={
            configurable && !temporaryItems[item.id]
              ? () =>
                  onConfigure({
                    label: "Quantity",
                    field: key("quantity"),
                    code: rulesByField.get(key("quantity"))?.code,
                    defaultValue: itemData.quantity,
                    returnType: { type: "numeric" }
                  })
              : undefined
          }
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
          isReadOnly={true}
          isConfigured={rulesByField.has(key("unitOfMeasureCode"))}
          onConfigure={
            configurable && !temporaryItems[item.id]
              ? () =>
                  onConfigure({
                    label: "Unit of Measure",
                    field: key("unitOfMeasureCode"),
                    code: rulesByField.get(key("unitOfMeasureCode"))?.code,
                    defaultValue: itemData.unitOfMeasureCode,
                    returnType: {
                      type: "enum",
                      listOptions: unitOfMeasures.map((u) => u.value)
                    }
                  })
              : undefined
          }
        />
      </div>
      <div className="border border-border rounded-md shadow-sm p-4 flex flex-col gap-4 w-full">
        <HStack
          className="w-full justify-between cursor-pointer"
          onClick={sourceDisclosure.onToggle}
        >
          <HStack>
            {itemData.methodType === "Make" ? (
              <>
                <LuGitPullRequestCreate />
                <Label>Finish To</Label>
              </>
            ) : (
              <>
                <LuGitPullRequest />
                <Label>Pull From</Label>
              </>
            )}
          </HStack>
          <HStack>
            <Badge variant="secondary">
              <MethodIcon type={itemData.methodType} className="size-3 mr-1" />
              {itemData.methodType}
            </Badge>
            <LuArrowLeft
              className={cn(itemData.methodType !== "Pick" ? "rotate-180" : "")}
            />
            <Badge variant="secondary">
              <LuGitPullRequest className="size-3 mr-1" />
              {shelves.options?.find(
                (s) => s.value === itemData.shelfIds[locationId ?? ""]
              )?.label ??
                (itemData.methodType === "Make" ? "WIP" : "Default Shelf")}
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
            label="Method Type"
            value={itemData.methodType}
            onChange={(value) => {
              setItemData((d) => ({
                ...d,
                methodType: value?.value as MethodType
              }));
            }}
            isConfigured={rulesByField.has(key("methodType"))}
            onConfigure={
              configurable && !temporaryItems[item.id]
                ? () =>
                    onConfigure({
                      label: "Method Type",
                      field: key("methodType"),
                      code: rulesByField.get(key("methodType"))?.code,
                      defaultValue: itemData.methodType,
                      returnType: {
                        type: "enum",
                        listOptions: methodType
                      }
                    })
                : undefined
            }
            replenishmentSystem="Buy and Make"
          />
          <Location
            name="locationId"
            label="Location"
            value={locationId}
            onChange={(value) => {
              setLocationId(value?.value as string);
            }}
          />
          <Shelf
            name="shelfId"
            label="Shelf"
            value={itemData.shelfIds[locationId ?? ""]}
            locationId={locationId}
            onChange={(value) => {
              setItemData((d) => ({
                ...d,
                shelfIds: {
                  ...d.shelfIds,
                  [locationId ?? ""]: value?.id ?? ""
                }
              }));
            }}
            isOptional
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
            <Label>Backflush</Label>
          </HStack>
          <HStack>
            <Badge
              variant={
                methodOperations.length > 0 ? "secondary" : "destructive"
              }
            >
              <LuCog className="size-3 mr-1" />
              {itemData.methodOperationId
                ? methodOperations.find(
                    (o) => o.id === itemData.methodOperationId
                  )?.description || "Selected Operation"
                : "First Operation"}
            </Badge>
            <IconButton
              icon={<LuChevronRight />}
              aria-label={
                backflushDisclosure.isOpen
                  ? "Collapse Backflush"
                  : "Expand Backflush"
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
            name="methodOperationId"
            label="Operation"
            isOptional
            options={methodOperations.map((o) => ({
              value: o.id!,
              label: o.description
            }))}
            onChange={(value) => {
              setItemData((d) => ({
                ...d,
                methodOperationId: value?.value
              }));
            }}
          />
        </div>
      </div>

      <motion.div
        className="flex flex-1 items-center justify-end w-full"
        initial={{ opacity: 0, filter: "blur(4px)" }}
        animate={{ opacity: 1, filter: "blur(0px)" }}
        transition={{
          type: "spring",
          bounce: 0,
          duration: 0.55
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
                      kit: value === "Kit"
                    }));
                  }}
                >
                  <DropdownMenuRadioItem value="Subassembly">
                    Subassembly
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="Kit">Kit</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2">
            <Submit
              isDisabled={isReadOnly || methodMaterialFetcher.state !== "idle"}
              isLoading={methodMaterialFetcher.state === "submitting"}
            >
              Save
            </Submit>
          </div>
        </motion.div>
      </motion.div>
    </ValidatedForm>
  );
}

function makeItems(
  items: ItemType[],
  materials: Material[],
  orderState: OrderState,
  checkedState: CheckedState,
  rulesByField?: Map<string, ConfigurationRule>
): ItemWithData[] {
  return materials.map((material) => {
    const order = material.id
      ? (orderState[material.id] ?? material.order)
      : material.order;
    const checked = material.id ? (checkedState[material.id] ?? false) : false;
    return makeItem(items, material, order, checked, rulesByField);
  });
}

function materialHasRules(
  materialId: string,
  rulesByField?: Map<string, ConfigurationRule>
): boolean {
  if (!rulesByField) return false;
  const fields = ["itemId", "quantity", "unitOfMeasureCode", "methodType"];
  return fields.some((field) =>
    rulesByField.has(getFieldKey(field, materialId))
  );
}

function makeItem(
  items: ItemType[],
  material: Material,
  order: number,
  checked: boolean,
  rulesByField?: Map<string, ConfigurationRule>
): ItemWithData {
  const hasRules = material.id
    ? materialHasRules(material.id, rulesByField)
    : false;

  return {
    id: material.id!,
    title: (
      <VStack spacing={0} className="py-1 cursor-pointer">
        <div className="flex items-center gap-2 group">
          <h3 className="font-semibold truncate">
            {getItemReadableId(items, material.itemId) ?? ""}
          </h3>
          {hasRules && (
            <LuSquareFunction className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
          )}
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
    checked,
    details: (
      <HStack spacing={2}>
        {["Batch", "Serial"].includes(
          material.item?.itemTrackingType ?? ""
        ) && (
          <Tooltip>
            <TooltipTrigger>
              <Badge variant="secondary">
                <TrackingTypeIcon
                  type={material.item?.itemTrackingType ?? ""}
                />
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              {material.item.itemTrackingType} Tracking
            </TooltipContent>
          </Tooltip>
        )}

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
      order
    }
  };
}

function getFieldKey(field: string, itemId: string) {
  return `${field}:${itemId}`;
}

const usePendingMaterials = () => {
  type PendingItem = ReturnType<typeof useFetchers>[number] & {
    formData: FormData;
  };

  return useFetchers()
    .filter((fetcher): fetcher is PendingItem => {
      return (
        (fetcher.formAction === path.to.newMethodMaterial ||
          fetcher.formAction?.includes("/items/methods/material/")) ??
        false
      );
    })
    .reduce<z.infer<typeof methodMaterialValidator>[]>((acc, fetcher) => {
      const formData = fetcher.formData;
      const material = methodMaterialValidator.safeParse(
        Object.fromEntries(formData)
      );

      if (material.success) {
        return [...acc, material.data];
      }
      return acc;
    }, []);
};
