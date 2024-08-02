"use client";
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
import { useUser } from "~/hooks";
import { useSupabase } from "~/lib/supabase";
import type { MethodItemType, MethodType } from "~/modules/shared";
import {
  MethodIcon,
  methodItemType,
  MethodItemTypeIcon,
} from "~/modules/shared";
import { path } from "~/utils/path";
import type { quoteOperationValidator } from "../../sales.models";
import { quoteMaterialValidator } from "../../sales.models";

type Material = z.infer<typeof quoteMaterialValidator>;

type Operation = z.infer<typeof quoteOperationValidator>;

type ItemWithData = SortableItem & {
  data: Material;
};

type QuoteBillOfMaterialProps = {
  quoteMakeMethodId: string;
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
      <VStack spacing={0}>
        <h4 className="font-mono">{material.itemReadableId}</h4>
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

const initialMethodMaterial: Omit<Material, "quoteMakeMethodId" | "order"> & {
  description: string;
} = {
  itemId: "",
  itemReadableId: "",
  itemType: "Part" as const,
  methodType: "Buy" as const,
  description: "",
  quantity: 1,
  unitCost: 0,
  unitOfMeasureCode: "EA",
};

const QuoteBillOfMaterial = ({
  quoteMakeMethodId,
  materials,
  operations,
}: QuoteBillOfMaterialProps) => {
  const { quoteId, lineId } = useParams();
  if (!quoteId) throw new Error("quoteId not found");
  if (!lineId) throw new Error("lineId not found");

  const fetcher = useFetcher<{}>();

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
          title: "",
          checked: false,
          id: temporaryId,
          data: {
            ...initialMethodMaterial,
            order: newOrder,
            quoteMakeMethodId,
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

    fetcher.submit(new FormData(), {
      method: "post",
      action: path.to.deleteQuoteMaterial(quoteId, lineId, item.id),
    });
  };

  const onReorder = (reorderedItems: ItemWithData[]) => {
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
      action: path.to.quoteMaterialsOrder,
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
                            quoteOperations={operations}
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

export default QuoteBillOfMaterial;

function isTemporaryId(id: string) {
  return id.length < 20;
}

function MaterialForm({
  item,
  setItems,
  setSelectedItemId,
  quoteOperations,
}: {
  item: ItemWithData;
  setItems: Dispatch<SetStateAction<ItemWithData[]>>;
  setSelectedItemId: Dispatch<SetStateAction<string | null>>;
  quoteOperations: Operation[];
}) {
  const { quoteId, lineId } = useParams();
  if (!quoteId) throw new Error("quoteId not found");
  if (!lineId) throw new Error("lineId not found");

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
    unitCost: number;
    unitOfMeasureCode: string;
    quantity: number;
  }>({
    itemId: item.data.itemId ?? "",
    itemReadableId: item.data.itemReadableId ?? "",
    methodType: item.data.methodType ?? "Buy",
    description: item.data.description ?? "",
    unitCost: item.data.unitCost ?? 0,
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
      unitCost: 0,
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

    const [item, itemCost] = await await Promise.all([
      supabase
        .from("item")
        .select("name, readableId, unitOfMeasureCode, defaultMethodType")
        .eq("id", itemId)
        .eq("companyId", company.id)
        .single(),
      supabase
        .from("itemCost")
        .select("unitCost")
        .eq("itemId", itemId)
        .single(),
    ]);

    if (item.error) {
      toast.error("Failed to load item details");
      return;
    }

    setItemData((d) => ({
      ...d,
      itemId,
      itemReadableId: item.data?.readableId ?? "",
      description: item.data?.name ?? "",
      unitCost: itemCost.data?.unitCost ?? 0,
      unitOfMeasureCode: item.data?.unitOfMeasureCode ?? "EA",
      methodType: item.data?.defaultMethodType ?? "Buy",
    }));
  };

  return (
    <ValidatedForm
      action={
        isTemporaryId(item.id)
          ? path.to.newQuoteMaterial(quoteId, lineId)
          : path.to.quoteMaterial(quoteId, lineId, item.id!)
      }
      method="post"
      defaultValues={item.data}
      validator={quoteMaterialValidator}
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
      <Hidden name="quoteMakeMethodId" />
      <Hidden name="itemReadableId" value={itemData.itemReadableId} />
      <Hidden name="order" />
      {itemData.methodType === "Make" && (
        <Hidden name="unitCost" value={itemData.unitCost} />
      )}
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
          <Select
            name="quoteOperationId"
            label="Operation"
            isClearable
            options={quoteOperations.map((o) => ({
              value: o.id!,
              label: o.description,
            }))}
          />
        </div>
        <InputControlled
          name="description"
          label="Description"
          value={itemData.description}
          onChange={(newValue) => {
            setItemData((d) => ({ ...d, description: newValue }));
          }}
        />
        <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
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
            />
          )}
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
