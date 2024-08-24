"use client";
import type { JSONContent } from "@carbon/react";
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  Editor,
  Enumerable,
  HStack,
  cn,
  generateHTML,
  useDebounce,
  useThrottle,
} from "@carbon/react";
import { ValidatedForm } from "@carbon/remix-validated-form";
import { getLocalTimeZone, today } from "@internationalized/date";
import { useFetcher } from "@remix-run/react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { nanoid } from "nanoid";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { LuSettings2, LuX } from "react-icons/lu";
import type { z } from "zod";
import { DirectionAwareTabs } from "~/components/DirectionAwareTabs";
import {
  Hidden,
  InputControlled,
  Number,
  Process,
  Select,
  SelectControlled,
  StandardFactor,
  Submit,
  SupplierProcess,
  UnitHint,
  WorkCenter,
  getUnitHint,
} from "~/components/Form";
import type { Item, SortableItemRenderProps } from "~/components/SortableList";
import { SortableList, SortableListItem } from "~/components/SortableList";
import { usePermissions, useUser } from "~/hooks";
import { useSupabase } from "~/lib/supabase";
import {
  TimeTypeIcon,
  methodOperationOrders,
  operationTypes,
} from "~/modules/shared";
import { path } from "~/utils/path";
import { methodOperationValidator } from "../../items.models";

type Operation = z.infer<typeof methodOperationValidator> & {
  methodOperationWorkInstruction: {
    content: JSONContent | null;
  };
};

type ItemWithData = Item & {
  data: Operation;
};

type BillOfProcessProps = {
  makeMethodId: string;
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
        {operation.operationType === "Outside" ? (
          <Enumerable value="Outside" />
        ) : (
          <>
            {(operation?.laborTime ?? 0) > 0 && (
              <Badge variant="secondary">
                <TimeTypeIcon type="Labor" className="h-3 w-3 mr-1" />
                {operation.laborTime} {operation.laborUnit}
              </Badge>
            )}

            {(operation?.machineTime ?? 0) > 0 && (
              <Badge variant="secondary">
                <TimeTypeIcon type="Machine" className="h-3 w-3 mr-1" />
                {operation.machineTime} {operation.machineUnit}
              </Badge>
            )}
          </>
        )}
      </HStack>
    ),
    data: operation,
  };
}

const initialOperation: Omit<Operation, "makeMethodId" | "order"> = {
  description: "",
  laborTime: 0,
  laborUnit: "Minutes/Piece",
  machineTime: 0,
  machineUnit: "Minutes/Piece",
  operationOrder: "After Previous",
  operationType: "Inside",
  processId: "",
  setupTime: 0,
  setupUnit: "Total Minutes",
  workCenterId: "",
  methodOperationWorkInstruction: {
    content: {},
  },
};

