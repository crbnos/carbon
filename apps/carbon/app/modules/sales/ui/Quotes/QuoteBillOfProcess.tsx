"use client";
import { useCarbon } from "@carbon/auth";
import { ValidatedForm } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Editor,
  HStack,
  IconButton,
  Label,
  VStack,
  cn,
  generateHTML,
  useDebounce,
  useDisclosure,
} from "@carbon/react";
import { formatRelativeTime } from "@carbon/utils";
import { getLocalTimeZone, today } from "@internationalized/date";
import { useFetcher, useParams } from "@remix-run/react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { nanoid } from "nanoid";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  LuAlertTriangle,
  LuChevronDown,
  LuDollarSign,
  LuHammer,
  LuMoreVertical,
  LuPlusCircle,
  LuSettings2,
  LuX,
} from "react-icons/lu";
import type { z } from "zod";
import { DirectionAwareTabs, EmployeeAvatar, TimeTypeIcon } from "~/components";
import {
  Hidden,
  InputControlled,
  Number,
  NumberControlled,
  Process,
  Select,
  SelectControlled,
  StandardFactor,
  Submit,
  SupplierProcess,
  Tool,
  UnitHint,
  WorkCenter,
  getUnitHint,
} from "~/components/Form";
import { ConfirmDelete } from "~/components/Modals";
import type { Item, SortableItemRenderProps } from "~/components/SortableList";
import { SortableList, SortableListItem } from "~/components/SortableList";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import type { OperationTool } from "~/modules/shared";
import {
  methodOperationOrders,
  operationToolValidator,
  operationTypes,
} from "~/modules/shared";
import type { action as editQuoteOperationToolAction } from "~/routes/x+/quote+/methods+/operation.tool.$id";
import type { action as newQuoteOperationToolAction } from "~/routes/x+/quote+/methods+/operation.tool.new";
import { useTools } from "~/stores";
import { getPrivateUrl, path } from "~/utils/path";
import { quoteOperationValidator } from "../../sales.models";
import type { Quotation } from "../../types";

type Operation = z.infer<typeof quoteOperationValidator> & {
  workInstruction: JSONContent | null;
};

type ItemWithData = Item & {
  data: Operation;
};

type QuoteBillOfProcessProps = {
  quoteMakeMethodId: string;
  operations: (Operation & {
    quoteOperationTool: OperationTool[];
  })[];
};

function makeItems(operations: Operation[]): ItemWithData[] {
  return operations.map(makeItem);
}

