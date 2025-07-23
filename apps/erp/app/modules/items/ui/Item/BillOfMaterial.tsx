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
  toast,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useDisclosure,
  useThrottle,
  VStack,
} from "@carbon/react";
import {
  Link,
  useFetcher,
  useFetchers,
  useParams,
  useSearchParams,
} from "@remix-run/react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import {
  LuChevronDown,
  LuExternalLink,
  LuLock,
  LuSettings2,
  LuSquareFunction,
  LuX,
} from "react-icons/lu";
import type { z } from "zod";
import { MethodIcon, MethodItemTypeIcon, TrackingTypeIcon } from "~/components";
import type { Configuration } from "~/components/Configurator/types";
import {
  DefaultMethodType,
  Hidden,
  InputControlled,
  Item,
  Number,
  Select,
  Submit,
  UnitOfMeasure,
} from "~/components/Form";
import type {
  Item as SortableItem,
  SortableItemRenderProps,
} from "~/components/SortableList";
import { SortableList, SortableListItem } from "~/components/SortableList";
import { usePermissions, useUser } from "~/hooks";

import type { Database } from "@carbon/database";
import { ConfigurationEditor } from "~/components/Configurator/ConfigurationEditor";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import {
  methodType,
  type MethodItemType,
  type MethodType,
} from "~/modules/shared";
import { useBom, useItems, type Item as ItemType } from "~/stores";
import { getItemReadableId } from "~/utils/items";
import { path } from "~/utils/path";
import type { methodOperationValidator } from "../../items.models";
import { methodMaterialValidator } from "../../items.models";
import type {
  ConfigurationParameter,
  ConfigurationRule,
  MakeMethod,
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
};

