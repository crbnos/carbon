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
  HStack,
  IconButton,
  toast,
  useDisclosure,
  useThrottle,
  VStack,
} from "@carbon/react";
import { useFetcher, useFetchers, useParams } from "@remix-run/react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { LuFunctionSquare, LuSettings2, LuX } from "react-icons/lu";
import type { z } from "zod";
import { MethodIcon, MethodItemTypeIcon } from "~/components";
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

import { Configurator } from "~/components/Configurator";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import {
  methodType,
  type MethodItemType,
  type MethodType,
} from "~/modules/shared";
import { path } from "~/utils/path";
import type { methodOperationValidator } from "../../items.models";
import { methodMaterialValidator } from "../../items.models";
import type { ConfigurationParameter, ConfigurationRule } from "../../types";

type Material = z.infer<typeof methodMaterialValidator> & {
  description: string;
};

type Operation = z.infer<typeof methodOperationValidator>;

type ItemWithData = SortableItem & {
  data: Material;
};

type BillOfMaterialProps = {
  configurable?: boolean;
  makeMethodId: string;
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
  itemReadableId: "",
  itemType: "Material" as const,
  methodType: "Buy" as const,
  description: "",
  quantity: 1,
  unitOfMeasureCode: "EA",
};

const BillOfMaterial = ({
  configurable = false,
  configurationRules,
  makeMethodId,
  materials: initialMaterials,
  operations,
  parameters,
}: BillOfMaterialProps) => {
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
    Array.from(materialsById.values()),
    orderState,
    checkedState
  ).sort((a, b) => a.data.order - b.data.order);

  const onToggleItem = (id: string) => {
    if (!permissions.can("update", "parts")) return;
    setCheckedState((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const onAddItem = () => {
    if (!permissions.can("update", "parts")) return;
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
    if (!permissions.can("update", "parts")) return;

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
    if (!permissions.can("update", "parts")) return;

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
        onSelectItem={setSelectedItemId}
        onToggleItem={onToggleItem}
        onRemoveItem={onRemoveItem}
        handleDrag={onCloseOnDrag}
        className="my-2 "
        renderExtra={(item) => (
          <div
            key={`${isOpen}`}
            className={cn(
              "flex h-full flex-col items-center justify-center pl-2",
              isOpen ? "py-1" : "py-3 "
            )}
          >
            <motion.button
              layout
              onClick={
                isOpen
                  ? () => {
                      setSelectedItemId(null);
                    }
                  : () => {
                      setSelectedItemId(item.id);
                    }
              }
              key="collapse"
              className={cn(
                isOpen
                  ? "absolute right-3 top-3 z-10 "
                  : "relative z-10 ml-auto mr-3 "
              )}
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
                  <LuSettings2 className="stroke-1 h-5 w-5 text-foreground/80  hover:stroke-primary/70 " />
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
          <CardTitle>Bill of Material</CardTitle>
        </CardHeader>

        <CardAction>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              isDisabled={
                !permissions.can("update", "parts") || selectedItemId !== null
              }
              onClick={onAddItem}
            >
              Add Material
            </Button>
            {configurable && (
              <IconButton
                icon={<LuFunctionSquare />}
                aria-label="Configure"
                variant="ghost"
                className={cn(
                  rulesByField.has("billOfMaterial") &&
                    "text-emerald-500 hover:text-emerald-500"
                )}
                onClick={
                  configurable
                    ? () =>
                        onConfigure({
                          label: "Bill of Material",
                          field: "billOfMaterial",
                          code: rulesByField.get("billOfMaterial")?.code,
                          returnType: {
                            type: "list",
                            listOptions: materials.map(
                              (m) => m.data.itemReadableId!
                            ),
                          },
                        })
                    : undefined
                }
              />
            )}
          </div>
        </CardAction>
      </HStack>
      <CardContent>
        <SortableList
          items={materials}
          onReorder={onReorder}
          onToggleItem={onToggleItem}
          onRemoveItem={onRemoveItem}
          renderItem={renderListItem}
        />
      </CardContent>
      {configuratorDisclosure.isOpen && configuration && (
        <Configurator
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
  item,
  methodOperations,
  orderState,
  temporaryItems,
  rulesByField,
  onConfigure,
  setOrderState,
  setSelectedItemId,
  setTemporaryItems,
}: {
  configurable: boolean;
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
  const permissions = usePermissions();
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
    itemReadableId: string;
    methodType: MethodType;
    description: string;
    unitOfMeasureCode: string;
    quantity: number;
  }>({
    itemId: item.data.itemId ?? "",
    itemReadableId: item.data.itemReadableId ?? "",
    methodType: item.data.methodType ?? "Buy",
    description: item.data.description ?? "",
    unitOfMeasureCode: item.data.unitOfMeasureCode ?? "EA",
    quantity: item.data.quantity ?? 1,
  });

  const onTypeChange = (value: MethodItemType) => {
    if (value === itemType) return;
    setItemType(value);
    setItemData({
      itemId: "",
      itemReadableId: "",
      methodType: "" as "Buy",
      quantity: 1,
      description: "",
      unitOfMeasureCode: "EA",
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
      .select("name, readableId, unitOfMeasureCode, defaultMethodType")
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
      itemReadableId: item.data?.readableId ?? "",
      description: item.data?.name ?? "",
      unitOfMeasureCode: item.data?.unitOfMeasureCode ?? "EA",
      methodType: item.data?.defaultMethodType ?? "Buy",
    }));
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
      className="w-full"
      fetcher={methodMaterialFetcher}
      onSubmit={() => {
        if (!isTemporaryId(item.id)) {
          setSelectedItemId(null);
        }
      }}
    >
      <Hidden name="id" />
      <Hidden name="makeMethodId" />
      <Hidden name="itemReadableId" value={itemData.itemReadableId} />
      <Hidden name="order" />
      <VStack className="pt-4">
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
              configurable
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
            isReadOnly
            value={itemData.description}
            isConfigured={rulesByField.has(key("description"))}
            onConfigure={
              configurable
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
              configurable
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
              configurable
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
              configurable
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
          className="flex w-full items-center justify-end p-2"
          initial={{ opacity: 0, filter: "blur(4px)" }}
          animate={{ opacity: 1, filter: "blur(0px)" }}
          transition={{
            type: "spring",
            bounce: 0,
            duration: 0.55,
          }}
        >
          <motion.div layout className="ml-auto mr-1 pt-2">
            <Submit isDisabled={!permissions.can("update", "parts")}>
              Save
            </Submit>
          </motion.div>
        </motion.div>
      </VStack>
    </ValidatedForm>
  );
}

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
      <VStack spacing={0} className="py-2.5">
        <h3 className="font-semibold truncate">{material.itemReadableId}</h3>
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
        <Badge variant="secondary">
          <MethodIcon type={material.methodType} />
        </Badge>

        <Badge variant="secondary">{material.quantity}</Badge>
        <Badge variant="secondary">
          <MethodItemTypeIcon type={material.itemType} />
        </Badge>
      </HStack>
    ),
    data: {
      ...material,
      order,
    },
  };
}

function getFieldKey(field: string, materialId: string) {
  return `${field}:${materialId}`;
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
