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
  cn,
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
  EquipmentType,
  Hidden,
  InputControlled,
  Number,
  NumberControlled,
  Select,
  StandardFactor,
  Submit,
  WorkCellType,
} from "~/components/Form";
import type { Item, SortableItemRenderProps } from "~/components/SortableList";
import { SortableList, SortableListItem } from "~/components/SortableList";
import { useSupabase } from "~/lib/supabase";
import { methodOperationOrders } from "~/modules/shared";
import { path } from "~/utils/path";
import { quoteOperationValidator } from "../../sales.models";

type Operation = z.infer<typeof quoteOperationValidator>;

type ItemWithData = Item & {
  data: Operation;
};

type QuoteBillOfProcessProps = {
  quoteMakeMethodId: string;
  operations: Operation[];
};

function makeItems(operations: Operation[]): ItemWithData[] {
  return operations.map(makeItem);
}

function makeItem(operation: Operation): ItemWithData {
  return {
    id: operation.id!,
    title: operation.description ?? "",
    checked: false,
    order: operation.operationOrder,
    details: (
      <HStack spacing={1}>
        <Badge variant="secondary">
          {operation.productionStandard} {operation.standardFactor}
        </Badge>
        <Badge variant="secondary">{operation.operationOrder}</Badge>
      </HStack>
    ),
    data: operation,
  };
}

const initialMethodOperation: Omit<Operation, "quoteMakeMethodId" | "order"> = {
  description: "",
  workCellTypeId: "",
  equipmentTypeId: "",
  setupHours: 0,
  productionStandard: 0,
  standardFactor: "Hours/Piece",
  operationOrder: "After Previous",
  quotingRate: 0,
  laborRate: 0,
  overheadRate: 0,
};