const BillOfMaterial = ({
  configurable = false,
  configurationRules,
  makeMethod,
  materials: initialMaterials,
  operations,
  parameters,
}: BillOfMaterialProps) => {
  const permissions = usePermissions();
  const isReadOnly =
    permissions.can("update", "parts") === false ||
    makeMethod.status !== "Draft";

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
          itemTrackingType: "Inventory",
        },
      });
    } else {
      materialsById.set(pendingMaterial.id, {
        ...materialsById.get(pendingMaterial.id)!,
        ...pendingMaterial,
      });
    }
  });

  // Add temporary items
  Object.entries(temporaryItems).forEach(([id, material]) => {
    materialsById.set(id, material);
  });

  const materials = makeItems(
    items,
    Array.from(materialsById.values()),
    orderState,
    checkedState
  ).sort((a, b) => a.data.order - b.data.order);

  const onToggleItem = (id: string) => {
    if (isReadOnly) return;
    setCheckedState((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const onAddItem = () => {
    if (isReadOnly) return;
    const temporaryId = Math.random().toString(16).slice(2);
    setSelectedItemId(temporaryId);

    let newOrder = 1;
    if (materials.length) {
      newOrder = Math.max(...materials.map((item) => item.data.order)) + 1;
    }

    setTemporaryItems((prev) => ({
      ...prev,
      [temporaryId]: {
        ...initialMethodMaterial,
        id: temporaryId,
        order: newOrder,
        makeMethodId,
      } as Material,
    }));

    setOrderState((prev) => ({
      ...prev,
      [temporaryId]: newOrder,
    }));
  };

  const onRemoveItem = async (id: string) => {
    if (isReadOnly) return;

    if (isTemporaryId(id)) {
      setTemporaryItems((prev) => {
        const { [id]: _, ...rest } = prev;
        return rest;
      });
      return;
    }

    fetcher.submit(new FormData(), {
      method: "post",
      action: path.to.deleteMethodMaterial(id),
    });

    // Optimistically remove from state
    setTemporaryItems((prev) => {
      const { [id]: _, ...rest } = prev;
      return rest;
    });
  };

  const updateSortOrder = useThrottle((updates: Record<string, number>) => {
    let formData = new FormData();
    formData.append("updates", JSON.stringify(updates));
    fetcher.submit(formData, {
      method: "post",
      action: path.to.methodMaterialsOrder,
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
      if (!isTemporaryId(id)) {
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

  const [selectedMaterialId, setSelectedMaterialId] = useBom();

  const renderListItem = ({
    item,
    items,
    order,
    onToggleItem,
    onRemoveItem,
  }: SortableItemRenderProps<ItemWithData>) => {
    const isOpen = item.id === selectedItemId;
    const onSelectItem = (id: string | null) => {
      setSelectedMaterialId(id);
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
                            configurable={configurable}
                            isReadOnly={isReadOnly}
                            item={item}
                            methodOperations={operations}
                            orderState={orderState}
                            rulesByField={rulesByField}
                            temporaryItems={temporaryItems}
                            onConfigure={onConfigure}
                            setOrderState={setOrderState}
                            setSelectedItemId={setSelectedItemId}
                            setTemporaryItems={setTemporaryItems}
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

  const rulesByField = new Map(
    configurationRules?.map((rule) => [rule.field, rule]) ?? []
  );

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
              variant="secondary"
              isDisabled={isReadOnly || selectedItemId !== null}
              onClick={onAddItem}
            >
              Add Material
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
                        .filter(Boolean),
                    },
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

function isTemporaryId(id: string) {
  return id.length < 20;
}

function MaterialForm({
  configurable,
  isReadOnly,
  item,
  methodOperations,
  rulesByField,
  onConfigure,
  setOrderState,
  setSelectedItemId,
  setTemporaryItems,
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
}) {
  const { carbon } = useCarbon();
  const methodMaterialFetcher = useFetcher<{ id: string }>();
  const params = useParams();
  const { company } = useUser();

  const unitOfMeasures = useUnitOfMeasure();

  useEffect(() => {
    // replace the temporary id with the actual id
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
    methodType: MethodType;
    description: string;
    unitOfMeasureCode: string;
    quantity: number;
    kit: boolean;
  }>({
    itemId: item.data.itemId ?? "",
    methodType: item.data.methodType ?? "Buy",
    description: item.data.description ?? "",
    unitOfMeasureCode: item.data.unitOfMeasureCode ?? "EA",
    quantity: item.data.quantity ?? 1,
    kit: item.data.kit ?? false,
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
      kit: false,
    }));
    if (item.data?.type) {
      setItemType(item.data.type as MethodItemType);
    }
  };

  const key = (field: string) => getFieldKey(field, item.id);

  return (
    <ValidatedForm
      action={
        isTemporaryId(item.id)
          ? path.to.newMethodMaterial
          : path.to.methodMaterial(item.id!)
      }
      method="post"
      defaultValues={item.data}
      validator={methodMaterialValidator}
      className="w-full py-2"
      fetcher={methodMaterialFetcher}
      onSubmit={() => {
        if (!isTemporaryId(item.id)) {
          setSelectedItemId(null);
        }
      }}
    >
      <div>
        <Hidden name="id" />
        <Hidden name="makeMethodId" />
        <Hidden name="order" />
        <Hidden name="kit" value={itemData.kit.toString()} />
      </div>
      <VStack>
        <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
          <Item
            disabledItems={[params.itemId!]}
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
              configurable && !isTemporaryId(item.id)
                ? () =>
                    onConfigure({
                      label: "Part",
                      field: key("itemId"),
                      code: rulesByField.get(key("itemId"))?.code,
                      defaultValue: itemData.itemId,
                      returnType: {
                        type: "text",
                        helperText:
                          "the unique item identifier of the item (not the part number). you can get the item id from the key icon in the properties panel.",
                      },
                    })
                : undefined
            }
            onTypeChange={onTypeChange}
          />
          <InputControlled
            name="description"
            label="Description"
            isDisabled
            value={itemData.description}
            isConfigured={rulesByField.has(key("description"))}
            onConfigure={
              configurable && !isTemporaryId(item.id)
                ? () =>
                    onConfigure({
                      label: "Description",
                      field: key("description"),
                      code: rulesByField.get(key("description"))?.code,
                      defaultValue: itemData.description,
                      returnType: {
                        type: "text",
                      },
                    })
                : undefined
            }
            onChange={(newValue) => {
              setItemData((d) => ({ ...d, description: newValue }));
            }}
          />
          <Select
            name="methodOperationId"
            label="Operation"
            isOptional
            options={methodOperations.map((o) => ({
              value: o.id!,
              label: o.description,
            }))}
          />

          <DefaultMethodType
            name="methodType"
            label="Method Type"
            value={itemData.methodType}
            isConfigured={rulesByField.has(key("methodType"))}
            onConfigure={
              configurable && !isTemporaryId(item.id)
                ? () =>
                    onConfigure({
                      label: "Method Type",
                      field: key("methodType"),
                      code: rulesByField.get(key("methodType"))?.code,
                      defaultValue: itemData.methodType,
                      returnType: {
                        type: "enum",
                        listOptions: methodType,
                      },
                    })
                : undefined
            }
            replenishmentSystem="Buy and Make"
          />
          <Number
            name="quantity"
            label="Quantity"
            isConfigured={rulesByField.has(key("quantity"))}
            onConfigure={
              configurable && !isTemporaryId(item.id)
                ? () =>
                    onConfigure({
                      label: "Quantity",
                      field: key("quantity"),
                      code: rulesByField.get(key("quantity"))?.code,
                      defaultValue: itemData.quantity,
                      returnType: { type: "numeric" },
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
                unitOfMeasureCode: newValue?.value ?? "EA",
              }))
            }
            isConfigured={rulesByField.has(key("unitOfMeasureCode"))}
            onConfigure={
              configurable && !isTemporaryId(item.id)
                ? () =>
                    onConfigure({
                      label: "Unit of Measure",
                      field: key("unitOfMeasureCode"),
                      code: rulesByField.get(key("unitOfMeasureCode"))?.code,
                      defaultValue: itemData.unitOfMeasureCode,
                      returnType: {
                        type: "enum",
                        listOptions: unitOfMeasures.map((u) => u.value),
                      },
                    })
                : undefined
            }
          />
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

            <div className="flex items-center gap-2">
              <Submit isDisabled={isReadOnly}>Save</Submit>
            </div>
          </motion.div>
        </motion.div>
      </VStack>
    </ValidatedForm>
  );
}

function makeItems(
  items: ItemType[],
  materials: Material[],
  orderState: OrderState,
  checkedState: CheckedState
): ItemWithData[] {
  return materials.map((material) => {
    const order = material.id
      ? orderState[material.id] ?? material.order
      : material.order;
    const checked = material.id ? checkedState[material.id] ?? false : false;
    return makeItem(items, material, order, checked);
  });
}

function makeItem(
  items: ItemType[],
  material: Material,
  order: number,
  checked: boolean
): ItemWithData {
  return {
    id: material.id!,
    title: (
      <VStack spacing={0} className="py-1 cursor-pointer">
        <div className="flex items-center gap-2 group">
          <h3 className="font-semibold truncate">
            {getItemReadableId(items, material.itemId) ?? ""}
          </h3>
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
      order,
    },
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
