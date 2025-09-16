"use client";
import { useCarbon } from "@carbon/auth";
import { Array as ArrayInput, Input, ValidatedForm } from "@carbon/form";
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
  Count,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Label,
  Loading,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  VStack,
  cn,
  toast,
  useDebounce,
  useDisclosure,
  useThrottle,
} from "@carbon/react";
import { Editor, generateHTML } from "@carbon/react/Editor";
import { formatRelativeTime } from "@carbon/utils";
import { getLocalTimeZone, today } from "@internationalized/date";
import { useFetcher, useFetchers, useParams } from "@remix-run/react";
import { AnimatePresence, LayoutGroup, motion, Reorder } from "framer-motion";
import { nanoid } from "nanoid";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  LuActivity,
  LuChevronRight,
  LuCirclePlus,
  LuEllipsisVertical,
  LuGripVertical,
  LuHammer,
  LuInfo,
  LuList,
  LuListChecks,
  LuLock,
  LuMaximize2,
  LuMinimize2,
  LuSettings2,
  LuSquareFunction,
  LuTriangleAlert,
  LuX,
} from "react-icons/lu";
import { z } from "zod";
import {
  DirectionAwareTabs,
  EmployeeAvatar,
  Empty,
  TimeTypeIcon,
} from "~/components";
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
  Tags,
  Tool,
  UnitHint,
  UnitOfMeasure,
  WorkCenter,
} from "~/components/Form";

import { flushSync } from "react-dom";
import { ConfigurationEditor } from "~/components/Configurator/ConfigurationEditor";
import type { Configuration } from "~/components/Configurator/types";

import { getUnitHint } from "~/components/Form/UnitHint";
import { ConfirmDelete } from "~/components/Modals";
import type { Item, SortableItemRenderProps } from "~/components/SortableList";
import { SortableList, SortableListItem } from "~/components/SortableList";
import { usePermissions, useUser } from "~/hooks";
import { useTags } from "~/hooks/useTags";

import type {
  OperationParameter,
  OperationStep,
  OperationTool,
} from "~/modules/shared";
import {
  methodOperationOrders,
  operationParameterValidator,
  operationStepValidator,
  operationToolValidator,
  operationTypes,
  procedureStepType,
  standardFactorType,
} from "~/modules/shared";

import type { action as editMethodOperationParameterAction } from "~/routes/x+/items+/methods+/operation.parameter.$id";
import type { action as newMethodOperationParameterAction } from "~/routes/x+/items+/methods+/operation.parameter.new";
import type { action as editMethodOperationStepAction } from "~/routes/x+/items+/methods+/operation.step.$id";
import type { action as editMethodOperationToolAction } from "~/routes/x+/items+/methods+/operation.tool.$id";
import type { action as newMethodOperationToolAction } from "~/routes/x+/items+/methods+/operation.tool.new";

import Procedure from "~/components/Form/Procedure";
import { SupplierProcessPreview } from "~/components/Form/SupplierProcess";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import { ProcedureStepTypeIcon } from "~/components/Icons";
import { useTools } from "~/stores";
import { getPrivateUrl, path } from "~/utils/path";
import { methodOperationValidator } from "../../items.models";
import type {
  ConfigurationParameter,
  ConfigurationRule,
  MakeMethod,
} from "../../types";

type Operation = z.infer<typeof methodOperationValidator> & {
  workInstruction: JSONContent | null;
  tags: string[];
};

type ItemWithData = Item & {
  data: Operation;
};

type BillOfProcessProps = {
  configurable?: boolean;
  configurationRules?: ConfigurationRule[];
  makeMethod: MakeMethod;
  operations: (Operation & {
    methodOperationTool: OperationTool[];
    methodOperationParameter: OperationParameter[];
    methodOperationStep: OperationStep[];
  })[];
  parameters?: ConfigurationParameter[];
  tags: { name: string }[];
};

type PendingWorkInstructions = {
  [key: string]: JSONContent;
};

type OrderState = {
  [key: string]: number;
};

type CheckedState = {
  [key: string]: boolean;
};

type TemporaryItems = {
  [key: string]: Operation;
};

const initialOperation: Omit<
  Operation,
  "makeMethodId" | "order" | "tools" | "id"
> = {
  description: "",
  laborTime: 0,
  laborUnit: "Minutes/Piece",
  machineTime: 0,
  machineUnit: "Minutes/Piece",
  operationOrder: "After Previous",
  operationType: "Inside",
  processId: "",
  procedureId: "",
  setupTime: 0,
  setupUnit: "Total Minutes",
  tags: [],
  workCenterId: "",
  workInstruction: {},
  operationMinimumCost: 0,
  operationLeadTime: 0,
  operationUnitCost: 0,
};