function makeItem(operation: Operation): ItemWithData {
  return {
    id: operation.id!,
    title: (
      <h4 className="flex text-xs font-bold uppercase tracking-tighter md:text-sm truncate">
        {operation.description}
      </h4>
    ),
    checked: false,
    order: operation.operationOrder,
    details: (
      <HStack spacing={1}>
        {operation.operationType === "Outside" ? (
          <Badge>Outside</Badge>
        ) : (
          <>
            {(operation?.setupTime ?? 0) > 0 && (
              <Badge variant="secondary">
                <TimeTypeIcon type="Setup" className="h-3 w-3 mr-1" />
                {operation.setupTime} {operation.setupUnit}
              </Badge>
            )}
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

const initialOperation: Omit<
  Operation,
  "quoteMakeMethodId" | "order" | "quoteOperationTool"
> = {
  description: "",
  laborRate: 0,
  laborTime: 0,
  laborUnit: "Minutes/Piece",
  machineRate: 0,
  machineTime: 0,
  machineUnit: "Minutes/Piece",
  operationUnitCost: 0,
  operationLeadTime: 0,
  operationOrder: "After Previous",
  operationType: "Inside",
  overheadRate: 0,
  processId: "",
  setupTime: 0,
  setupUnit: "Total Minutes",
  workCenterId: "",
  workInstruction: {},
};

const QuoteBillOfProcess = ({
  quoteMakeMethodId,
  operations,
}: QuoteBillOfProcessProps) => {
  const { carbon } = useCarbon();
  const sortOrderFetcher = useFetcher<{}>();
  const permissions = usePermissions();
  const {
    id: userId,
    company: { id: companyId },
  } = useUser();

  const [items, setItems] = useState<ItemWithData[]>(
    makeItems(operations ?? [])
  );
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  const { quoteId } = useParams();
  if (!quoteId) throw new Error("quoteId not found");
  const quoteData = useRouteData<{ quote: Quotation }>(path.to.quote(quoteId));

  const isDisabled = quoteData?.quote?.status !== "Draft";

  const onToggleItem = (id: string) => {
    if (!permissions.can("update", "sales") || isDisabled) return;
    setItems((prevItems) =>
      prevItems.map((i) => (i.id === id ? { ...i, checked: !i.checked } : i))
    );
  };

  // we create a temporary item and append it to the list
  const onAddItem = () => {
    if (!permissions.can("update", "sales") || isDisabled) return;
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
            quoteMakeMethodId,
          },
        },
      ];
    });
  };

  const onRemoveItem = async (id: string) => {
    if (!permissions.can("update", "sales") || isDisabled) return;
    // get the item and it's order in the list
    const itemIndex = items.findIndex((i) => i.id === id);
    const item = items[itemIndex];

    setItems((prevItems) => prevItems.filter((item) => item.id !== id));

    const response = await carbon?.from("quoteOperation").delete().eq("id", id);
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
    if (!permissions.can("update", "sales") || isDisabled) return;
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

  const updateSortOrder = useDebounce(
    (updates: Record<string, number>) => {
      let formData = new FormData();
      formData.append("updates", JSON.stringify(updates));
      sortOrderFetcher.submit(formData, {
        method: "post",
        action: path.to.quoteOperationsOrder,
      });
    },
    1000,
    true
  );

  const onCloseOnDrag = useCallback(() => {
    setItems((prevItems) => {
      const updatedItems = prevItems.map((i) =>
        i.checked ? { ...i, checked: false } : i
      );
      return updatedItems.some(
        (i, index) => i.checked !== prevItems[index].checked
      )
        ? updatedItems
        : prevItems;
    });
  }, []);

  const onUpdateWorkInstruction = useDebounce(
    async (content: JSONContent) => {
      if (selectedItemId !== null && !isTemporaryId(selectedItemId))
        await carbon
          ?.from("quoteOperation")
          .update({
            workInstruction: content,
            updatedAt: today(getLocalTimeZone()).toString(),
            updatedBy: userId,
          })
          .eq("id", selectedItemId!);
    },
    2500,
    true
  );

  const onUploadImage = async (file: File) => {
    const fileType = file.name.split(".").pop();
    const fileName = `${companyId}/parts/${selectedItemId}/${nanoid()}.${fileType}`;
    const result = await carbon?.storage
      .from("private")
      .upload(fileName, file, { upsert: true });

    if (result?.error) {
      throw new Error(result.error.message);
    }

    if (!result?.data) {
      throw new Error("Failed to upload image");
    }

    return getPrivateUrl(result.data.path);
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
                isDisabled={isDisabled}
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
        content: (
          <div className="flex flex-col">
            <div>
              {permissions.can("update", "parts") ? (
                <Editor
                  initialValue={
                    item.data.workInstruction ?? ({} as JSONContent)
                  }
                  onUpload={onUploadImage}
                  onChange={(content) => {
                    if (!permissions.can("update", "parts")) return;
                    setItems((prevItems) =>
                      prevItems.map((i) =>
                        i.id === selectedItemId
                          ? {
                              ...i,
                              data: {
                                ...i.data,
                                workInstruction: content,
                              },
                            }
                          : i
                      )
                    );
                    onUpdateWorkInstruction(content);
                  }}
                  className="py-8"
                />
              ) : (
                <div
                  className="prose dark:prose-invert"
                  dangerouslySetInnerHTML={{
                    __html: generateHTML(
                      item.data.workInstruction ?? ({} as JSONContent)
                    ),
                  }}
                />
              )}
            </div>
          </div>
        ),
      },
      {
        id: 2,
        label: "Tools",
        content: (
          <div className="flex w-full flex-col py-4">
            <ToolsForm
              tools={
                operations.find((o) => o.id === item.id)?.quoteOperationTool ??
                []
              }
              operationId={item.id!}
              isDisabled={
                selectedItemId === null || isTemporaryId(selectedItemId!)
              }
            />
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
        onSelectItem={setSelectedItemId}
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
              !permissions.can("update", "sales") ||
              selectedItemId !== null ||
              isDisabled
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

export default QuoteBillOfProcess;

function isTemporaryId(id: string) {
  return id.length < 20;
}

function OperationForm({
  item,
  isDisabled,
  setItems,
  setSelectedItemId,
}: {
  item: ItemWithData;
  isDisabled: boolean;
  setItems: Dispatch<SetStateAction<ItemWithData[]>>;
  setSelectedItemId: Dispatch<SetStateAction<string | null>>;
}) {
  const { quoteId, lineId } = useParams();
  const { id: userId, company } = useUser();
  if (!quoteId) throw new Error("quoteId not found");
  if (!lineId) throw new Error("lineId not found");

  const fetcher = useFetcher<{ id: string }>();
  const { carbon } = useCarbon();

  const baseCurrency = company?.baseCurrencyCode ?? "USD";

  useEffect(() => {
    // replace the temporary id with the actual id
    if (fetcher.data && fetcher.data.id) {
      flushSync(() => {
        setItems((prevItems) =>
          prevItems.map((i) =>
            i.id === item.id
              ? {
                  ...i,
                  id: fetcher.data!.id!,
                  data: {
                    ...i.data,
                    ...fetcher.data,
                  },
                }
              : i
          )
        );
      });

      // save the work instructions
      if (isTemporaryId(item.id) && carbon) {
        carbon
          .from("quoteOperation")
          .update({
            workInstruction: item.data.workInstruction,
            createdAt: today(getLocalTimeZone()).toString(),
            updatedBy: userId,
          })
          .eq("quoteOperationId", fetcher.data.id)
          .then(() => {
            setSelectedItemId(null);
          });
      } else {
        setSelectedItemId(null);
      }
    }
  }, [
    item.id,
    fetcher.data,
    setItems,
    setSelectedItemId,
    item.data.workInstruction,
    carbon,
    userId,
  ]);

  const [showMachine, setShowMachine] = useState(false);
  const [showLabor, setShowLabor] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [showCost, setShowCost] = useState(false);

  const [processData, setProcessData] = useState<{
    description: string;
    laborRate: number;
    laborTime: number;
    laborUnit: string;
    laborUnitHint: string;
    machineRate: number;
    machineTime: number;
    machineUnit: string;
    machineUnitHint: string;
    operationMinimumCost: number;
    operationLeadTime: number;
    operationType: string;
    operationUnitCost: number;
    overheadRate: number;
    processId: string;
    setupTime: number;
    setupUnit: string;
    setupUnitHint: string;
  }>({
    description: item.data.description ?? "",
    laborRate: item.data.laborRate ?? 0,
    laborTime: item.data.laborTime ?? 0,
    laborUnit: item.data.laborUnit ?? "Hours/Piece",
    laborUnitHint: getUnitHint(item.data.laborUnit),
    machineRate: item.data.machineRate ?? 0,
    machineTime: item.data.machineTime ?? 0,
    machineUnit: item.data.machineUnit ?? "Hours/Piece",
    machineUnitHint: getUnitHint(item.data.machineUnit),
    operationMinimumCost: item.data.operationMinimumCost ?? 0,
    operationLeadTime: item.data.operationLeadTime ?? 0,
    operationType: item.data.operationType ?? "Inside",
    operationUnitCost: item.data.operationUnitCost ?? 0,
    overheadRate: item.data.overheadRate ?? 0,
    processId: item.data.processId ?? "",
    setupTime: item.data.setupTime ?? 0,
    setupUnit: item.data.setupUnit ?? "Total Minutes",
    setupUnitHint: getUnitHint(item.data.setupUnit),
  });

  const onProcessChange = async (processId: string) => {
    if (!carbon || !processId) return;
    const [process, workCenters, supplierProcesses] = await Promise.all([
      carbon.from("process").select("*").eq("id", processId).single(),
      carbon
        .from("workCenterProcess")
        .select("workCenter(*)")
        .eq("processId", processId)
        .eq("workCenter.active", true),
      carbon.from("supplierProcess").select("*").eq("processId", processId),
    ]);

    const activeWorkCenters =
      workCenters?.data?.filter((wc) => Boolean(wc.workCenter)) ?? [];

    if (process.error) throw new Error(process.error.message);

    setProcessData((p) => ({
      ...p,
      processId,
      description: process.data?.name ?? "",
      laborUnit: process.data?.defaultStandardFactor ?? "Hours/Piece",
      laborUnitHint: getUnitHint(process.data?.defaultStandardFactor),
      laborRate:
        // get the average labor rate from the work centers
        activeWorkCenters.length
          ? activeWorkCenters.reduce((acc, workCenter) => {
              return (acc += workCenter.workCenter?.laborRate ?? 0);
            }, 0) / activeWorkCenters.length
          : p.laborRate,
      machineUnit: process.data?.defaultStandardFactor ?? "Hours/Piece",
      machineUnitHint: getUnitHint(process.data?.defaultStandardFactor),
      machineRate:
        // get the average labor rate from the work centers
        activeWorkCenters.length
          ? activeWorkCenters.reduce((acc, workCenter) => {
              return (acc += workCenter.workCenter?.machineRate ?? 0);
            }, 0) / activeWorkCenters.length
          : p.machineRate,
      // get the average quoting rate from the work centers
      overheadRate: activeWorkCenters.length
        ? activeWorkCenters?.reduce((acc, workCenter) => {
            return (acc += workCenter.workCenter?.overheadRate ?? 0);
          }, 0) / activeWorkCenters.length
        : p.overheadRate,
      operationMinimumCost:
        supplierProcesses.data && supplierProcesses.data.length > 0
          ? supplierProcesses.data.reduce((acc, sp) => {
              return (acc += sp.minimumCost ?? 0);
            }, 0) / supplierProcesses.data.length
          : p.operationMinimumCost,
      operationUnitCost:
        supplierProcesses.data && supplierProcesses.data.length > 0
          ? supplierProcesses.data.reduce((acc, sp) => {
              return (acc += sp.unitCost ?? 0);
            }, 0) / supplierProcesses.data.length
          : p.operationUnitCost,
      operationLeadTime:
        supplierProcesses.data && supplierProcesses.data.length > 0
          ? supplierProcesses.data.reduce((acc, sp) => {
              return (acc += sp.leadTime ?? 0);
            }, 0) / supplierProcesses.data.length
          : p.operationLeadTime,
      operationType:
        process.data?.processType === "Outside" ? "Outside" : "Inside",
    }));
  };

  const onWorkCenterChange = async (workCenterId: string | null) => {
    if (!carbon) return;
    if (!workCenterId) {
      // get the average costs
      await onProcessChange(processData.processId);
      return;
    }

    const { data, error } = await carbon
      .from("workCenter")
      .select("*")
      .eq("id", workCenterId)
      .single();

    if (error) throw new Error(error.message);

    setProcessData((d) => ({
      ...d,
      laborRate: data?.laborRate ?? 0,
      laborUnit: data?.defaultStandardFactor ?? "Hours/Piece",
      laborUnitHint: getUnitHint(data?.defaultStandardFactor),
      machineRate: data?.machineRate ?? 0,
      machineUnit: data?.defaultStandardFactor ?? "Hours/Piece",
      machineUnitHint: getUnitHint(data?.defaultStandardFactor),
      overheadRate: data?.overheadRate ?? 0,
    }));
  };

  const onSupplierProcessChange = async (supplierProcessId: string) => {
    if (!carbon) return;
    const { data, error } = await carbon
      .from("supplierProcess")
      .select("*")
      .eq("id", supplierProcessId)
      .single();

    if (error) throw new Error(error.message);

    setProcessData((d) => ({
      ...d,
      operationMinimumCost: data?.minimumCost ?? 0,
      operationUnitCost: data?.unitCost ?? 0,
      operationLeadTime: data?.leadTime ?? 0,
    }));
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
      fetcher={fetcher}
      onSubmit={async (values) => {
        setItems((prevItems) =>
          prevItems.map((i) =>
            i.id === item.id
              ? {
                  ...makeItem({
                    ...values,
                    workInstruction: i.data.workInstruction,
                  }),
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
              onChange={(value) => {
                if (value) {
                  onSupplierProcessChange(value?.value as string);
                }
              }}
            />
            <NumberControlled
              name="operationMinimumCost"
              label="Minimum Cost"
              minValue={0}
              value={processData.operationMinimumCost}
              formatOptions={{
                style: "currency",
                currency: baseCurrency,
              }}
              onChange={(newValue) =>
                setProcessData((d) => ({
                  ...d,
                  operationMinimumCost: newValue,
                }))
              }
            />
            <NumberControlled
              name="operationUnitCost"
              label="Unit Cost"
              minValue={0}
              value={processData.operationUnitCost}
              formatOptions={{
                style: "currency",
                currency: baseCurrency,
              }}
              onChange={(newValue) =>
                setProcessData((d) => ({
                  ...d,
                  operationUnitCost: newValue,
                }))
              }
            />
            <NumberControlled
              name="operationLeadTime"
              label="Lead Time"
              minValue={0}
              value={processData.operationLeadTime}
              onChange={(newValue) =>
                setProcessData((d) => ({
                  ...d,
                  operationLeadTime: newValue,
                }))
              }
            />
          </>
        ) : (
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
        )}
      </div>

      {processData.operationType === "Inside" && (
        <>
          <div className="border border-border rounded-md shadow-sm p-4 flex flex-col gap-4">
            <HStack
              className="w-full justify-between cursor-pointer"
              onClick={() => setShowSetup(!showSetup)}
            >
              <HStack>
                <TimeTypeIcon type="Setup" />
                <Label>Setup</Label>
              </HStack>
              <HStack>
                {(processData.setupTime ?? 0) > 0 && (
                  <Badge variant="secondary">
                    <TimeTypeIcon type="Setup" className="h-3 w-3 mr-1" />
                    {processData.setupTime} {processData.setupUnit}
                  </Badge>
                )}
                <IconButton
                  icon={<LuChevronDown />}
                  aria-label={showSetup ? "Collapse Setup" : "Expand Setup"}
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowSetup(!showSetup);
                  }}
                  className={`transition-transform ${
                    showSetup ? "rotate-180" : ""
                  }`}
                />
              </HStack>
            </HStack>
            <div
              className={`grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3 pb-4 ${
                showSetup ? "" : "hidden"
              }`}
            >
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
              <NumberControlled
                name="setupTime"
                label="Setup Time"
                minValue={0}
                value={processData.setupTime}
                onChange={(newValue) =>
                  setProcessData((d) => ({
                    ...d,
                    setupTime: newValue,
                  }))
                }
              />
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
            </div>
          </div>
          <div className="border border-border rounded-md shadow-sm p-4 flex flex-col gap-4">
            <HStack
              className="w-full justify-between cursor-pointer"
              onClick={() => setShowLabor(!showLabor)}
            >
              <HStack>
                <TimeTypeIcon type="Labor" />
                <Label>Labor</Label>
              </HStack>
              <HStack>
                {(processData.laborTime ?? 0) > 0 && (
                  <Badge variant="secondary">
                    <TimeTypeIcon type="Labor" className="h-3 w-3 mr-1" />
                    {processData.laborTime} {processData.laborUnit}
                  </Badge>
                )}
                <IconButton
                  icon={<LuChevronDown />}
                  aria-label={showLabor ? "Collapse Labor" : "Expand Labor"}
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowLabor(!showLabor);
                  }}
                  className={`transition-transform ${
                    showLabor ? "rotate-180" : ""
                  }`}
                />
              </HStack>
            </HStack>
            <div
              className={`grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3 pb-4 ${
                showLabor ? "" : "hidden"
              }`}
            >
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
              <NumberControlled
                name="laborTime"
                label="Labor Time"
                minValue={0}
                value={processData.laborTime}
                onChange={(newValue) =>
                  setProcessData((d) => ({
                    ...d,
                    laborTime: newValue,
                  }))
                }
              />
              <StandardFactor
                name="laborUnit"
                label="Labor Unit"
                hint={processData.laborUnitHint}
                value={processData.laborUnit}
                onChange={(newValue) => {
                  setProcessData((d) => ({
                    ...d,
                    laborUnit: newValue?.value ?? "Total Minutes",
                  }));
                }}
              />
            </div>
          </div>

          <div className="border border-border rounded-md shadow-sm p-4 flex flex-col gap-4">
            <HStack
              className="w-full justify-between cursor-pointer"
              onClick={() => setShowMachine(!showMachine)}
            >
              <HStack>
                <TimeTypeIcon type="Machine" />
                <Label>Machine</Label>
              </HStack>
              <HStack>
                {(processData.machineTime ?? 0) > 0 && (
                  <Badge variant="secondary">
                    <TimeTypeIcon type="Machine" className="h-3 w-3 mr-1" />
                    {processData.machineTime} {processData.machineUnit}
                  </Badge>
                )}
                <IconButton
                  icon={<LuChevronDown />}
                  aria-label={
                    showMachine ? "Collapse Machine" : "Expand Machine"
                  }
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowMachine(!showMachine);
                  }}
                  className={`transition-transform ${
                    showMachine ? "rotate-180" : ""
                  }`}
                />
              </HStack>
            </HStack>
            <div
              className={`grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3 pb-4 ${
                showMachine ? "" : "hidden"
              }`}
            >
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
              <NumberControlled
                name="machineTime"
                label="Machine Time"
                minValue={0}
                value={processData.machineTime}
                onChange={(newValue) =>
                  setProcessData((d) => ({
                    ...d,
                    machineTime: newValue,
                  }))
                }
              />
              <StandardFactor
                name="machineUnit"
                label="Machine Unit"
                hint={processData.machineUnitHint}
                value={processData.machineUnit}
                onChange={(newValue) => {
                  setProcessData((d) => ({
                    ...d,
                    machineUnit: newValue?.value ?? "Total Minutes",
                  }));
                }}
              />
            </div>
          </div>

          <div className="border border-border rounded-md shadow-sm p-4 flex flex-col gap-4">
            <HStack
              className="w-full justify-between cursor-pointer"
              onClick={() => setShowCost(!showCost)}
            >
              <HStack>
                <LuDollarSign />
                <Label>Costing</Label>
              </HStack>
              <IconButton
                icon={<LuChevronDown />}
                aria-label={showCost ? "Collapse Costing" : "Expand Costing"}
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowCost(!showCost);
                }}
                className={`transition-transform ${
                  showCost ? "rotate-180" : ""
                }`}
              />
            </HStack>
            <div
              className={`grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3 pb-4 ${
                showCost ? "" : "hidden"
              }`}
            >
              <NumberControlled
                name="laborRate"
                label="Labor Rate"
                minValue={0}
                value={processData.laborRate}
                formatOptions={{
                  style: "currency",
                  currency: baseCurrency,
                }}
                onChange={(newValue) =>
                  setProcessData((d) => ({
                    ...d,
                    laborRate: newValue,
                  }))
                }
              />
              <NumberControlled
                name="machineRate"
                label="Machine Rate"
                minValue={0}
                value={processData.machineRate}
                formatOptions={{
                  style: "currency",
                  currency: baseCurrency,
                }}
                onChange={(newValue) =>
                  setProcessData((d) => ({
                    ...d,
                    machineRate: newValue,
                  }))
                }
              />
              <NumberControlled
                name="overheadRate"
                label="Overhead Rate"
                minValue={0}
                value={processData.overheadRate}
                formatOptions={{
                  style: "currency",
                  currency: baseCurrency,
                }}
                onChange={(newValue) =>
                  setProcessData((d) => ({
                    ...d,
                    overheadRate: newValue,
                  }))
                }
              />
            </div>
          </div>
        </>
      )}
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
          <Submit isDisabled={isDisabled}>Save</Submit>
        </motion.div>
      </motion.div>
    </ValidatedForm>
  );
}

