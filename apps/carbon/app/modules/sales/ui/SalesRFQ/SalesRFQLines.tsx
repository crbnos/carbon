"use client";
import {
  Badge,
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
  useMount,
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
  ArrayNumeric,
  Hidden,
  Input,
  InputControlled,
  Item,
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
import { salesRfqLineValidator } from "../../sales.models";

type Line = z.infer<typeof salesRfqLineValidator>;

type ItemWithData = SortableItem & {
  data: Line;
};

type SalesRFQLinesProps = {
  lines: Line[];
};

function makeItems(lines: Line[]): ItemWithData[] {
  return lines.map(makeItem);
}

function makeItem(line: Line): ItemWithData {
  return {
    id: line.id!,
    title: (
      <VStack spacing={0}>
        <h4 className="font-mono">
          {line.customerPartNumber}{" "}
          {line.customerRevisionId && `(${line.customerRevisionId})`}
        </h4>
        {line?.description && (
          <span className="text-xs text-muted-foreground">
            {line.description}{" "}
          </span>
        )}
      </VStack>
    ),
    checked: false,
    details: (
      <HStack spacing={2}>
        {line.quantity.map((q, i) => (
          <Badge key={i} variant="secondary">
            {q}
          </Badge>
        ))}
      </HStack>
    ),
    data: line,
  };
}

const initialMethodLine: Omit<Line, "salesRfqId" | "order"> = {
  customerPartNumber: "",
  customerRevisionId: "",
  itemId: "",
  description: "",
  quantity: [1],
  unitOfMeasureCode: "EA",
};

const SalesRFQLines = ({ lines }: SalesRFQLinesProps) => {
  const { rfqId } = useParams();
  if (!rfqId) throw new Error("rfqId not found");

  const fetcher = useFetcher();

  const [items, setItems] = useState<ItemWithData[]>(makeItems(lines ?? []));
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  const onToggleItem = (id: string) => {
    setItems((prevItems) =>
      prevItems.map((item) =>
        item.id === id ? { ...item, checked: !item.checked } : item
      )
    );
  };

  useMount(() => {
    if (lines.length === 0 && !selectedItemId) {
      onAddItem();
    }
  });

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
            ...initialMethodLine,
            order: newOrder,
            salesRfqId: rfqId,
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
      action: path.to.deleteSalesRfqLine(rfqId, item.id),
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
      action: path.to.salesRfqLinesOrder(rfqId),
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
      <SortableListItem<Line>
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
                          <SalesRFQLineForm
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
          <CardTitle>Lines</CardTitle>
        </CardHeader>

        <CardAction>
          <Button
            variant="secondary"
            isDisabled={selectedItemId !== null}
            onClick={onAddItem}
          >
            Add Line
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

export default SalesRFQLines;

function isTemporaryId(id: string) {
  return id.length < 20;
}

function SalesRFQLineForm({
  item,
  setItems,
  setSelectedItemId,
}: {
  item: ItemWithData;
  setItems: Dispatch<SetStateAction<ItemWithData[]>>;
  setSelectedItemId: Dispatch<SetStateAction<string | null>>;
}) {
  const { supabase } = useSupabase();
  const salesRfqLineFetcher = useFetcher<{ id: string }>();

  const { company } = useUser();

  useEffect(() => {
    // replace the temporary id with the actual id
    if (salesRfqLineFetcher.data && salesRfqLineFetcher.data.id) {
      flushSync(() => {
        setItems((prevItems) =>
          prevItems.map((i) =>
            i.id === item.id
              ? {
                  ...i,
                  id: salesRfqLineFetcher.data!.id!,
                  data: {
                    ...i.data,
                    ...salesRfqLineFetcher.data,
                  },
                }
              : i
          )
        );
      });
      setSelectedItemId(null);
    }
  }, [item.id, salesRfqLineFetcher.data, setItems, setSelectedItemId]);

  const [itemData, setItemData] = useState<{
    itemId: string;
    description: string;
    unitOfMeasureCode: string;
  }>({
    itemId: item.data.itemId ?? "",
    description: item.data.description ?? "",
    unitOfMeasureCode: item.data.unitOfMeasureCode ?? "EA",
  });

  const onItemChange = async (itemId: string) => {
    if (!supabase) return;

    const item = await supabase
      .from("item")
      .select("name, unitOfMeasureCode")
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
    }));
  };

  return (
    <ValidatedForm
      action={
        isTemporaryId(item.id)
          ? path.to.newSalesRFQLine(item.data.salesRfqId!)
          : path.to.salesRfqLine(item.data.salesRfqId, item.id!)
      }
      method="post"
      defaultValues={item.data}
      validator={salesRfqLineValidator}
      className="w-full"
      fetcher={salesRfqLineFetcher}
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
      <Hidden name="salesRfqId" />
      <Hidden name="order" />
      <VStack className="pt-4">
        <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
          <Input
            name="customerPartNumber"
            label="Customer Part Number"
            autoFocus
          />
          <Input name="customerRevisionId" label="Customer Revision" />
          <Item
            name="itemId"
            label="Part"
            type="Part"
            onChange={(value) => {
              onItemChange(value?.value as string);
            }}
          />
          <InputControlled
            name="description"
            label="Description"
            value={itemData.description}
            onChange={(newValue) => {
              setItemData((d) => ({ ...d, description: newValue }));
            }}
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
          />
          <ArrayNumeric name="quantity" label="Quantity" />
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