const BillOfProcess = ({
  configurable = false,
  configurationRules,
  makeMethod,
  operations: initialOperations,
  parameters,
  tags,
}: BillOfProcessProps) => {
  const permissions = usePermissions();
  const isReadOnly =
    permissions.can("update", "parts") === false ||
    makeMethod.status !== "Draft";

  const makeMethodId = makeMethod.id;

  const { carbon } = useCarbon();
  const sortOrderFetcher = useFetcher<{}>();
  const deleteOperationFetcher = useFetcher<{ success: boolean }>();
  const { id: userId } = useUser();

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [temporaryItems, setTemporaryItems] = useState<TemporaryItems>({});
  const [workInstructions, setWorkInstructions] =
    useState<PendingWorkInstructions>(() => {
      return initialOperations.reduce((acc, operation) => {
        if (operation.workInstruction) {
          acc[operation.id!] = operation.workInstruction;
        }
        return acc;
      }, {} as PendingWorkInstructions);
    });
  const [checkedState, setCheckedState] = useState<CheckedState>({});
  const [orderState, setOrderState] = useState<OrderState>(() => {
    return initialOperations.reduce((acc, op) => {
      acc[op.id!] = op.order;
      return acc;
    }, {} as OrderState);
  });

  const operationsById = new Map<
    string,
    Operation & { methodOperationTool: OperationTool[] }
  >();

  // Add initial operations to map
  initialOperations.forEach((operation) => {
    if (!operation.id) return;
    operationsById.set(operation.id, operation);
  });

  const pendingOperations = usePendingOperations();

  // Replace existing operations with pending ones
  pendingOperations.forEach((pendingOperation) => {
    if (!pendingOperation.id) {
      operationsById.set("temporary", {
        ...pendingOperation,
        workInstruction: {},
        methodOperationTool: [],
        tags: [],
      });
      return;
    }

    // Remove existing operation if it exists
    operationsById.delete(pendingOperation.id);

    // Add pending operation
    operationsById.set(pendingOperation.id, {
      ...pendingOperation,
      workInstruction: workInstructions[pendingOperation.id] || null,
      order: orderState[pendingOperation.id] ?? pendingOperation.order,
      methodOperationTool: [],
      tags: [],
    });
  });

  // Add temporary items to operations
  Object.entries(temporaryItems).forEach(([id, operation]) => {
    if (!operationsById.has(id)) {
      operationsById.set(id, {
        ...operation,
        methodOperationTool: [],
      });
    }
  });

  const operations = Array.from(operationsById.values()).sort(
    (a, b) => (orderState[a.id!] ?? a.order) - (orderState[b.id!] ?? b.order)
  );

  const items = makeItems(operations, tags).map((item) => ({
    ...item,
    checked: checkedState[item.id] ?? false,
  }));

  const onUpdateWorkInstruction = useDebounce(
    async (id: string, content: JSONContent) => {
      if (!temporaryItems[id]) {
        await carbon
          ?.from("methodOperation")
          .update({
            workInstruction: content,
            updatedAt: today(getLocalTimeZone()).toString(),
            updatedBy: userId,
          })
          .eq("id", id);
      }
    },
    1000,
    true
  );

  const onUploadImage = async (file: File) => {
    const fileType = file.name.split(".").pop();
    const fileName = `${companyId}/parts/${selectedItemId}/${nanoid()}.${fileType}`;
    const result = await carbon?.storage
      .from("private")
      .upload(fileName, file, {
        upsert: true,
        cacheControl: "3600",
      });

    if (result?.error) {
      throw new Error(result.error.message);
    }

    if (!result?.data) {
      throw new Error("Failed to upload image");
    }

    return getPrivateUrl(result.data.path);
  };

  const onToggleItem = (id: string) => {
    if (isReadOnly) return;
    setCheckedState((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const onReorder = (items: ItemWithData[]) => {
    if (isReadOnly) return;

    // Create new order state
    const newOrderState = items.reduce<OrderState>((acc, item, index) => {
      acc[item.id] = index + 1;
      return acc;
    }, {});

    // Update order state immediately
    setOrderState(newOrderState);

    // Only send saved items to the server (exclude temporary items)
    const updates = Object.entries(newOrderState).reduce<
      Record<string, number>
    >((acc, [id, order]) => {
      if (!temporaryItems[id]) {
        acc[id] = order;
      }
      return acc;
    }, {});

    updateSortOrder(updates);
  };

  const updateSortOrder = useThrottle(
    (updates: Record<string, number>) => {
      let formData = new FormData();
      formData.append("updates", JSON.stringify(updates));
      sortOrderFetcher.submit(formData, {
        method: "post",
        action: path.to.methodOperationsOrder,
      });
    },
    1000,
    true
  );

  const onAddItem = () => {
    const operationId = nanoid();

    let newOrder = 1;
    if (operations.length) {
      newOrder = Math.max(...operations.map((op) => op.order)) + 1;
    }

    const newOperation: Operation = {
      ...initialOperation,
      id: operationId,
      order: newOrder,
      makeMethodId,
    };

    setTemporaryItems((prev) => ({
      ...prev,
      [operationId]: newOperation,
    }));
    setSelectedItemId(operationId);
  };

  const onRemoveItem = async (id: string) => {
    if (isReadOnly) return;

    const operation = operationsById.get(id);
    if (!operation) return;

    // Check if this is a temporary item (exists in temporaryItems state)
    if (temporaryItems[id]) {
      setTemporaryItems((prev) => {
        const { [id]: _, ...rest } = prev;
        return rest;
      });
    } else {
      deleteOperationFetcher.submit(
        { id },
        {
          method: "post",
          action: path.to.methodOperationsDelete,
        }
      );
    }

    setSelectedItemId(null);
    setOrderState((prev) => {
      const { [id]: _, ...rest } = prev;
      return rest;
    });
  };

  const {
    company: { id: companyId },
  } = useUser();

  const [tabChangeRerender, setTabChangeRerender] = useState<number>(1);
  const renderListItem = ({
    item,
    items,
    order,
    onToggleItem,
    onRemoveItem,
  }: SortableItemRenderProps<ItemWithData>) => {
    const isOpen = item.id === selectedItemId;
    const tools =
      initialOperations.find((o) => o.id === item.id)?.methodOperationTool ??
      [];
    const parameters =
      initialOperations.find((o) => o.id === item.id)
        ?.methodOperationParameter ?? [];
    const steps =
      initialOperations.find((o) => o.id === item.id)?.methodOperationStep ??
      [];

    const hasProcedure = !!item.data.procedureId;

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
                isReadOnly={isReadOnly}
                configurable={configurable}
                item={item}
                rulesByField={rulesByField}
                workInstruction={workInstructions[item.id] ?? {}}
                temporaryItems={temporaryItems}
                onConfigure={onConfigure}
                setSelectedItemId={setSelectedItemId}
                setTemporaryItems={setTemporaryItems}
                setWorkInstructions={setWorkInstructions}
              />
            </motion.div>
          </div>
        ),
      },
      {
        id: 1,
        label: (
          <span className="flex items-center gap-2">
            Instructions
            {hasProcedure && (
              <Tooltip>
                <TooltipTrigger>
                  <Badge variant="secondary">
                    <LuListChecks />
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="opacity-100">
                  <p>Instructions are inherited from the procedure.</p>
                </TooltipContent>
              </Tooltip>
            )}
          </span>
        ),
        disabled:
          item.id in temporaryItems ||
          hasProcedure ||
          item.data.operationType === "Outside",
        content: (
          <div className="flex flex-col">
            <div>
              {!isReadOnly ? (
                <Editor
                  initialValue={
                    workInstructions[item.id] ?? ({} as JSONContent)
                  }
                  onUpload={onUploadImage}
                  onChange={(content) => {
                    if (isReadOnly) return;
                    setWorkInstructions((prev) => ({
                      ...prev,
                      [item.id]: content,
                    }));
                    onUpdateWorkInstruction(item.id, content);
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
        disabled:
          item.id in temporaryItems ||
          hasProcedure ||
          item.data.operationType === "Outside",
        label: (
          <span className="flex items-center gap-2">
            <span>Parameters</span>
            {hasProcedure && (
              <Tooltip>
                <TooltipTrigger>
                  <Badge variant="secondary">
                    <LuListChecks />
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="opacity-100">
                  <p>Parameters are inherited from the procedure.</p>
                </TooltipContent>
              </Tooltip>
            )}
            {!hasProcedure && parameters.length > 0 && (
              <Count count={parameters.length} />
            )}
          </span>
        ),
        content: (
          <div className="flex w-full flex-col py-4">
            <ParametersForm
              parameters={parameters}
              operationId={item.id!}
              temporaryItems={temporaryItems}
              isDisabled={
                isReadOnly ||
                selectedItemId === null ||
                (selectedItemId !== null && !!temporaryItems[selectedItemId])
              }
              configurable={configurable}
              rulesByField={rulesByField}
              onConfigure={onConfigure}
            />
          </div>
        ),
      },
      {
        id: 3,
        disabled:
          item.id in temporaryItems ||
          hasProcedure ||
          item.data.operationType === "Outside",
        label: (
          <span className="flex items-center gap-2">
            <span>Steps</span>
            {hasProcedure && (
              <Tooltip>
                <TooltipTrigger>
                  <Badge variant="secondary">
                    <LuListChecks />
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="opacity-100">
                  <p>Attributes are inherited from the procedure.</p>
                </TooltipContent>
              </Tooltip>
            )}
            {!hasProcedure && steps.length > 0 && (
              <Count count={steps.length} />
            )}
          </span>
        ),
        content: (
          <div className="flex w-full flex-col py-4">
            <AttributesForm
              steps={steps}
              operationId={item.id!}
              temporaryItems={temporaryItems}
              isDisabled={
                isReadOnly ||
                selectedItemId === null ||
                (selectedItemId !== null && !!temporaryItems[selectedItemId])
              }
              configurable={configurable}
              rulesByField={rulesByField}
              onConfigure={onConfigure}
            />
          </div>
        ),
      },
      {
        id: 4,
        disabled:
          item.id in temporaryItems || item.data.operationType === "Outside",
        label: (
          <span className="flex items-center gap-2">
            <span>Tools</span>
            {tools.length > 0 && <Count count={tools.length} />}
          </span>
        ),
        content: (
          <div className="flex w-full flex-col py-4">
            <ToolsForm
              tools={tools}
              operationId={item.id!}
              temporaryItems={temporaryItems}
              isDisabled={
                isReadOnly ||
                selectedItemId === null ||
                (selectedItemId !== null && !!temporaryItems[selectedItemId])
              }
            />
          </div>
        ),
      },
    ];

    return (
      <SortableListItem<Operation>
        isReadOnly={isReadOnly}
        item={item}
        items={items}
        order={order}
        key={item.id}
        isExpanded={isOpen}
        onSelectItem={setSelectedItemId}
        onToggleItem={onToggleItem}
        onRemoveItem={onRemoveItem}
        handleDrag={() => setSelectedItemId(null)}
        className="my-2"
        renderExtra={(item) => (
          <div key={`${isOpen}`}>
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

  const configuratorDisclosure = useDisclosure();
  const [configuration, setConfiguration] = useState<Configuration | null>(
    null
  );

  const onConfigure = (c: Configuration) => {
    flushSync(() => {
      setConfiguration(c);
    });
    configuratorDisclosure.onOpen();
  };

  const { materialId } = useParams();

  const rulesByField = new Map(
    configurationRules?.map((rule) => [rule.field, rule]) ?? []
  );

  return (
    <Card>
      <HStack className="justify-between">
        <CardHeader>
          <CardTitle className="flex flex-row items-center gap-2">
            Bill of Process {isReadOnly && <LuLock />}
          </CardTitle>
        </CardHeader>

        <CardAction>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              isDisabled={isReadOnly || selectedItemId !== null}
              onClick={onAddItem}
            >
              Add Operation
            </Button>
            {configurable && operations.length > 0 && (
              <IconButton
                icon={<LuSquareFunction />}
                aria-label="Configure"
                variant="ghost"
                className={cn(
                  rulesByField.has(
                    `billOfProcess:${makeMethodId}:${materialId}`
                  ) && "text-emerald-500 hover:text-emerald-500"
                )}
                onClick={() =>
                  onConfigure({
                    label: "Bill of Process",
                    field: `billOfProcess:${makeMethodId}:${materialId}`,
                    code: rulesByField.get(
                      `billOfProcess:${makeMethodId}:${materialId}`
                    )?.code,
                    returnType: {
                      type: "list",
                      listOptions: operations.map((op) => op.description),
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
          items={items}
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
          // @ts-ignore
          parameters={parameters ?? []}
          onClose={configuratorDisclosure.onClose}
        />
      )}
    </Card>
  );
};

export default BillOfProcess;

type OperationFormProps = {
  configurable: boolean;
  isReadOnly: boolean;
  item: ItemWithData;
  rulesByField: Map<string, ConfigurationRule>;
  workInstruction: JSONContent;
  temporaryItems: TemporaryItems;
  onConfigure: (configuration: Configuration) => void;
  setSelectedItemId: Dispatch<SetStateAction<string | null>>;
  setTemporaryItems: Dispatch<SetStateAction<TemporaryItems>>;
  setWorkInstructions: Dispatch<SetStateAction<PendingWorkInstructions>>;
};

function OperationForm({
  isReadOnly,
  configurable,
  item,
  rulesByField,
  workInstruction,
  temporaryItems,
  onConfigure,
  setSelectedItemId,
  setWorkInstructions,
  setTemporaryItems,
}: OperationFormProps) {
  const methodOperationFetcher = useFetcher<{ id: string }>();
  const { company } = useUser();
  const { carbon } = useCarbon();

  const baseCurrency = company?.baseCurrencyCode ?? "USD";

  useEffect(() => {
    // Remove from temporary items after successful submission
    if (methodOperationFetcher.data && methodOperationFetcher.data.id) {
      // Clear temporary item after successful save
      setTemporaryItems((prev) => {
        const { [item.id]: _, ...rest } = prev;
        return rest;
      });
    }
  }, [item.id, methodOperationFetcher.data, setTemporaryItems]);

  const machineDisclosure = useDisclosure();
  const laborDisclosure = useDisclosure();
  const setupDisclosure = useDisclosure();
  const procedureDisclosure = useDisclosure();

  const [processData, setProcessData] = useState<{
    description: string;
    laborTime: number;
    laborUnit: string;
    laborUnitHint: string;
    machineTime: number;
    machineUnit: string;
    machineUnitHint: string;
    operationType: string;
    operationOrder: string;
    processId: string;
    procedureId: string;
    workCenterId: string;
    setupTime: number;
    setupUnit: string;
    setupUnitHint: string;
    operationMinimumCost: number;
    operationLeadTime: number;
    operationUnitCost: number;
  }>({
    description: item.data.description ?? "",
    laborTime: item.data.laborTime ?? 0,
    laborUnit: item.data.laborUnit ?? "Hours/Piece",
    laborUnitHint: getUnitHint(item.data.laborUnit),
    machineTime: item.data.machineTime ?? 0,
    machineUnit: item.data.machineUnit ?? "Hours/Piece",
    machineUnitHint: getUnitHint(item.data.machineUnit),
    operationOrder: item.data.operationOrder ?? "After Previous",
    operationType: item.data.operationType ?? "Inside",
    processId: item.data.processId ?? "",
    procedureId: item.data.procedureId ?? "",
    workCenterId: item.data.workCenterId ?? "",
    setupTime: item.data.setupTime ?? 0,
    setupUnit: item.data.setupUnit ?? "Total Minutes",
    setupUnitHint: getUnitHint(item.data.setupUnit),
    operationMinimumCost: item.data.operationMinimumCost ?? 0,
    operationLeadTime: item.data.operationLeadTime ?? 0,
    operationUnitCost: item.data.operationUnitCost ?? 0,
  });

  const onProcessChange = async (processId: string) => {
    if (!carbon || !processId) return;
    const [process, supplierProcesses] = await Promise.all([
      carbon.from("process").select("*").eq("id", processId).single(),
      carbon.from("supplierProcess").select("*").eq("processId", processId),
    ]);

    if (process.error) throw new Error(process.error.message);

    setProcessData((p) => ({
      ...p,
      processId,
      procedureId: "",
      description: process.data?.name ?? "",
      laborUnit: process.data?.defaultStandardFactor ?? "Hours/Piece",
      laborUnitHint: getUnitHint(process.data?.defaultStandardFactor),
      machineUnit: process.data?.defaultStandardFactor ?? "Hours/Piece",
      machineUnitHint: getUnitHint(process.data?.defaultStandardFactor),
      operationType:
        process.data?.processType === "Outside" ? "Outside" : "Inside",
      operationMinimumCost:
        supplierProcesses.data && supplierProcesses.data.length > 0
          ? supplierProcesses.data.reduce((acc, sp) => {
              return (acc += sp.minimumCost ?? 0);
            }, 0) / supplierProcesses.data.length
          : p.operationMinimumCost,
      operationUnitCost: item.data.operationUnitCost ?? 0,
      operationLeadTime:
        supplierProcesses.data && supplierProcesses.data.length > 0
          ? supplierProcesses.data.reduce((acc, sp) => {
              return (acc += sp.leadTime ?? 0);
            }, 0) / supplierProcesses.data.length
          : p.operationLeadTime,
    }));
  };

  const onWorkCenterChange = async (workCenterId: string) => {
    if (!carbon || !workCenterId) return;
    const { data, error } = await carbon
      .from("workCenter")
      .select("*")
      .eq("id", workCenterId)
      .single();

    if (error) throw new Error(error.message);

    setProcessData((p) => ({
      ...p,
      workCenterId,
      laborUnit: data?.defaultStandardFactor ?? "Hours/Piece",
      laborUnitHint: getUnitHint(data?.defaultStandardFactor),
      machineUnit: data?.defaultStandardFactor ?? "Hours/Piece",
      machineUnitHint: getUnitHint(data?.defaultStandardFactor),
    }));
  };

  const key = (field: string) => getFieldKey(field, item.id);

  return (
    <ValidatedForm
      action={
        temporaryItems[item.id]
          ? path.to.newMethodOperation
          : path.to.methodOperation(item.id!)
      }
      method="post"
      defaultValues={item.data}
      validator={methodOperationValidator}
      className="w-full flex flex-col gap-y-4"
      fetcher={methodOperationFetcher}
    >
      <div>
        <Hidden name="id" />
        <Hidden name="makeMethodId" />
        <Hidden name="order" />
      </div>

      <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
        <Process
          name="processId"
          label="Process"
          isConfigured={rulesByField.has(key("processId"))}
          onConfigure={
            configurable && !temporaryItems[item.id]
              ? () => {
                  onConfigure({
                    label: "Process",
                    field: key("processId"),
                    code: rulesByField.get(key("processId"))?.code,
                    defaultValue: processData.processId,
                    returnType: {
                      type: "text",
                      helperText:
                        "the unique identifier for the process. you can get this from the URL when editing a process",
                    },
                  });
                }
              : undefined
          }
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
          isConfigured={rulesByField.has(key("operationOrder"))}
          onConfigure={
            configurable && !temporaryItems[item.id]
              ? () => {
                  onConfigure({
                    label: "Operation Order",
                    field: key("operationOrder"),
                    code: rulesByField.get(key("operationOrder"))?.code,
                    defaultValue: processData.operationOrder,
                    returnType: {
                      type: "enum",
                      listOptions: ["After Previous", "With Previous"],
                    },
                  });
                }
              : undefined
          }
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
          isConfigured={rulesByField.has(key("operationType"))}
          onConfigure={
            configurable && !temporaryItems[item.id]
              ? () => {
                  onConfigure({
                    label: "Operation Type",
                    field: key("operationType"),
                    code: rulesByField.get(key("operationType"))?.code,
                    defaultValue: processData.operationType,
                    returnType: {
                      type: "enum",
                      listOptions: ["Inside", "Outside"],
                    },
                  });
                }
              : undefined
          }
        />

        <InputControlled
          name="description"
          label="Description"
          value={processData.description}
          onChange={(newValue) => {
            setProcessData((d) => ({ ...d, description: newValue }));
          }}
          className="col-span-2"
          isConfigured={rulesByField.has(key("description"))}
          onConfigure={
            configurable && !temporaryItems[item.id]
              ? () => {
                  onConfigure({
                    label: "Description",
                    field: key("description"),
                    code: rulesByField.get(key("description"))?.code,
                    defaultValue: processData.description,
                    returnType: {
                      type: "text",
                    },
                  });
                }
              : undefined
          }
        />

        {processData.operationType === "Outside" ? (
          <>
            <SupplierProcess
              name="operationSupplierProcessId"
              label="Supplier"
              processId={processData.processId}
              isOptional
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
          <>
            <WorkCenter
              name="workCenterId"
              label="Work Center"
              isOptional
              processId={processData.processId}
              isConfigured={rulesByField.has(key("workCenterId"))}
              onConfigure={
                configurable && !temporaryItems[item.id]
                  ? () => {
                      onConfigure({
                        label: "Work Center",
                        field: key("workCenterId"),
                        code: rulesByField.get(key("workCenterId"))?.code,
                        defaultValue: processData.workCenterId,
                        returnType: {
                          type: "text",
                          helperText:
                            "the unique identifier for the work center. you can get this from the URL when editing a work center",
                        },
                      });
                    }
                  : undefined
              }
              onChange={(value) => {
                if (value) {
                  onWorkCenterChange(value?.value as string);
                }
              }}
            />
          </>
        )}
      </div>

      {processData.operationType === "Inside" && (
        <>
          <div className="border border-border rounded-md shadow-sm p-4 flex flex-col gap-4">
            <HStack
              className="w-full justify-between cursor-pointer"
              onClick={setupDisclosure.onToggle}
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
                  icon={<LuChevronRight />}
                  aria-label={
                    setupDisclosure.isOpen ? "Collapse Setup" : "Expand Setup"
                  }
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setupDisclosure.onToggle();
                  }}
                  className={`transition-transform ${
                    setupDisclosure.isOpen ? "rotate-90" : ""
                  }`}
                />
              </HStack>
            </HStack>
            <div
              className={`grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3 pb-4 ${
                setupDisclosure.isOpen ? "" : "hidden"
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
                isConfigured={rulesByField.has(key("setupTime"))}
                onConfigure={
                  configurable && !temporaryItems[item.id]
                    ? () => {
                        onConfigure({
                          label: "Setup Time",
                          field: key("setupTime"),
                          code: rulesByField.get(key("setupTime"))?.code,
                          defaultValue: processData.setupTime,
                          returnType: {
                            type: "numeric",
                          },
                        });
                      }
                    : undefined
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
                isConfigured={rulesByField.has(key("setupUnit"))}
                onConfigure={
                  configurable && !temporaryItems[item.id]
                    ? () => {
                        onConfigure({
                          label: "Setup Unit",
                          field: key("setupUnit"),
                          code: rulesByField.get(key("setupUnit"))?.code,
                          defaultValue: processData.setupUnit,
                          returnType: {
                            type: "enum",
                            listOptions: standardFactorType,
                          },
                        });
                      }
                    : undefined
                }
              />
            </div>
          </div>

          <div className="border border-border rounded-md shadow-sm p-4 flex flex-col gap-4">
            <HStack
              className="w-full justify-between cursor-pointer"
              onClick={laborDisclosure.onToggle}
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
                  icon={<LuChevronRight />}
                  aria-label={
                    laborDisclosure.isOpen ? "Collapse Labor" : "Expand Labor"
                  }
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    laborDisclosure.onToggle();
                  }}
                  className={`transition-transform ${
                    laborDisclosure.isOpen ? "rotate-90" : ""
                  }`}
                />
              </HStack>
            </HStack>
            <div
              className={`grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3 pb-4 ${
                laborDisclosure.isOpen ? "" : "hidden"
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
                isConfigured={rulesByField.has(key("laborTime"))}
                onConfigure={
                  configurable && !temporaryItems[item.id]
                    ? () => {
                        onConfigure({
                          label: "Labor Time",
                          field: key("laborTime"),
                          code: rulesByField.get(key("laborTime"))?.code,
                          defaultValue: processData.laborTime,
                          returnType: {
                            type: "numeric",
                          },
                        });
                      }
                    : undefined
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
                isConfigured={rulesByField.has(key("laborUnit"))}
                onConfigure={
                  configurable && !temporaryItems[item.id]
                    ? () => {
                        onConfigure({
                          label: "Labor Unit",
                          field: key("laborUnit"),
                          code: rulesByField.get(key("laborUnit"))?.code,
                          defaultValue: processData.laborUnit,
                          returnType: {
                            type: "enum",
                            listOptions: standardFactorType,
                          },
                        });
                      }
                    : undefined
                }
              />
            </div>
          </div>
          <div className="border border-border rounded-md shadow-sm p-4 flex flex-col gap-4">
            <HStack
              className="w-full justify-between cursor-pointer"
              onClick={machineDisclosure.onToggle}
            >
              <HStack>
                <TimeTypeIcon type="Machine" />
                <Label>Machine</Label>
              </HStack>
              <HStack>
                {(processData?.machineTime ?? 0) > 0 && (
                  <Badge variant="secondary">
                    <TimeTypeIcon type="Machine" className="h-3 w-3 mr-1" />
                    {processData.machineTime} {processData.machineUnit}
                  </Badge>
                )}
                <IconButton
                  icon={<LuChevronRight />}
                  aria-label={
                    machineDisclosure.isOpen
                      ? "Collapse Machine"
                      : "Expand Machine"
                  }
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    machineDisclosure.onToggle();
                  }}
                  className={`transition-transform ${
                    machineDisclosure.isOpen ? "rotate-90" : ""
                  }`}
                />
              </HStack>
            </HStack>
            <div
              className={`grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3 pb-4 ${
                machineDisclosure.isOpen ? "" : "hidden"
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
                isConfigured={rulesByField.has(key("machineTime"))}
                onConfigure={
                  configurable && !temporaryItems[item.id]
                    ? () => {
                        onConfigure({
                          label: "Machine Time",
                          field: key("machineTime"),
                          code: rulesByField.get(key("machineTime"))?.code,
                          defaultValue: processData.machineTime,
                          returnType: {
                            type: "numeric",
                          },
                        });
                      }
                    : undefined
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
                isConfigured={rulesByField.has(key("machineUnit"))}
                onConfigure={
                  configurable && !temporaryItems[item.id]
                    ? () => {
                        onConfigure({
                          label: "Machine Unit",
                          field: key("machineUnit"),
                          code: rulesByField.get(key("machineUnit"))?.code,
                          defaultValue: processData.machineUnit,
                          returnType: {
                            type: "enum",
                            listOptions: standardFactorType,
                          },
                        });
                      }
                    : undefined
                }
              />
            </div>
          </div>

          <div className="border border-border rounded-md shadow-sm p-4 flex flex-col gap-4">
            <HStack
              className="w-full justify-between cursor-pointer"
              onClick={procedureDisclosure.onToggle}
            >
              <HStack>
                <LuListChecks />
                <Label>Procedure</Label>
              </HStack>
              <HStack>
                {processData.procedureId && (
                  <Badge variant="secondary">
                    <LuListChecks className="h-3 w-3 mr-1" />
                    Procedure
                  </Badge>
                )}
                <IconButton
                  icon={<LuChevronRight />}
                  aria-label={
                    procedureDisclosure.isOpen
                      ? "Collapse Procedure"
                      : "Expand Procedure"
                  }
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    procedureDisclosure.onToggle();
                  }}
                  className={`transition-transform ${
                    procedureDisclosure.isOpen ? "rotate-90" : ""
                  }`}
                />
              </HStack>
            </HStack>
            <div
              className={`grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-1 pb-4 ${
                procedureDisclosure.isOpen ? "" : "hidden"
              }`}
            >
              <Procedure
                name="procedureId"
                label="Procedure"
                processId={processData.processId}
                value={processData.procedureId}
                isConfigured={rulesByField.has(key("procedureId"))}
                onConfigure={
                  configurable && !temporaryItems[item.id]
                    ? () => {
                        onConfigure({
                          label: "Procedure",
                          field: key("procedureId"),
                          code: rulesByField.get(key("procedureId"))?.code,
                          defaultValue: processData.procedureId,
                          returnType: {
                            type: "text",
                            helperText:
                              "the unique identifier for the procedure. you can get this from the URL when editing a procedure",
                          },
                        });
                      }
                    : undefined
                }
                onChange={(value) => {
                  setProcessData((d) => ({
                    ...d,
                    procedureId: value?.value as string,
                  }));
                }}
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
          <Submit isDisabled={isReadOnly}>Save</Submit>
        </motion.div>
      </motion.div>
    </ValidatedForm>
  );
}

function AttributesForm({
  operationId,
  configurable,
  isDisabled,
  steps,
  temporaryItems,
  rulesByField,
  onConfigure,
}: {
  operationId: string;
  configurable: boolean;
  isDisabled: boolean;
  steps: OperationStep[];
  temporaryItems: TemporaryItems;
  rulesByField: Map<string, ConfigurationRule>;
  onConfigure?: (c: Configuration) => void;
}) {
  const fetcher = useFetcher<typeof newMethodOperationParameterAction>();
  const sortOrderFetcher = useFetcher<{ success: boolean }>();
  const [type, setType] = useState<OperationStep["type"]>("Task");
  const [description, setDescription] = useState<JSONContent>({});
  const [numericControls, setNumericControls] = useState<string[]>([]);

  // Initialize sort order state based on existing steps
  const [sortOrder, setSortOrder] = useState<string[]>(() =>
    [...steps]
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .map((step) => step.id || "")
  );

  // Update sort order when steps change
  useEffect(() => {
    if (steps && steps.length > 0) {
      const sorted = [...steps]
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        .map((step) => step.id || "");
      setSortOrder(sorted);
    }
  }, [steps]);

  const onReorder = (newOrder: string[]) => {
    if (isDisabled) return;

    const updates: Record<string, number> = {};
    newOrder.forEach((id, index) => {
      updates[id] = index + 1;
    });
    setSortOrder(newOrder);
    updateSortOrder(updates);
  };

  const updateSortOrder = useDebounce(
    (updates: Record<string, number>) => {
      let formData = new FormData();
      formData.append("updates", JSON.stringify(updates));
      sortOrderFetcher.submit(formData, {
        method: "post",
        action: path.to.methodOperationStepOrder(operationId),
      });
    },
    1000,
    true
  );
  const typeOptions = useMemo(
    () =>
      procedureStepType.map((type) => ({
        label: (
          <HStack>
            <ProcedureStepTypeIcon type={type} className="mr-2" />
            {type}
          </HStack>
        ),
        value: type,
      })),
    []
  );

  const { carbon } = useCarbon();
  const {
    company: { id: companyId },
  } = useUser();

  const onUploadImage = async (file: File) => {
    const fileType = file.name.split(".").pop();
    const fileName = `${companyId}/parts/${nanoid()}.${fileType}`;

    const result = await carbon?.storage.from("private").upload(fileName, file);

    if (result?.error) {
      toast.error("Failed to upload image");
      throw new Error(result.error.message);
    }

    if (!result?.data) {
      throw new Error("Failed to upload image");
    }

    return getPrivateUrl(result.data.path);
  };

  if (isDisabled && temporaryItems[operationId]) {
    return (
      <Alert className="max-w-[420px] mx-auto my-8">
        <LuTriangleAlert />
        <AlertTitle>Cannot add steps to unsaved operation</AlertTitle>
        <AlertDescription>
          Please save the operation before adding steps.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Loading
      className="flex flex-col gap-6"
      isLoading={fetcher.state !== "idle"}
      // this is a hack to re-render the editor component when the form is submitted with the default values
    >
      {!isDisabled && (
        <div className="p-6 border bg-card rounded-lg mb-6">
          <ValidatedForm
            action={path.to.newMethodOperationStep}
            method="post"
            validator={operationStepValidator}
            fetcher={fetcher}
            resetAfterSubmit
            defaultValues={{
              id: undefined,
              name: "",
              description: {},
              type: "Task",
              unitOfMeasureCode: "",
              minValue: 0,
              maxValue: 0,
              listValues: [],
              sortOrder:
                steps.reduce((acc, a) => Math.max(acc, a.sortOrder ?? 0), 0) +
                1,
              operationId,
            }}
            onSubmit={() => {
              setType("Task");
              setDescription({});
            }}
            className="w-full"
          >
            <Hidden name="operationId" />
            <Hidden name="sortOrder" />
            <Hidden name="description" value={JSON.stringify(description)} />
            <VStack spacing={4}>
              <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                <SelectControlled
                  name="type"
                  label="Type"
                  options={typeOptions}
                  value={type}
                  onChange={(option) => {
                    if (option) {
                      setType(option.value as OperationStep["type"]);
                    }
                  }}
                />
                <Input name="name" label="Name" />
              </div>

              <VStack spacing={2} className="w-full col-span-2">
                <Label>Description</Label>
                <Editor
                  initialValue={description}
                  onUpload={onUploadImage}
                  onChange={(value) => {
                    setDescription(value);
                  }}
                  className="[&_.is-empty]:text-muted-foreground min-h-[120px] p-4 rounded-lg border w-full"
                />
              </VStack>

              {type === "Measurement" && (
                <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                  <UnitOfMeasure
                    name="unitOfMeasureCode"
                    label="Unit of Measure"
                  />

                  <ToggleGroup
                    type="multiple"
                    value={numericControls}
                    onValueChange={setNumericControls}
                    className="justify-start items-start mt-6"
                  >
                    <ToggleGroupItem size="sm" value="min">
                      <LuMinimize2 className="mr-2" />
                      Minimum
                    </ToggleGroupItem>
                    <ToggleGroupItem size="sm" value="max">
                      <LuMaximize2 className="mr-2" />
                      Maximum
                    </ToggleGroupItem>
                  </ToggleGroup>

                  {numericControls.includes("min") && (
                    <Number
                      name="minValue"
                      label="Minimum"
                      formatOptions={{
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 10,
                      }}
                    />
                  )}
                  {numericControls.includes("max") && (
                    <Number
                      name="maxValue"
                      label="Maximum"
                      formatOptions={{
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 10,
                      }}
                    />
                  )}
                </div>
              )}
              {type === "List" && (
                <ArrayInput name="listValues" label="List Options" />
              )}

              <Submit
                leftIcon={<LuCirclePlus />}
                isDisabled={isDisabled || fetcher.state !== "idle"}
                isLoading={fetcher.state !== "idle"}
              >
                Save Step
              </Submit>
            </VStack>
          </ValidatedForm>
        </div>
      )}

      {steps.length > 0 && (
        <div className="border bg-card rounded-lg">
          <Reorder.Group
            axis="y"
            values={sortOrder}
            onReorder={onReorder}
            className="w-full"
          >
            {sortOrder.map((stepId) => {
              const step = steps.find((s) => s.id === stepId);
              if (!step) return null;
              const index = sortOrder.indexOf(stepId);
              return (
                <Reorder.Item
                  key={stepId}
                  value={stepId}
                  dragListener={!isDisabled}
                >
                  <AttributesListItem
                    attribute={step}
                    operationId={operationId}
                    typeOptions={typeOptions}
                    isDisabled={isDisabled}
                    className={
                      index === sortOrder.length - 1 ? "border-none" : ""
                    }
                    configurable={configurable}
                    rulesByField={rulesByField}
                    onConfigure={onConfigure}
                  />
                </Reorder.Item>
              );
            })}
          </Reorder.Group>
        </div>
      )}
      {steps.length === 0 && isDisabled && (
        <div className="flex flex-1 py-24 justify-between items-center w-full">
          <Empty />
        </div>
      )}
    </Loading>
  );
}

function AttributesListItem({
  attribute,
  operationId,
  typeOptions,
  className,
  configurable,
  rulesByField,
  onConfigure,
  isDisabled = false,
}: {
  attribute: OperationStep;
  operationId: string;
  typeOptions: { label: JSX.Element; value: string }[];
  className?: string;
  configurable: boolean;
  rulesByField: Map<string, ConfigurationRule>;
  onConfigure?: (c: Configuration) => void;
  isDisabled?: boolean;
}) {
  const {
    name,
    unitOfMeasureCode,
    minValue,
    maxValue,
    id,
    updatedBy,
    updatedAt,
    createdBy,
    createdAt,
  } = attribute;

  const disclosure = useDisclosure();
  const deleteModalDisclosure = useDisclosure();
  const submitted = useRef(false);
  const fetcher = useFetcher<typeof editMethodOperationStepAction>();

  useEffect(() => {
    if (submitted.current && fetcher.state === "idle") {
      disclosure.onClose();
      submitted.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state]);

  const [type, setType] = useState<OperationStep["type"]>(attribute.type);
  const [numericControls, setNumericControls] = useState<string[]>(() => {
    const controls = [];
    if (type === "Measurement") {
      if (minValue !== null) {
        controls.push("min");
      }
      if (maxValue !== null) {
        controls.push("max");
      }
    }
    return controls;
  });

  const isUpdated = updatedBy !== null;
  const person = isUpdated ? updatedBy : createdBy;
  const date = updatedAt ?? createdAt;

  const unitOfMeasures = useUnitOfMeasure();
  const [description, setDescription] = useState<JSONContent>(
    attribute.description ?? {}
  );

  const { carbon } = useCarbon();
  const {
    company: { id: companyId },
  } = useUser();

  const onUploadImage = async (file: File) => {
    const fileType = file.name.split(".").pop();
    const fileName = `${companyId}/parts/${nanoid()}.${fileType}`;

    const result = await carbon?.storage.from("private").upload(fileName, file);

    if (result?.error) {
      toast.error("Failed to upload image");
      throw new Error(result.error.message);
    }

    if (!result?.data) {
      throw new Error("Failed to upload image");
    }

    return getPrivateUrl(result.data.path);
  };

  if (!id) return null;

  const isConfigured =
    configurable &&
    attribute.type === "Measurement" &&
    (rulesByField.has(getFieldKey(`attribute:${id}:minValue`, operationId)) ||
      rulesByField.has(getFieldKey(`attribute:${id}:maxValue`, operationId)));

  return (
    <div className={cn("border-b p-6", className)}>
      {disclosure.isOpen ? (
        <ValidatedForm
          action={path.to.methodOperationStep(id)}
          method="post"
          validator={operationStepValidator}
          fetcher={fetcher}
          resetAfterSubmit
          onSubmit={() => {
            disclosure.onClose();
          }}
          defaultValues={{
            ...attribute,
            operationId,
          }}
          className="w-full"
        >
          <Hidden name="operationId" />
          <Hidden name="description" value={JSON.stringify(description)} />
          <VStack spacing={4}>
            <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
              <SelectControlled
                name="type"
                label="Type"
                options={typeOptions}
                onChange={(option) => {
                  if (option) {
                    setType(option.value as OperationStep["type"]);
                  }
                }}
              />
              <Input name="name" label="Name" />
            </div>

            <VStack spacing={2} className="w-full col-span-2">
              <Label>Description</Label>
              <Editor
                initialValue={description}
                onUpload={onUploadImage}
                onChange={(value) => {
                  setDescription(value);
                }}
                className="[&_.is-empty]:text-muted-foreground min-h-[120px] p-4 rounded-lg border w-full"
              />
            </VStack>

            {type === "Measurement" && (
              <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                <UnitOfMeasure
                  name="unitOfMeasureCode"
                  label="Unit of Measure"
                />

                <ToggleGroup
                  type="multiple"
                  value={numericControls}
                  onValueChange={setNumericControls}
                  className="justify-start items-start mt-6"
                >
                  <ToggleGroupItem size="sm" value="min">
                    <LuMinimize2 className="mr-2" />
                    Minimum
                  </ToggleGroupItem>
                  <ToggleGroupItem size="sm" value="max">
                    <LuMaximize2 className="mr-2" />
                    Maximum
                  </ToggleGroupItem>
                </ToggleGroup>

                {numericControls.includes("min") && (
                  <Number
                    name="minValue"
                    label="Minimum"
                    formatOptions={{
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 10,
                    }}
                    isConfigured={rulesByField.has(
                      getFieldKey(`attribute:${id}:minValue`, operationId)
                    )}
                    onConfigure={
                      configurable && typeof onConfigure === "function"
                        ? () => {
                            onConfigure({
                              label: "Minimum",
                              field: getFieldKey(
                                `attribute:${id}:minValue`,
                                operationId
                              ),
                              code: rulesByField.get(
                                getFieldKey(
                                  `attribute:${id}:minValue`,
                                  operationId
                                )
                              )?.code,
                              defaultValue: minValue ?? 0,
                              returnType: {
                                type: "numeric",
                              },
                            });
                          }
                        : undefined
                    }
                  />
                )}
                {numericControls.includes("max") && (
                  <Number
                    name="maxValue"
                    label="Maximum"
                    formatOptions={{
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 10,
                    }}
                    isConfigured={rulesByField.has(
                      getFieldKey(`attribute:${id}:maxValue`, operationId)
                    )}
                    onConfigure={
                      configurable && typeof onConfigure === "function"
                        ? () => {
                            onConfigure({
                              label: "Maximum",
                              field: getFieldKey(
                                `attribute:${id}:maxValue`,
                                operationId
                              ),
                              code: rulesByField.get(
                                getFieldKey(
                                  `attribute:${id}:maxValue`,
                                  operationId
                                )
                              )?.code,
                              defaultValue: maxValue ?? 0,
                              returnType: {
                                type: "numeric",
                              },
                            });
                          }
                        : undefined
                    }
                  />
                )}
              </div>
            )}
            {type === "List" && (
              <ArrayInput name="listValues" label="List Options" />
            )}
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
            <IconButton
              aria-label="Drag handle"
              icon={<LuGripVertical />}
              variant="ghost"
              disabled={isDisabled}
              className="cursor-grab"
            />
            <HStack spacing={4} className="flex-1">
              <div className="bg-muted border rounded-full flex items-center justify-center p-2">
                <ProcedureStepTypeIcon type={type} />
              </div>
              <VStack spacing={0}>
                <HStack>
                  <p className="text-foreground text-sm font-medium">
                    {attribute.name}
                  </p>
                  {attribute.description &&
                    Object.keys(attribute.description).length > 0 && (
                      <Tooltip>
                        <TooltipTrigger>
                          <LuInfo className="text-muted-foreground size-3" />
                        </TooltipTrigger>
                        <TooltipContent side="right">
                          <p
                            className="prose prose-sm dark:prose-invert text-foreground text-sm"
                            dangerouslySetInnerHTML={{
                              __html: generateHTML(attribute.description),
                            }}
                          />
                        </TooltipContent>
                      </Tooltip>
                    )}
                </HStack>
                {attribute.type === "Measurement" && (
                  <span className="text-xs text-muted-foreground">
                    {attribute.minValue !== null && attribute.maxValue !== null
                      ? `Must be between ${attribute.minValue} and ${
                          attribute.maxValue
                        } ${
                          unitOfMeasures.find(
                            (u) => u.value === unitOfMeasureCode
                          )?.label
                        }`
                      : attribute.minValue !== null
                      ? `Must be > ${attribute.minValue} ${
                          unitOfMeasures.find(
                            (u) => u.value === unitOfMeasureCode
                          )?.label
                        }`
                      : attribute.maxValue !== null
                      ? `Must be < ${attribute.maxValue} ${
                          unitOfMeasures.find(
                            (u) => u.value === unitOfMeasureCode
                          )?.label
                        }`
                      : null}
                  </span>
                )}
              </VStack>
              {isConfigured && (
                <Tooltip>
                  <TooltipTrigger>
                    <div className="flex flex-col items-center justify-center gap-1 text-emerald-500">
                      <LuSquareFunction
                        aria-label="Configured"
                        className="size-4 "
                      />
                      <span className="text-xxs font-mono uppercase">
                        Configured
                      </span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-foreground text-sm">
                      This attribute is configured
                    </p>
                  </TooltipContent>
                </Tooltip>
              )}
              {attribute.type === "List" &&
                Array.isArray(attribute.listValues) && (
                  <Tooltip>
                    <TooltipTrigger>
                      <LuList className="size-4 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      {attribute.listValues.map((value) => (
                        <p key={value} className="text-foreground text-sm">
                          {value}
                        </p>
                      ))}
                    </TooltipContent>
                  </Tooltip>
                )}
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
                  icon={<LuEllipsisVertical />}
                  variant="ghost"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={disclosure.onOpen}>
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  destructive
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
          action={path.to.deleteMethodOperationStep(id)}
          isOpen={deleteModalDisclosure.isOpen}
          name={name}
          text={`Are you sure you want to delete the ${name} attribute from this operation? This cannot be undone.`}
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

function ParametersForm({
  operationId,
  configurable,
  isDisabled,
  parameters,
  temporaryItems,
  rulesByField,
  onConfigure,
}: {
  operationId: string;
  configurable: boolean;
  isDisabled: boolean;
  parameters: OperationParameter[];
  temporaryItems: TemporaryItems;
  rulesByField: Map<string, ConfigurationRule>;
  onConfigure?: (c: Configuration) => void;
}) {
  const fetcher = useFetcher<typeof newMethodOperationParameterAction>();

  if (isDisabled && temporaryItems[operationId]) {
    return (
      <Alert className="max-w-[420px] mx-auto my-8">
        <LuTriangleAlert />
        <AlertTitle>Cannot add parameters to unsaved operation</AlertTitle>
        <AlertDescription>
          Please save the operation before adding parameters.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {!isDisabled && (
        <div className="p-6 border rounded-lg bg-card">
          <ValidatedForm
            action={path.to.newMethodOperationParameter}
            method="post"
            validator={operationParameterValidator}
            fetcher={fetcher}
            resetAfterSubmit
            defaultValues={{
              id: undefined,
              key: "",
              value: "",
              operationId,
            }}
            className="w-full"
          >
            <Hidden name="operationId" />
            <VStack spacing={4}>
              <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                <Input
                  name="key"
                  label="Key"
                  autoFocus={parameters.length === 0}
                />
                <Input name="value" label="Value" />
              </div>
              <Submit
                leftIcon={<LuCirclePlus />}
                isDisabled={isDisabled || fetcher.state !== "idle"}
                isLoading={fetcher.state !== "idle"}
              >
                Add Parameter
              </Submit>
            </VStack>
          </ValidatedForm>
        </div>
      )}

      {parameters.length > 0 && (
        <div className="border bg-card rounded-lg">
          {[...parameters]
            .sort((a, b) =>
              String(a.id ?? "").localeCompare(String(b.id ?? ""))
            )
            .map((p, index) => (
              <ParametersListItem
                key={p.id}
                parameter={p}
                operationId={operationId}
                className={index === parameters.length - 1 ? "border-none" : ""}
                configurable={configurable}
                rulesByField={rulesByField}
                onConfigure={onConfigure}
              />
            ))}
        </div>
      )}
      {parameters.length === 0 && isDisabled && (
        <div className="flex flex-1 py-24 justify-between items-center w-full">
          <Empty />
        </div>
      )}
    </div>
  );
}

function ParametersListItem({
  parameter: { key, value, id, updatedBy, updatedAt, createdBy, createdAt },
  operationId,
  className,
  configurable,
  rulesByField,
  onConfigure,
}: {
  parameter: OperationParameter;
  operationId: string;
  className?: string;
  configurable: boolean;
  rulesByField: Map<string, ConfigurationRule>;
  onConfigure?: (c: Configuration) => void;
}) {
  const disclosure = useDisclosure();
  const deleteModalDisclosure = useDisclosure();
  const submitted = useRef(false);
  const fetcher = useFetcher<typeof editMethodOperationParameterAction>();

  useEffect(() => {
    if (submitted.current && fetcher.state === "idle") {
      disclosure.onClose();
      submitted.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state]);

  const isUpdated = updatedBy !== null;
  const person = isUpdated ? updatedBy : createdBy;
  const date = updatedAt ?? createdAt;

  if (!id) return null;

  const isConfigured = rulesByField.has(
    getFieldKey(`parameter:${id}:value`, operationId)
  );

  return (
    <div className={cn("border-b p-6", className)}>
      {disclosure.isOpen ? (
        <ValidatedForm
          action={path.to.methodOperationParameter(id)}
          method="post"
          validator={operationParameterValidator}
          fetcher={fetcher}
          resetAfterSubmit
          onSubmit={() => {
            disclosure.onClose();
          }}
          defaultValues={{
            id: id,
            key: key ?? "",
            value: value ?? "",
            operationId,
          }}
          className="w-full"
        >
          <Hidden name="operationId" />
          <VStack spacing={4}>
            <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
              <Input name="key" label="Key" />
              <Input
                name="value"
                label="Value"
                isConfigured={isConfigured}
                onConfigure={
                  configurable && typeof onConfigure === "function"
                    ? () => {
                        onConfigure({
                          label: key,
                          field: getFieldKey(
                            `parameter:${id}:value`,
                            operationId
                          ),
                          code: rulesByField.get(
                            getFieldKey(`parameter:${id}:value`, operationId)
                          )?.code,
                          defaultValue: value,
                          returnType: {
                            type: "text",
                          },
                        });
                      }
                    : undefined
                }
              />
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
                <LuActivity
                  className={cn("size-4", isConfigured && "text-emerald-500")}
                />
              </div>
              <VStack spacing={0}>
                <span className="text-sm font-medium">{key}</span>
              </VStack>
              {isConfigured ? (
                <Tooltip>
                  <TooltipTrigger>
                    <div className="flex flex-col items-center justify-center gap-1 text-emerald-500">
                      <LuSquareFunction
                        aria-label="Configured"
                        className="size-4 "
                      />
                      <span className="text-xxs font-mono uppercase">
                        Configured
                      </span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-foreground text-sm">
                      This value is configured
                    </p>
                  </TooltipContent>
                </Tooltip>
              ) : (
                <span className="text-base text-muted-foreground text-right">
                  {value}
                </span>
              )}
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
                  icon={<LuEllipsisVertical />}
                  variant="ghost"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={disclosure.onOpen}>
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  destructive
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
          action={path.to.deleteMethodOperationParameter(id)}
          isOpen={deleteModalDisclosure.isOpen}
          name={key}
          text={`Are you sure you want to delete the ${key} parameter from this operation? This cannot be undone.`}
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
  temporaryItems,
}: {
  operationId: string;
  isDisabled: boolean;
  tools: OperationTool[];
  temporaryItems: TemporaryItems;
}) {
  const fetcher = useFetcher<typeof newMethodOperationToolAction>();

  if (isDisabled && temporaryItems[operationId]) {
    return (
      <Alert className="max-w-[420px] mx-auto my-8">
        <LuTriangleAlert />
        <AlertTitle>Cannot add tools to unsaved operation</AlertTitle>
        <AlertDescription>
          Please save the operation before adding tools.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {!isDisabled && (
        <div className="p-6 border rounded-lg">
          <ValidatedForm
            action={path.to.newMethodOperationTool}
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
              <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                <Tool
                  name="toolId"
                  label="Tool"
                  autoFocus={tools.length === 0}
                />
                <Number name="quantity" label="Quantity" />
              </div>

              <Submit
                leftIcon={<LuCirclePlus />}
                isDisabled={isDisabled || fetcher.state !== "idle"}
                isLoading={fetcher.state !== "idle"}
              >
                Save Tool
              </Submit>
            </VStack>
          </ValidatedForm>
        </div>
      )}

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
      {tools.length === 0 && isDisabled && (
        <div className="flex flex-1 py-24 justify-between items-center w-full">
          <Empty />
        </div>
      )}
    </div>
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
  const fetcher = useFetcher<typeof editMethodOperationToolAction>();

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
          action={path.to.methodOperationTool(id)}
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
            <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
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
                <span className="text-sm font-medium">
                  {tool.readableIdWithRevision}
                </span>
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
                  icon={<LuEllipsisVertical />}
                  variant="ghost"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={disclosure.onOpen}>
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  destructive
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
          action={path.to.deleteMethodOperationTool(id)}
          isOpen={deleteModalDisclosure.isOpen}
          name={tool.readableIdWithRevision}
          text={`Are you sure you want to delete ${tool.readableIdWithRevision} from this operation? This cannot be undone.`}
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

function makeItems(
  operations: Operation[],
  tags: { name: string }[]
): ItemWithData[] {
  return operations.map((operation) => makeItem(operation, tags));
}

function makeItem(
  operation: Operation,
  tags: { name: string }[]
): ItemWithData {
  return {
    id: operation.id!,
    title: (
      <VStack spacing={0}>
        <h3 className="font-semibold truncate cursor-pointer">
          {operation.description}
        </h3>
        {operation.operationType === "Outside" && (
          <SupplierProcessPreview
            processId={operation.processId}
            supplierProcessId={operation.operationSupplierProcessId}
          />
        )}
      </VStack>
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

function usePendingOperations() {
  type PendingItem = ReturnType<typeof useFetchers>[number] & {
    formData: FormData;
  };

  return useFetchers()
    .filter((fetcher): fetcher is PendingItem => {
      return (
        (fetcher.formAction === path.to.newMethodOperation ||
          fetcher.formAction?.includes("/items/methods/operation/")) ??
        false
      );
    })
    .reduce<z.infer<typeof methodOperationValidator>[]>((acc, fetcher) => {
      const formData = fetcher.formData;
      const operation = methodOperationValidator.safeParse(
        Object.fromEntries(formData)
      );

      if (operation.success) {
        return [...acc, operation.data];
      }
      return acc;
    }, []);
}

function getFieldKey(field: string, operationId: string) {
  return `${field}:${operationId}`;
}

export function MethodOperationTags({
  operation,
  availableTags,
}: {
  operation: Operation;
  availableTags: { name: string }[];
}) {
  const { onUpdateTags } = useTags({
    id: operation.id,
    table: "methodOperation",
  });

  return (
    <ValidatedForm
      defaultValues={{
        tags: operation.tags ?? [],
      }}
      validator={z.object({
        tags: z.array(z.string()).optional(),
      })}
    >
      <Tags
        availableTags={availableTags}
        label=""
        name="tags"
        table="operation"
        inline
        maxPreview={3}
        onChange={onUpdateTags}
      />
    </ValidatedForm>
  );
}