const QuoteBillOfProcess = ({
  quoteMakeMethodId,
  operations,
}: QuoteBillOfProcessProps) => {
  const { supabase } = useSupabase();
  const sortOrderFetcher = useFetcher<{}>();

  const [items, setItems] = useState<ItemWithData[]>(
    makeItems(operations ?? [])
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
            ...initialMethodOperation,
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

    const response = await supabase
      ?.from("methodOperation")
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
      action: path.to.quoteOperationsOrder,
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
      <SortableListItem<Operation>
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
              "flex h-full flex-col items-center justify-center gap-2 pl-2",
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
                        <div className="flex w-full flex-col pr-2 py-2">
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
                            <OperationForm
                              item={item}
                              setItems={setItems}
                              setSelectedItemId={setSelectedItemId}
                            />
                          </motion.div>
                        </div>
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
          <CardTitle>Bill of Process</CardTitle>
        </CardHeader>

        <CardAction>
          <Button
            variant="secondary"
            isDisabled={selectedItemId !== null}
            onClick={onAddItem}
          >
            Add Operation
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

export default QuoteBillOfProcess;

function isTemporaryId(id: string) {
  return id.length < 20;
}

function OperationForm({
  item,
  setItems,
  setSelectedItemId,
}: {
  item: ItemWithData;
  setItems: Dispatch<SetStateAction<ItemWithData[]>>;
  setSelectedItemId: Dispatch<SetStateAction<string | null>>;
}) {
  const { quoteId, lineId } = useParams();
  if (!quoteId) throw new Error("quoteId not found");
  if (!lineId) throw new Error("lineId not found");

  const methodOperationFetcher = useFetcher<{ id: string }>();
  const { supabase } = useSupabase();

  useEffect(() => {
    // replace the temporary id with the actual id
    if (methodOperationFetcher.data && methodOperationFetcher.data.id) {
      flushSync(() => {
        setItems((prevItems) =>
          prevItems.map((i) =>
            i.id === item.id
              ? {
                  ...i,
                  id: methodOperationFetcher.data!.id!,
                  data: {
                    ...i.data,
                    ...methodOperationFetcher.data,
                  },
                }
              : i
          )
        );
      });
      setSelectedItemId(null);
    }
  }, [item.id, methodOperationFetcher.data, setItems, setSelectedItemId]);

  const [workCellData, setWorkCellData] = useState<{
    workCellTypeId: string;
    description: string;
    standardFactor: string;
    quotingRate: number;
    laborRate: number;
    overheadRate: number;
  }>({
    workCellTypeId: item.data.workCellTypeId ?? "",
    description: item.data.description ?? "",
    standardFactor: item.data.standardFactor ?? "Hours/Piece",
    quotingRate: item.data.quotingRate ?? 0,
    laborRate: item.data.laborRate ?? 0,
    overheadRate: item.data.overheadRate ?? 0,
  });

  const onWorkCellChange = async (workCellTypeId: string) => {
    if (!supabase || !workCellTypeId) return;
    const { data, error } = await supabase
      .from("workCellType")
      .select("*")
      .eq("id", workCellTypeId)
      .single();

    if (error) throw new Error(error.message);

    setWorkCellData({
      workCellTypeId,
      description: data?.name ?? "",
      standardFactor: data?.defaultStandardFactor ?? "Hours/Piece",
      quotingRate: data?.quotingRate ?? 0,
      laborRate: data?.laborRate ?? 0,
      overheadRate: data?.overheadRate ?? 0,
    });
  };

  const [equipmentData, setEquipmentData] = useState<{
    equipmentTypeId: string;
    setupHours: number;
  }>({
    equipmentTypeId: item.data.equipmentTypeId ?? "",
    setupHours: item.data.setupHours ?? 0,
  });

  const onEquipmentChange = async (equipmentTypeId: string) => {
    if (!supabase || !equipmentTypeId) return;
    const { data, error } = await supabase
      .from("equipmentType")
      .select("*")
      .eq("id", equipmentTypeId)
      .single();

    if (error) throw new Error(error.message);

    setEquipmentData({
      equipmentTypeId,
      setupHours: data?.setupHours ?? 0,
    });
  };

  return (
    <ValidatedForm
      action={
        isTemporaryId(item.id)
          ? path.to.newQuoteOperation(quoteId, lineId)
          : path.to.quoteOperation(quoteId, lineId, item.id!)
      }
      method="post"
      defaultValues={item.data}
      validator={quoteOperationValidator}
      className="w-full flex flex-col gap-y-4"
      fetcher={methodOperationFetcher}
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
      <Hidden name="quoteMakeMethodId" />
      <Hidden name="order" />
      <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
        <WorkCellType
          name="workCellTypeId"
          label="Work Cell"
          onChange={(value) => {
            onWorkCellChange(value?.value as string);
          }}
        />
        <EquipmentType
          name="equipmentTypeId"
          label="Equipment"
          onChange={(value) => onEquipmentChange(value?.value as string)}
        />
        <Select
          name="operationOrder"
          label="Operation Order"
          placeholder="Operation Order"
          options={methodOperationOrders.map((o) => ({
            value: o,
            label: o,
          }))}
        />
      </div>
      <InputControlled
        name="description"
        label="Description"
        value={workCellData.description}
        onChange={(newValue) => {
          setWorkCellData((d) => ({ ...d, description: newValue }));
        }}
      />
      <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
        <NumberControlled
          name="setupHours"
          label="Setup Time (hours)"
          minValue={0}
          value={equipmentData.setupHours}
          onChange={(newValue) => {
            setEquipmentData((d) => ({ ...d, setupHours: newValue }));
          }}
        />
        <Number
          name="productionStandard"
          label="Production Standard"
          minValue={0}
        />
        <StandardFactor
          name="standardFactor"
          label="Standard Factor"
          value={workCellData.standardFactor}
          onChange={(newValue) => {
            setWorkCellData((d) => ({
              ...d,
              standardFactor: newValue?.value ?? "Hours/Piece",
            }));
          }}
        />
        <NumberControlled
          name="quotingRate"
          label="Quoting Rate"
          minValue={0}
          value={workCellData.quotingRate}
          onChange={(newValue) =>
            setWorkCellData((d) => ({
              ...d,
              quotingRate: newValue,
            }))
          }
        />
        <NumberControlled
          name="laborRate"
          label="Labor Rate"
          minValue={0}
          value={workCellData.laborRate}
          onChange={(newValue) =>
            setWorkCellData((d) => ({
              ...d,
              laborRate: newValue,
            }))
          }
        />
        <NumberControlled
          name="overheadRate"
          label="Overhead Rate"
          minValue={0}
          value={workCellData.overheadRate}
          onChange={(newValue) =>
            setWorkCellData((d) => ({
              ...d,
              overheadRate: newValue,
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
    </ValidatedForm>
  );
}
