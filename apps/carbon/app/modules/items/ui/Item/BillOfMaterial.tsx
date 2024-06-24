"use client";
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  VStack,
  cn,
  toast,
  useDebounce,
} from "@carbon/react";
import { ValidatedForm } from "@carbon/remix-validated-form";
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
import { useUser } from "~/hooks";
import { useSupabase } from "~/lib/supabase";
import { path } from "~/utils/path";
import { methodItemType, methodMaterialValidator } from "../../items.models";
import type { MethodItemType, MethodType } from "../../types";

type Material = z.infer<typeof methodMaterialValidator>;

type ItemWithData = SortableItem & {
  data: Material;
};

type BillOfMaterialProps = {
  makeMethodId: string;
  materials: Material[];
};

function makeItems(materials: Material[]): ItemWithData[] {
  return materials.map(makeItem);
}

function makeItem(material: Material): ItemWithData {
  return {
    id: material.id!,
    text: material.description ?? "",
    checked: false,
    data: material,
  };
}

const initialMethodMaterial: Omit<Material, "makeMethodId" | "order"> = {
  itemId: "",
  itemReadableId: "",
  itemType: "Part" as const,
  methodType: "Buy" as const,
  description: "",
  quantity: 1,
  unitOfMeasureCode: "EA",
};

const BillOfMaterial = ({ makeMethodId, materials }: BillOfMaterialProps) => {
  const { supabase } = useSupabase();
  const sortOrderFetcher = useFetcher();

  const [items, setItems] = useState<ItemWithData[]>(
    makeItems(materials ?? [])
  );
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  const onToggleItem = (id: string) => {
    setItems((prevItems) =>
      prevItems.map((item) =>
        item.id === id ? { ...item, checked: !item.checked } : item
      )
    );
  };

  // we create a temporary item and append it to the list
  const onAddItem = () => {
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
          text: "",
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
    // get the item and it's order in the list
    const itemIndex = items.findIndex((i) => i.id === id);
    const item = items[itemIndex];

    setItems((prevItems) => prevItems.filter((item) => item.id !== id));

    const response = await supabase
      ?.from("methodMaterial")
      .delete()
      .eq("id", id);
    if (response?.error) {
      // add the item back to the list if there was an error
      setItems((prevItems) => {
        const updatedItems = [...prevItems];
        updatedItems.splice(itemIndex, 0, item);
        return updatedItems;
      });
    }
  };

  const onReorder = (items: ItemWithData[]) => {
    const newItems = items.map((item, index) => ({
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

    setItems(newItems);
    updateSortOrder(updates);
  };

  const updateSortOrder = useDebounce((updates: Record<string, number>) => {
    let formData = new FormData();
    formData.append("updates", JSON.stringify(updates));
    sortOrderFetcher.submit(formData, {
      method: "post",
      action: path.to.methodMaterialsOrder(makeMethodId),
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
        onToggleItem={onToggleItem}
        onRemoveItem={onRemoveItem}
        handleDrag={onCloseOnDrag}
        className="my-2 "
        renderExtra={(item) => (
          <div
            key={`${isOpen}`}
            className={cn(
              "flex h-full w-full flex-col items-center justify-center gap-2 ",
              isOpen ? "py-1 px-1" : "py-3 "
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
          <CardTitle>Bill of Materials</CardTitle>
        </CardHeader>

        <CardAction>
          <Button
            variant="secondary"
            isDisabled={selectedItemId !== null}
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
}: {
  item: ItemWithData;
  setItems: Dispatch<SetStateAction<ItemWithData[]>>;
  setSelectedItemId: Dispatch<SetStateAction<string | null>>;
}) {
  const { supabase } = useSupabase();
  const methodMaterialFetcher = useFetcher<{ id: string }>();
  const params = useParams();
  const { company } = useUser();

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
          ? path.to.newMethodMaterial(item.data.makeMethodId!)
          : path.to.methodMaterial(item.data.makeMethodId, item.id!)
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
                  ...makeItem(values),
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
          <Select
            name="itemType"
            label="Type"
            options={methodItemType.map((value) => ({
              value,
              label: value,
            }))}
            onChange={(value) => {
              onTypeChange(value?.value as MethodItemType);
            }}
          />
          <Item
            disabledItems={[params.itemId!]}
            name="itemId"
            label={itemType}
            // @ts-ignore
            type={itemType}
            onChange={(value) => {
              onItemChange(value?.value as string);
            }}
          />
          <DefaultMethodType
            name="methodType"
            label="Method Type"
            value={itemData.methodType}
            replenishmentSystem="Buy and Make"
          />
          <InputControlled
            name="description"
            label="Description"
            value={itemData.description}
            onChange={(newValue) => {
              setItemData((d) => ({ ...d, description: newValue }));
            }}
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
            <Submit>Save</Submit>
          </motion.div>
        </motion.div>
      </VStack>
    </ValidatedForm>
  );
}
