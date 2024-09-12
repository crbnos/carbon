"use client";
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
  toast,
  useDebounce,
  VStack,
} from "@carbon/react";
import { useFetcher, useParams } from "@remix-run/react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { LuSettings2, LuX } from "react-icons/lu";
import type { z } from "zod";
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
import { useSupabase } from "~/lib/supabase";
import type { MethodItemType, MethodType } from "~/modules/shared";
import { MethodIcon, MethodItemTypeIcon } from "~/modules/shared";
import { path } from "~/utils/path";
import type { methodOperationValidator } from "../../items.models";
import { methodMaterialValidator } from "../../items.models";

type Material = z.infer<typeof methodMaterialValidator> & {
  description: string;
};

type Operation = z.infer<typeof methodOperationValidator>;

type ItemWithData = SortableItem & {
  data: Material;
};

type BillOfMaterialProps = {
  makeMethodId: string;
  materials: Material[];
  operations: Operation[];
};

function makeItems(materials: Material[]): ItemWithData[] {
  return materials.map(makeItem);
}

function makeItem(material: Material): ItemWithData {
  return {
    id: material.id!,
    title: (
      <VStack spacing={0} className="py-2.5">
        <h4 className="flex tracking-tighter text-base md:text-lg truncate">
          {material.itemReadableId}
        </h4>
        {material?.description && (
          <span className="text-xs text-muted-foreground">
            {material.description}{" "}
          </span>
        )}
      </VStack>
    ),
    checked: false,
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
    data: material,
  };
}

const initialMethodMaterial: Omit<Material, "makeMethodId" | "order"> & {
  description: string;
} = {
  itemId: "",
  itemReadableId: "",
  itemType: "Part" as const,
  methodType: "Buy" as const,
  description: "",
  quantity: 1,
  unitOfMeasureCode: "EA",
};

const BillOfMaterial = ({
  makeMethodId,
  materials,
  operations,
}: BillOfMaterialProps) => {
  const fetcher = useFetcher<{}>();
  const permissions = usePermissions();

  const [items, setItems] = useState<ItemWithData[]>(
    makeItems(materials ?? [])
  );
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  const onToggleItem = (id: string) => {
    if (!permissions.can("update", "parts")) return;
    setItems((prevItems) =>
      prevItems.map((item) =>
        item.id === id ? { ...item, checked: !item.checked } : item
      )
    );
  };

  // we create a temporary item and append it to the list
  const onAddItem = () => {
    if (!permissions.can("update", "parts")) return;
    const temporaryId = Math.random().toString(16).slice(2);
    setSelectedItemId(temporaryId);
    setItems((prevItems) => {
      let newOrder = 1;
      if (prevItems.length) {
        newOrder = prevItems[prevItems.length - 1].data.order + 1;
      }

      return [
        ...prevItems,
        {
          title: "",
          checked: false,
          id: temporaryId,
          data: {
            ...initialMethodMaterial,
            order: newOrder,
            makeMethodId,
          },
        },
      ];
    });
  };

  const onRemoveItem = async (id: string) => {
    if (!permissions.can("update", "parts")) return;
    // get the item and it's order in the list
    const itemIndex = items.findIndex((i) => i.id === id);
    const item = items[itemIndex];

    setItems((prevItems) => prevItems.filter((item) => item.id !== id));

    fetcher.submit(new FormData(), {
      method: "post",
      action: path.to.deleteMethodMaterial(item.id),
    });
  };

  const onReorder = (reorderedItems: ItemWithData[]) => {
    if (!permissions.can("update", "parts")) return;
    const newItems = reorderedItems.map((item, index) => ({
      ...item,
      data: {
        ...item.data,
        order: index + 1,
      },
    }));
    const updates = newItems.reduce<Record<string, number>>((acc, item) => {
      if (!isTemporaryId(item.id)) {
        acc[item.id] = item.data.order;
      }
      return acc;
    }, {});

    setItems(reorderedItems);
    updateSortOrder(updates);
  };

  const updateSortOrder = useDebounce((updates: Record<string, number>) => {
    let formData = new FormData();
    formData.append("updates", JSON.stringify(updates));
    fetcher.submit(formData, {
      method: "post",
      action: path.to.methodMaterialsOrder,
    });
  }, 1000);

  const onCloseOnDrag = useCallback(() => {
    setItems((prevItems) => {
      const updatedItems = prevItems.map((item) =>
        item.checked ? { ...item, checked: false } : item
      );
      return updatedItems.some(
        (item, index) => item.checked !== prevItems[index].checked
      )
        ? updatedItems
        : prevItems;
    });
  }, []);

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
                      if (isTemporaryId(item.id)) {
                        setItems((prevItems) =>
                          prevItems.filter((i) => i.id !== item.id)
                        );
                      }
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
                            item={item}
                            setItems={setItems}
                            setSelectedItemId={setSelectedItemId}
                            methodOperations={operations}
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
              !permissions.can("update", "parts") || selectedItemId !== null
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

export default BillOfMaterial;

function isTemporaryId(id: string) {
  return id.length < 20;
}

function MaterialForm({
  item,
  setItems,
  setSelectedItemId,
  methodOperations,
}: {
  item: ItemWithData;
  setItems: Dispatch<SetStateAction<ItemWithData[]>>;
  setSelectedItemId: Dispatch<SetStateAction<string | null>>;
  methodOperations: Operation[];
}) {
  const { supabase } = useSupabase();
  const methodMaterialFetcher = useFetcher<{ id: string }>();
  const params = useParams();
  const { company } = useUser();
  const permissions = usePermissions();

  useEffect(() => {
    // replace the temporary id with the actual id
    if (methodMaterialFetcher.data && methodMaterialFetcher.data.id) {
      flushSync(() => {
        setItems((prevItems) =>
          prevItems.map((i) =>
            i.id === item.id
              ? {
                  ...i,
                  id: methodMaterialFetcher.data!.id!,
                  data: {
                    ...i.data,
                    ...methodMaterialFetcher.data,
                  },
                }
              : i
          )
        );
      });
      setSelectedItemId(null);
    }
  }, [item.id, methodMaterialFetcher.data, setItems, setSelectedItemId]);

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
    if (!supabase) return;
    if (itemId === params.itemId) {
      toast.error("An item cannot be added to itself.");
      return;
    }

    const item = await supabase
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
      onSubmit={(values) => {
        setItems((prevItems) =>
          prevItems.map((i) =>
            i.id === item.id
              ? {
                  ...makeItem({ ...values, description: itemData.description }),
                  id: item.id,
                }
              : i
          )
        );
      }}
    >
      <Hidden name="makeMethodId" />
      <Hidden name="itemReadableId" value={itemData.itemReadableId} />
      <Hidden name="order" />
      <VStack className="pt-4">
        <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
          <Item
            disabledItems={[params.itemId!]}
            name="itemId"
            label={itemType}
            type={itemType}
            onChange={(value) => {
              onItemChange(value?.value as string);
            }}
            onTypeChange={onTypeChange}
          />
          <InputControlled
            name="description"
            label="Description"
            className="col-span-2"
            isReadOnly
            value={itemData.description}
            onChange={(newValue) => {
              setItemData((d) => ({ ...d, description: newValue }));
            }}
          />

          <DefaultMethodType
            name="methodType"
            label="Method Type"
            value={itemData.methodType}
            replenishmentSystem="Buy and Make"
          />
          <Number name="quantity" label="Quantity" />
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
          <Select
            name="methodOperationId"
            label="Operation"
            isOptional
            options={methodOperations.map((o) => ({
              value: o.id!,
              label: o.description,
            }))}
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