const BillOfProcess = ({ makeMethodId, operations }: BillOfProcessProps) => {
  const permissions = usePermissions();
  const { supabase } = useSupabase();
  const sortOrderFetcher = useFetcher<{}>();
  const {
    id: userId,
    company: { id: companyId },
  } = useUser();

  const [items, setItems] = useState<ItemWithData[]>(
    makeItems(operations ?? [])
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
            ...initialOperation,
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
    if (!permissions.can("update", "parts")) return;
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
      action: path.to.methodOperationsOrder,
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

  const onUpdateWorkInstruction = useThrottle(async (content: JSONContent) => {
    if (!permissions.can("update", "parts")) return;
    setItems((prevItems) =>
      prevItems.map((item) =>
        item.id === selectedItemId
          ? {
              ...item,
              data: {
                ...item.data,
                methodOperationWorkInstruction: {
                  content,
                },
              },
            }
          : item
      )
    );
    await supabase
      ?.from("methodOperationWorkInstruction")
      .update({
        content,
        updatedAt: today(getLocalTimeZone()).toString(),
        updatedBy: userId,
      })
      .eq("methodOperationId", selectedItemId!);
  }, 2000);

  const onUploadImage = async (file: File) => {
    const fileType = file.name.split(".").pop();
    const fileName = `${companyId}/parts/${selectedItemId}/${nanoid()}.${fileType}`;
    const result = await supabase?.storage
      .from("private")
      .upload(fileName, file);

    if (result?.error) {
      throw new Error(result.error.message);
    }

    if (!result?.data) {
      throw new Error("Failed to upload image");
    }

    return `/file/preview/private/${result.data.path}`;
  };

  const [tabChangeRerender, setTabChangeRerender] = useState<number>(1);
  const renderListItem = ({
    item,
    items,
    order,
    onToggleItem,
    onRemoveItem,
  }: SortableItemRenderProps<ItemWithData>) => {
    const isOpen = item.id === selectedItemId;

    const tabs = [
      {
        id: 0,
        label: "Details",
        content: (
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
        ),
      },
      {
        id: 1,
        label: "Work Instructions",
        disabled: isTemporaryId(item.id),
        content: (
          <div className="flex flex-col">
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
              {permissions.can("update", "parts") ? (
                <Editor
                  initialValue={
                    item.data.methodOperationWorkInstruction?.content ??
                    ({} as JSONContent)
                  }
                  onUpload={onUploadImage}
                  onChange={onUpdateWorkInstruction}
                />
              ) : (
                <div
                  className="prose dark:prose-invert"
                  dangerouslySetInnerHTML={{
                    __html: generateHTML(
                      item.data.methodOperationWorkInstruction?.content ??
                        ({} as JSONContent)
                    ),
                  }}
                />
              )}
            </motion.div>
          </div>
        ),
      },
    ];

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
                        <DirectionAwareTabs
                          className="mr-auto"
                          tabs={tabs}
                          onChange={() =>
                            setTabChangeRerender(tabChangeRerender + 1)
                          }
                        />
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
            isDisabled={
              !permissions.can("update", "parts") || selectedItemId !== null
            }
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

export default BillOfProcess;

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
  const methodOperationFetcher = useFetcher<{ id: string }>();
  const { supabase } = useSupabase();
  const permissions = usePermissions();

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

  const [processData, setProcessData] = useState<{
    description: string;
    laborUnit: string;
    laborUnitHint: string;
    machineUnit: string;
    machineUnitHint: string;
    operationType: string;
    processId: string;
    setupUnit: string;
    setupUnitHint: string;
  }>({
    description: item.data.description ?? "",
    laborUnit: item.data.laborUnit ?? "Hours/Piece",
    laborUnitHint: getUnitHint(item.data.laborUnit),
    machineUnit: item.data.machineUnit ?? "Hours/Piece",
    machineUnitHint: getUnitHint(item.data.machineUnit),
    operationType: item.data.operationType ?? "Inside",
    processId: item.data.processId ?? "",
    setupUnit: item.data.setupUnit ?? "Total Minutes",
    setupUnitHint: getUnitHint(item.data.setupUnit),
  });

  const onProcessChange = async (processId: string) => {
    if (!supabase || !processId) return;
    const { data, error } = await supabase
      .from("process")
      .select("*")
      .eq("id", processId)
      .single();

    if (error) throw new Error(error.message);

    setProcessData((p) => ({
      ...p,
      processId,
      description: data?.name ?? "",
      laborUnit: data?.defaultStandardFactor ?? "Hours/Piece",
      laborUnitHint: getUnitHint(data?.defaultStandardFactor),
      machineUnit: data?.defaultStandardFactor ?? "Hours/Piece",
      machineUnitHint: getUnitHint(data?.defaultStandardFactor),
      operationType: data?.processType === "Outside" ? "Outside" : "Inside",
    }));
  };

  const onWorkCenterChange = async (workCenterId: string) => {
    if (!supabase || !workCenterId) return;
    const { data, error } = await supabase
      .from("workCenter")
      .select("*")
      .eq("id", workCenterId)
      .single();

    if (error) throw new Error(error.message);

    setProcessData((p) => ({
      ...p,
      laborUnit: data?.defaultStandardFactor ?? "Hours/Piece",
      laborUnitHint: getUnitHint(data?.defaultStandardFactor),
      machineUnit: data?.defaultStandardFactor ?? "Hours/Piece",
      machineUnitHint: getUnitHint(data?.defaultStandardFactor),
    }));
  };

  return (
    <ValidatedForm
      action={
        isTemporaryId(item.id)
          ? path.to.newMethodOperation
          : path.to.methodOperation(item.id!)
      }
      method="post"
      defaultValues={item.data}
      validator={methodOperationValidator}
      className="w-full flex flex-col gap-y-4"
      fetcher={methodOperationFetcher}
      onSubmit={(values) => {
        setItems((prevItems) =>
          prevItems.map((i) =>
            i.id === item.id
              ? {
                  ...makeItem({
                    ...values,
                    methodOperationWorkInstruction: {
                      content: i.data.methodOperationWorkInstruction?.content,
                    },
                  }),
                  id: item.id,
                }
              : i
          )
        );
      }}
    >
      <Hidden name="makeMethodId" />
      <Hidden name="order" />
      <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
        <Process
          name="processId"
          label="Process"
          onChange={(value) => {
            onProcessChange(value?.value as string);
          }}
        />

        <Select
          name="operationOrder"
          label="Operation Order"
          placeholder="Operation Order"
          options={methodOperationOrders.map((o) => ({
            value: o,
            label: o,
          }))}
          onChange={(value) => {
            setProcessData((d) => ({
              ...d,
              operationOrder: value?.value as string,
            }));
          }}
        />

        <SelectControlled
          name="operationType"
          label="Operation Type"
          placeholder="Operation Type"
          options={operationTypes.map((o) => ({
            value: o,
            label: o,
          }))}
          value={processData.operationType}
          onChange={(value) => {
            setProcessData((d) => ({
              ...d,

              setupUnit: "Total Minutes",
              laborUnit: "Minutes/Piece",
              machineUnit: "Minutes/Piece",
              operationType: value?.value as string,
            }));
          }}
        />

        <InputControlled
          name="description"
          label="Description"
          value={processData.description}
          onChange={(newValue) => {
            setProcessData((d) => ({ ...d, description: newValue }));
          }}
          className="col-span-2"
        />

        {processData.operationType === "Outside" ? (
          <>
            <SupplierProcess
              name="operationSupplierProcessId"
              label="Supplier"
              processId={processData.processId}
              isOptional
            />
          </>
        ) : (
          <>
            <WorkCenter
              name="workCenterId"
              label="Work Center"
              isOptional
              processId={processData.processId}
              onChange={(value) => {
                if (value) {
                  onWorkCenterChange(value?.value as string);
                }
              }}
            />
            <UnitHint
              name="setupHint"
              label="Setup"
              value={processData.setupUnitHint}
              onChange={(hint) => {
                setProcessData((d) => ({
                  ...d,
                  setupUnitHint: hint,
                  setupUnit:
                    hint === "Fixed" ? "Total Minutes" : "Minutes/Piece",
                }));
              }}
            />
            <Number name="setupTime" label="Setup Time" minValue={0} />
            <StandardFactor
              name="setupUnit"
              label="Setup Unit"
              hint={processData.setupUnitHint}
              value={processData.setupUnit}
              onChange={(newValue) => {
                setProcessData((d) => ({
                  ...d,
                  setupUnit: newValue?.value ?? "Total Minutes",
                }));
              }}
            />
            <UnitHint
              name="laborHint"
              label="Labor"
              value={processData.laborUnitHint}
              onChange={(hint) => {
                setProcessData((d) => ({
                  ...d,
                  laborUnitHint: hint,
                  laborUnit:
                    hint === "Fixed" ? "Total Minutes" : "Minutes/Piece",
                }));
              }}
            />
            <Number name="laborTime" label="Labor Time" minValue={0} />
            <StandardFactor
              name="laborUnit"
              label="Labor Unit"
              hint={processData.laborUnitHint}
              value={processData.laborUnit}
              onChange={(newValue) => {
                setProcessData((d) => ({
                  ...d,
                  laborUnit: newValue?.value ?? "Hours/Piece",
                }));
              }}
            />
            <UnitHint
              name="machineHint"
              label="Machine"
              value={processData.machineUnitHint}
              onChange={(hint) => {
                setProcessData((d) => ({
                  ...d,
                  machineUnitHint: hint,
                  machineUnit:
                    hint === "Fixed" ? "Total Minutes" : "Minutes/Piece",
                }));
              }}
            />
            <Number name="machineTime" label="Machine Time" minValue={0} />
            <StandardFactor
              name="machineUnit"
              label="Machine Unit"
              hint={processData.machineUnitHint}
              value={processData.machineUnit}
              onChange={(newValue) => {
                setProcessData((d) => ({
                  ...d,
                  machineUnit: newValue?.value ?? "Hours/Piece",
                }));
              }}
            />
          </>
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
          <Submit isDisabled={!permissions.can("update", "parts")}>Save</Submit>
        </motion.div>
      </motion.div>
    </ValidatedForm>
  );
}