function ToolsListItem({
  tool: { toolId, quantity, id, updatedBy, updatedAt, createdBy, createdAt },
  operationId,
  className,
}: {
  tool: OperationTool;
  operationId: string;
  className?: string;
}) {
  const disclosure = useDisclosure();
  const deleteModalDisclosure = useDisclosure();
  const submitted = useRef(false);
  const fetcher = useFetcher<typeof editQuoteOperationToolAction>();

  useEffect(() => {
    if (submitted.current && fetcher.state === "idle") {
      disclosure.onClose();
      submitted.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state]);

  const tools = useTools();
  const tool = tools.find((t) => t.id === toolId);
  if (!tool || !id) return null;

  const isUpdated = updatedBy !== null;
  const person = isUpdated ? updatedBy : createdBy;
  const date = updatedAt ?? createdAt;

  return (
    <div className={cn("border-b p-6", className)}>
      {disclosure.isOpen ? (
        <ValidatedForm
          action={path.to.quoteOperationTool(id)}
          method="post"
          validator={operationToolValidator}
          fetcher={fetcher}
          resetAfterSubmit
          onSubmit={() => {
            disclosure.onClose();
          }}
          defaultValues={{
            id: id,
            toolId: toolId ?? "",
            quantity: quantity ?? 1,
            operationId,
          }}
          className="w-full"
        >
          <Hidden name="operationId" />
          <VStack spacing={4}>
            <div className="w-full grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-4 items-start">
              <Tool name="toolId" label="Tool" autoFocus />
              <Number name="quantity" label="Quantity" />
            </div>
            <HStack className="w-full justify-end" spacing={2}>
              <Button variant="secondary" onClick={disclosure.onClose}>
                Cancel
              </Button>
              <Submit
                isDisabled={fetcher.state !== "idle"}
                isLoading={fetcher.state !== "idle"}
              >
                Save
              </Submit>
            </HStack>
          </VStack>
        </ValidatedForm>
      ) : (
        <div className="flex flex-1 justify-between items-center w-full">
          <HStack spacing={4} className="w-1/2">
            <HStack spacing={4} className="flex-1">
              <div className="bg-muted border rounded-full flex items-center justify-center p-2">
                <LuHammer className="size-4" />
              </div>
              <VStack spacing={0}>
                <span className="text-sm font-medium">{tool.readableId}</span>
                <span className="text-xs text-muted-foreground">
                  {tool.name}
                </span>
              </VStack>
              <span className="text-base text-muted-foreground text-right">
                {quantity}
              </span>
            </HStack>
          </HStack>
          <div className="flex items-center justify-end gap-2">
            <HStack spacing={2}>
              <span className="text-xs text-muted-foreground">
                {isUpdated ? "Updated" : "Created"} {formatRelativeTime(date)}
              </span>
              <EmployeeAvatar employeeId={person} withName={false} />
            </HStack>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  aria-label="Open menu"
                  icon={<LuMoreVertical />}
                  variant="ghost"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={disclosure.onOpen}>
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={deleteModalDisclosure.onOpen}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}
      {deleteModalDisclosure.isOpen && (
        <ConfirmDelete
          action={path.to.deleteQuoteOperationTool(id)}
          isOpen={deleteModalDisclosure.isOpen}
          name={tool.readableId}
          text={`Are you sure you want to delete ${tool.readableId} from this operation? This cannot be undone.`}
          onCancel={() => {
            deleteModalDisclosure.onClose();
          }}
          onSubmit={() => {
            deleteModalDisclosure.onClose();
          }}
        />
      )}
    </div>
  );
}

function ToolsForm({
  operationId,
  isDisabled,
  tools,
}: {
  operationId: string;
  isDisabled: boolean;
  tools: OperationTool[];
}) {
  const fetcher = useFetcher<typeof newQuoteOperationToolAction>();

  if (isDisabled && isTemporaryId(operationId)) {
    return (
      <Alert className="max-w-[420px] mx-auto my-8">
        <LuAlertTriangle />
        <AlertTitle>Cannot add tools to unsaved operation</AlertTitle>
        <AlertDescription>
          Please save the operation before adding tools.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="p-6 border rounded-lg">
        <ValidatedForm
          action={path.to.newQuoteOperationTool}
          method="post"
          validator={operationToolValidator}
          fetcher={fetcher}
          resetAfterSubmit
          defaultValues={{
            id: undefined,
            toolId: "",
            quantity: 1,
            operationId,
          }}
          className="w-full"
        >
          <Hidden name="operationId" />
          <VStack spacing={4}>
            <div className="w-full grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-4 items-start">
              <Tool name="toolId" label="Tool" autoFocus />
              <Number name="quantity" label="Quantity" />
            </div>

            <Submit
              leftIcon={<LuPlusCircle />}
              isDisabled={isDisabled || fetcher.state !== "idle"}
              isLoading={fetcher.state !== "idle"}
            >
              Add New
            </Submit>
          </VStack>
        </ValidatedForm>
      </div>

      {tools.length > 0 && (
        <div className="border rounded-lg">
          {[...tools]
            .sort((a, b) =>
              String(a.id ?? "").localeCompare(String(b.id ?? ""))
            )
            .map((t, index) => (
              <ToolsListItem
                key={t.id}
                tool={t}
                operationId={operationId}
                className={index === tools.length - 1 ? "border-none" : ""}
              />
            ))}
        </div>
      )}
    </div>
  );
}
