"use client";
import { useCarbon } from "@carbon/auth";
import type { Database } from "@carbon/database";
import { Array as ArrayInput, Input, ValidatedForm } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Avatar,
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Count,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Input as InputField,
  Label,
  Loading,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ScrollArea,
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
  useMount,
} from "@carbon/react";
import { Editor, generateHTML } from "@carbon/react/Editor";
import {
  formatDateTime,
  formatDurationMilliseconds,
  formatRelativeTime,
} from "@carbon/utils";
import { getLocalTimeZone, today } from "@internationalized/date";
import { useFetcher, useFetchers, useParams } from "@remix-run/react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { nanoid } from "nanoid";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  LuActivity,
  LuChevronRight,
  LuCirclePlus,
  LuDollarSign,
  LuEllipsisVertical,
  LuHammer,
  LuInfo,
  LuListChecks,
  LuMaximize2,
  LuMinimize2,
  LuPaperclip,
  LuRefreshCcw,
  LuSend,
  LuSettings2,
  LuTriangleAlert,
  LuX,
} from "react-icons/lu";
import type { z } from "zod";
import {
  Assignee,
  DirectionAwareTabs,
  EmployeeAvatar,
  Empty,
  TimeTypeIcon,
} from "~/components";
import Activity from "~/components/Activity";
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
} from "~/components/Form";
import { getUnitHint } from "~/components/Form/UnitHint";
import InfiniteScroll from "~/components/InfiniteScroll";
import { ConfirmDelete } from "~/components/Modals";
import type { Item, SortableItemRenderProps } from "~/components/SortableList";
import { SortableList, SortableListItem } from "~/components/SortableList";
import { usePermissions, useRouteData, useUrlParams, useUser } from "~/hooks";
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
} from "~/modules/shared";

import type { action as editJobOperationParameterAction } from "~/routes/x+/job+/methods+/operation.parameter.$id";
import type { action as newJobOperationParameterAction } from "~/routes/x+/job+/methods+/operation.parameter.new";
import type { action as editJobOperationStepAction } from "~/routes/x+/job+/methods+/operation.step.$id";
import type { action as editJobOperationToolAction } from "~/routes/x+/job+/methods+/operation.tool.$id";
import type { action as newJobOperationToolAction } from "~/routes/x+/job+/methods+/operation.tool.new";

import { useNumberFormatter } from "@react-aria/i18n";
import Procedure from "~/components/Form/Procedure";
import { SupplierProcessPreview } from "~/components/Form/SupplierProcess";
import UnitOfMeasure, {
  useUnitOfMeasure,
} from "~/components/Form/UnitOfMeasure";
import { ProcedureStepTypeIcon } from "~/components/Icons";
import { usePeople, useTools } from "~/stores";
import { getPrivateUrl, path } from "~/utils/path";
import {
  jobOperationValidator,
  jobOperationValidatorForReleasedJob,
  procedureSyncValidator,
} from "../../production.models";
import { getProductionEventsPage } from "../../production.service";
import type { Job, JobOperation } from "../../types";
import { JobOperationStatus, JobOperationTags } from "./JobOperationStatus";

export type Operation = z.infer<typeof jobOperationValidator> & {
  assignee: string | null;
  status: JobOperation["status"];
  tags: string[] | null;
  workInstruction: JSONContent | null;
};

type ItemWithData = Item & {
  data: Operation;
};

type JobOperationStep = OperationStep & {
  jobOperationStepRecord?:
    | Database["public"]["Tables"]["jobOperationStepRecord"]["Row"]
    | null;
};

type JobBillOfProcessProps = {
  jobMakeMethodId: string;
  locationId: string;
  operations: (Operation & {
    jobOperationTool: OperationTool[];
    jobOperationParameter: OperationParameter[];
    jobOperationStep: JobOperationStep[];
  })[];
  tags: { name: string }[];
};

function makeItems(
  operations: Operation[],
  tags: { name: string }[],
  temporaryItems: TemporaryItems
): ItemWithData[] {
  return operations.map((operation) =>
    makeItem(operation, tags, temporaryItems)
  );
}

function makeItem(
  operation: Operation,
  tags: { name: string }[],
  temporaryItems: TemporaryItems
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
    footer: temporaryItems[operation.id!] ? null : (
      <HStack className="w-full justify-between">
        <HStack>
          <JobOperationStatus operation={operation} />
          <Assignee
            table="jobOperation"
            id={operation.id!}
            size="sm"
            value={operation.assignee ?? undefined}
          />
        </HStack>

        <JobOperationTags operation={operation} availableTags={tags} />
      </HStack>
    ),
    data: operation,
  };
}

const initialOperation: Omit<
  Operation,
  "jobMakeMethodId" | "order" | "jobOperationTool" | "id"
> = {
  assignee: null,
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
  procedureId: "",
  setupTime: 0,
  setupUnit: "Total Minutes",
  status: "Todo",
  tags: [],
  workCenterId: "",
  workInstruction: {},
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

const usePendingOperations = () => {
  type PendingItem = ReturnType<typeof useFetchers>[number] & {
    formData: FormData;
  };
  const { jobId } = useParams();
  if (!jobId) throw new Error("jobId not found");

  return useFetchers()
    .filter((fetcher): fetcher is PendingItem => {
      return (
        (fetcher.formAction === path.to.newJobOperation(jobId) ||
          fetcher.formAction?.includes(`/job/methods/${jobId}/operation`)) ??
        false
      );
    })
    .reduce<z.infer<typeof jobOperationValidator>[]>((acc, fetcher) => {
      const formData = fetcher.formData;
      const operation = jobOperationValidator.safeParse(
        Object.fromEntries(formData)
      );

      if (operation.success) {
        return [...acc, operation.data];
      }
      return acc;
    }, []);
};

const JobBillOfProcess = ({
  jobMakeMethodId,
  locationId,
  operations: initialOperations,
  tags,
}: JobBillOfProcessProps) => {
  const { carbon, accessToken } = useCarbon();
  const sortOrderFetcher = useFetcher<{}>();
  const deleteOperationFetcher = useFetcher<{ success: boolean }>();
  const permissions = usePermissions();
  const {
    id: userId,
    company: { id: companyId },
  } = useUser();

  const [params] = useUrlParams();
  const selected = params.get("selectedOperation");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(
    selected ? selected : null
  );

  const { jobId } = useParams();
  if (!jobId) throw new Error("jobId not found");
  const jobData = useRouteData<{ job: Job }>(path.to.job(jobId));
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
    Operation & { jobOperationTool: OperationTool[] }
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
        assignee: null,
        status: "Todo",
        workInstruction: {},
        jobOperationTool: [],
        tags: [],
      });
    } else {
      operationsById.set(pendingOperation.id, {
        ...operationsById.get(pendingOperation.id)!,
        ...pendingOperation,
      });
    }
  });

  // Add temporary items
  Object.entries(temporaryItems).forEach(([id, operation]) => {
    operationsById.set(id, {
      ...operation,
      jobOperationTool: [],
    });
  });

  const operations = Array.from(operationsById.values()).sort(
    (a, b) => (orderState[a.id!] ?? a.order) - (orderState[b.id!] ?? b.order)
  );

  const items = makeItems(operations, tags, temporaryItems).map((item) => ({
    ...item,
    checked: checkedState[item.id] ?? false,
  }));

  const isDisabled = ["Completed", "Cancelled"].includes(
    jobData?.job?.status ?? ""
  );

  const onToggleItem = (id: string) => {
    if (!permissions.can("update", "parts")) return;
    setCheckedState((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

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
      jobMakeMethodId,
    };

    setTemporaryItems((prev) => ({
      ...prev,
      [operationId]: newOperation,
    }));
    setSelectedItemId(operationId);
  };

  const onRemoveItem = async (id: string) => {
    if (!permissions.can("update", "production")) return;

    const operation = operationsById.get(id);
    if (!operation) return;

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
          action: path.to.jobOperationsDelete(jobId),
        }
      );
    }

    setSelectedItemId(null);
    setOrderState((prev) => {
      const { [id]: _, ...rest } = prev;
      return rest;
    });
  };

  const onReorder = (items: ItemWithData[]) => {
    if (!permissions.can("update", "production") || isDisabled) return;
    const newItems = items.map((item, index) => ({
      ...item,
      data: {
        ...item.data,
        order: index + 1,
      },
    }));
    const updates = newItems.reduce<Record<string, number>>((acc, item) => {
      if (!temporaryItems[item.id]) {
        acc[item.id] = item.data.order;
      }
      return acc;
    }, {});

    setOrderState((prev) => ({
      ...prev,
      ...updates,
    }));
    updateSortOrder(updates);
  };

  const updateSortOrder = useDebounce(
    (updates: Record<string, number>) => {
      let formData = new FormData();
      formData.append("updates", JSON.stringify(updates));
      sortOrderFetcher.submit(formData, {
        method: "post",
        action: path.to.jobOperationsOrder(jobId),
      });
    },
    1000,
    true
  );

  const onCloseOnDrag = useCallback(() => {
    setCheckedState({});
  }, []);

  const onUpdateWorkInstruction = useDebounce(
    async (content: JSONContent) => {
      if (selectedItemId !== null && !temporaryItems[selectedItemId])
        await carbon
          ?.from("jobOperation")
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

  const [productionEvents, setProductionEvents] = useState<
    Database["public"]["Tables"]["productionEvent"]["Row"][]
  >([]);
  const [page, setPage] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (
      !channelRef.current &&
      carbon &&
      accessToken &&
      selectedItemId &&
      !temporaryItems[selectedItemId]
    ) {
      carbon.realtime.setAuth(accessToken);

      channelRef.current = carbon
        .channel(`production-events:${selectedItemId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "productionEvent",
            filter: `jobOperationId=eq.${selectedItemId}`,
          },
          (payload) => {
            switch (payload.eventType) {
              case "INSERT":
                const { new: inserted } = payload;
                setProductionEvents((prevEvents) => [
                  ...prevEvents,
                  inserted as Database["public"]["Tables"]["productionEvent"]["Row"],
                ]);
                break;
              case "UPDATE":
                const { new: updated } = payload;
                setProductionEvents((prevEvents) =>
                  prevEvents.map((event) =>
                    event.id === updated.id
                      ? (updated as Database["public"]["Tables"]["productionEvent"]["Row"])
                      : event
                  )
                );
                break;
              case "DELETE":
                const { old: deleted } = payload;
                setProductionEvents((prevEvents) =>
                  prevEvents.filter((event) => event.id !== deleted.id)
                );
                break;
              default:
                break;
            }
          }
        )
        .subscribe();
    }

    return () => {
      if (channelRef.current) {
        channelRef.current.unsubscribe();
        carbon?.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItemId]);

  useEffect(() => {
    if (carbon && accessToken && channelRef.current)
      carbon.realtime.setAuth(accessToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const loadMoreProductionEvents = useCallback(async () => {
    if (isLoading || !hasMore || !selectedItemId) return;

    setIsLoading(true);

    const newProductionEvents = await getProductionEventsPage(
      carbon!,
      selectedItemId,
      companyId,
      false,
      page + 1
    );

    if (newProductionEvents.data && newProductionEvents.data.length > 0) {
      setProductionEvents((prev) => [...prev, ...newProductionEvents.data]);
      setPage((prevPage) => prevPage + 1);
    } else {
      setHasMore(false);
    }

    setIsLoading(false);
  }, [isLoading, hasMore, carbon, selectedItemId, companyId, page]);

  const [tabChangeRerender, setTabChangeRerender] = useState<number>(1);

  useEffect(() => {
    if (initialOperations) {
      setWorkInstructions(
        initialOperations.reduce((acc, operation) => {
          if (operation.workInstruction && operation.id) {
            acc[operation.id] = operation.workInstruction;
          }
          return acc;
        }, {} as PendingWorkInstructions)
      );
    }
  }, [initialOperations]);

  const renderListItem = ({
    item,
    items,
    order,
    onToggleItem,
    onRemoveItem,
  }: SortableItemRenderProps<ItemWithData>) => {
    const isOpen = item.id === selectedItemId;

    const tools =
      initialOperations.find((o) => o.id === item.id)?.jobOperationTool ?? [];
    const parameters =
      initialOperations.find((o) => o.id === item.id)?.jobOperationParameter ??
      [];
    const steps =
      initialOperations.find((o) => o.id === item.id)?.jobOperationStep ?? [];

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
                job={jobData?.job}
                locationId={locationId}
                workInstruction={workInstructions[item.id] ?? {}}
                setWorkInstructions={setWorkInstructions}
                setTemporaryItems={setTemporaryItems}
                setSelectedItemId={setSelectedItemId}
                temporaryItems={temporaryItems}
              />
            </motion.div>
          </div>
        ),
      },
      {
        id: 1,
        label: "Instructions",
        disabled:
          item.id in temporaryItems || item.data.operationType === "Outside",
        content: (
          <div className="flex flex-col">
            <div>
              {permissions.can("update", "parts") ? (
                <Editor
                  initialValue={
                    workInstructions[item.id] ?? ({} as JSONContent)
                  }
                  onUpload={onUploadImage}
                  onChange={(content) => {
                    if (!permissions.can("update", "production")) return;
                    setWorkInstructions((prev) => ({
                      ...prev,
                      [item.id]: content,
                    }));
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
        disabled:
          item.id in temporaryItems || item.data.operationType === "Outside",
        label: (
          <span className="flex items-center gap-2">
            <span>Params</span>
            {parameters.length > 0 && <Count count={parameters.length} />}
          </span>
        ),
        content: (
          <div className="flex w-full flex-col py-4">
            <ParametersForm
              parameters={parameters}
              operationId={item.id!}
              isDisabled={
                selectedItemId === null || !!temporaryItems[selectedItemId]
              }
              temporaryItems={temporaryItems}
            />
          </div>
        ),
      },
      {
        id: 3,
        disabled:
          item.id in temporaryItems || item.data.operationType === "Outside",
        label: (
          <span className="flex items-center gap-2">
            <span>Steps</span>
            {steps.length > 0 && <Count count={steps.length} />}
          </span>
        ),
        content: (
          <div className="flex w-full flex-col py-4">
            <StepsForm
              steps={steps}
              operationId={item.id!}
              isDisabled={
                selectedItemId === null || !!temporaryItems[selectedItemId]
              }
              temporaryItems={temporaryItems}
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
              isDisabled={
                selectedItemId === null || !!temporaryItems[selectedItemId]
              }
              temporaryItems={temporaryItems}
            />
          </div>
        ),
      },
      {
        id: 5,
        disabled:
          item.id in temporaryItems || item.data.operationType === "Outside",
        label: "Events",
        content: (
          <div className="flex w-full flex-col pr-2 py-6 min-h-[300px]">
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
              <InfiniteScroll
                component={ProductionEventActivity}
                items={productionEvents}
                loadMore={loadMoreProductionEvents}
                hasMore={hasMore}
              />
            </motion.div>
          </div>
        ),
      },
      {
        id: 6,
        disabled:
          item.id in temporaryItems || item.data.operationType === "Outside",
        label: "Chat",
        content: <OperationChat jobOperationId={item.id} />,
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
              !permissions.can("update", "production") ||
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

export default JobBillOfProcess;

function StepsForm({
  operationId,
  isDisabled,
  steps,
  temporaryItems,
}: {
  operationId: string;
  isDisabled: boolean;
  steps: JobOperationStep[];
  temporaryItems: TemporaryItems;
}) {
  const fetcher = useFetcher<typeof newJobOperationParameterAction>();
  const [type, setType] = useState<OperationStep["type"]>("Task");
  const [description, setDescription] = useState<JSONContent>({});
  const [numericControls, setNumericControls] = useState<string[]>([]);
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
    >
      <div className="p-6 border rounded-lg bg-card mb-6">
        <ValidatedForm
          action={path.to.newJobOperationStep}
          method="post"
          validator={operationStepValidator}
          fetcher={fetcher}
          resetAfterSubmit
          defaultValues={{
            id: undefined,
            name: "",
            description: "",
            type: "Task",
            unitOfMeasureCode: "",
            minValue: 0,
            maxValue: 0,
            listValues: [],
            sortOrder:
              steps.reduce((acc, a) => Math.max(acc, a.sortOrder ?? 0), 0) + 1,
            operationId,
          }}
          onSubmit={() => {
            setType("Value");
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

      {steps.length > 0 && (
        <div className="border rounded-lg ">
          {[...steps]
            .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
            .map((a, index) => (
              <StepsListItem
                key={a.id}
                attribute={a}
                operationId={operationId}
                typeOptions={typeOptions}
                className={index === steps.length - 1 ? "border-none" : ""}
              />
            ))}
        </div>
      )}
    </Loading>
  );
}

function StepsListItem({
  attribute,
  operationId,
  typeOptions,
  className,
}: {
  attribute: JobOperationStep;
  operationId: string;
  typeOptions: { label: JSX.Element; value: string }[];
  className?: string;
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
  const fetcher = useFetcher<typeof editJobOperationStepAction>();
  const [description, setDescription] = useState<JSONContent>(() => {
    try {
      return attribute.description ? JSON.parse(attribute.description) : {};
    } catch (e) {
      return {};
    }
  });

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

  return (
    <div className={cn("border-b p-6", className)}>
      {disclosure.isOpen ? (
        <ValidatedForm
          action={path.to.jobOperationStep(id)}
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
                <ProcedureStepTypeIcon type={type} />
              </div>
              <VStack spacing={0}>
                <HStack>
                  <p className="text-foreground text-sm font-medium">
                    {attribute.name}
                  </p>
                  {attribute.description &&
                  Object.keys(attribute.description).length > 0 ? (
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
                  ) : null}
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
              {attribute.jobOperationStepRecord && (
                <PreviewStepRecord attribute={attribute} />
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
          action={path.to.deleteJobOperationStep(id)}
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

function PreviewStepRecord({ attribute }: { attribute: JobOperationStep }) {
  const unitOfMeasures = useUnitOfMeasure();
  const [employees] = usePeople();
  const numberFormatter = useNumberFormatter();

  if (!attribute.jobOperationStepRecord) return null;
  return (
    <div className="min-w-[200px] truncate text-right font-medium">
      {attribute.type === "Checkbox" && (
        <Checkbox
          checked={attribute.jobOperationStepRecord.booleanValue ?? false}
        />
      )}
      {attribute.type === "Value" && (
        <p className="text-sm">{attribute.jobOperationStepRecord.value}</p>
      )}
      {attribute.type === "Measurement" &&
        typeof attribute.jobOperationStepRecord?.numericValue === "number" && (
          <p
            className={cn(
              "text-sm",
              attribute.minValue !== null &&
                attribute.minValue !== undefined &&
                attribute.jobOperationStepRecord.numericValue <
                  attribute.minValue &&
                "text-red-500",
              attribute.maxValue !== null &&
                attribute.maxValue !== undefined &&
                attribute.jobOperationStepRecord.numericValue >
                  attribute.maxValue &&
                "text-red-500"
            )}
          >
            {numberFormatter.format(
              attribute.jobOperationStepRecord.numericValue
            )}{" "}
            {
              unitOfMeasures.find(
                (u) => u.value === attribute.unitOfMeasureCode
              )?.label
            }
          </p>
        )}
      {attribute.type === "Timestamp" && (
        <p className="text-sm">
          {formatDateTime(attribute.jobOperationStepRecord.value ?? "")}
        </p>
      )}
      {attribute.type === "List" && (
        <p className="text-sm">{attribute.jobOperationStepRecord.value}</p>
      )}
      {attribute.type === "Person" && (
        <p className="text-sm">
          {
            employees.find(
              (e) => e.id === attribute.jobOperationStepRecord?.userValue
            )?.name
          }
        </p>
      )}
      {attribute.type === "File" && attribute.jobOperationStepRecord?.value && (
        <div className="flex justify-end gap-2 text-sm">
          <LuPaperclip className="size-4 text-muted-foreground" />
          <a
            href={getPrivateUrl(attribute.jobOperationStepRecord.value)}
            target="_blank"
            rel="noopener noreferrer"
          >
            View File
          </a>
        </div>
      )}
    </div>
  );
}

function ParametersForm({
  operationId,
  isDisabled,
  parameters,
  temporaryItems,
}: {
  operationId: string;
  isDisabled: boolean;
  parameters: OperationParameter[];
  temporaryItems: TemporaryItems;
}) {
  const fetcher = useFetcher<typeof newJobOperationParameterAction>();

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
      <div className="p-6 border rounded-lg bg-card">
        <ValidatedForm
          action={path.to.newJobOperationParameter}
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

      {parameters.length > 0 && (
        <div className="border rounded-lg">
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
              />
            ))}
        </div>
      )}
    </div>
  );
}

function ParametersListItem({
  parameter: { key, value, id, updatedBy, updatedAt, createdBy, createdAt },
  operationId,
  className,
}: {
  parameter: OperationParameter;
  operationId: string;
  className?: string;
}) {
  const disclosure = useDisclosure();
  const deleteModalDisclosure = useDisclosure();
  const submitted = useRef(false);
  const fetcher = useFetcher<typeof editJobOperationParameterAction>();

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

  return (
    <div className={cn("border-b p-6", className)}>
      {disclosure.isOpen ? (
        <ValidatedForm
          action={path.to.jobOperationParameter(id)}
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
              <Input name="value" label="Value" />
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
                <LuActivity className="size-4" />
              </div>
              <VStack spacing={0}>
                <span className="text-sm font-medium">{key}</span>
              </VStack>
              <span className="text-base text-muted-foreground">{value}</span>
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
          action={path.to.deleteJobOperationParameter(id)}
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

function OperationForm({
  item,
  isDisabled,
  job,
  locationId,
  workInstruction,
  setWorkInstructions,
  setTemporaryItems,
  setSelectedItemId,
  temporaryItems,
}: {
  item: ItemWithData;
  isDisabled: boolean;
  job?: Job;
  locationId: string;
  workInstruction: JSONContent;
  setWorkInstructions: Dispatch<SetStateAction<PendingWorkInstructions>>;
  setTemporaryItems: Dispatch<SetStateAction<TemporaryItems>>;
  setSelectedItemId: Dispatch<SetStateAction<string | null>>;
  temporaryItems: TemporaryItems;
}) {
  const { jobId } = useParams();
  const { company } = useUser();
  if (!jobId) throw new Error("jobId not found");

  const fetcher = useFetcher<{ id: string }>();
  const { carbon } = useCarbon();
  const baseCurrency = company?.baseCurrencyCode ?? "USD";

  useEffect(() => {
    if (fetcher.data && fetcher.data.id) {
      // Clear temporary item after successful save
      setTemporaryItems((prev) => {
        const { [item.id]: _, ...rest } = prev;
        return rest;
      });
    }
  }, [item.id, fetcher.data, setTemporaryItems]);

  const machineDisclosure = useDisclosure();
  const laborDisclosure = useDisclosure();
  const setupDisclosure = useDisclosure();
  const costingDisclosure = useDisclosure();
  const procedureDisclosure = useDisclosure();
  const [procedureWasChanged, setProcedureWasChanged] = useState(false);
  const procedureSyncDisclosure = useDisclosure();

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
    procedureId: string;
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
    procedureId: item.data.procedureId ?? "",
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
      procedureId: "",
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
      operationUnitCost: item.data.operationUnitCost ?? 0,
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
      operationUnitCost: 0, // TODO: get the unit cost from the purchase order history
      operationLeadTime: data?.leadTime ?? 0,
    }));
  };

  return (
    <ValidatedForm
      action={
        temporaryItems[item.id]
          ? path.to.newJobOperation(jobId)
          : path.to.jobOperation(jobId, item.id!)
      }
      method="post"
      defaultValues={item.data}
      validator={
        ["Draft", "Planned"].includes(job?.status ?? "")
          ? jobOperationValidator
          : jobOperationValidatorForReleasedJob
      }
      className="w-full flex flex-col gap-y-4"
      fetcher={fetcher}
    >
      <div>
        <Hidden name="id" />
        <Hidden name="jobMakeMethodId" />
        <Hidden name="order" />
      </div>
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
            autoSelectSingleOption={Boolean(processData.processId)}
            locationId={locationId}
            isOptional={["Draft", "Planned"].includes(job?.status ?? "")}
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
              onClick={machineDisclosure.onToggle}
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
              onClick={costingDisclosure.onToggle}
            >
              <HStack>
                <LuDollarSign />
                <Label>Costing</Label>
              </HStack>
              <HStack>
                <IconButton
                  icon={<LuChevronRight />}
                  aria-label={
                    costingDisclosure.isOpen
                      ? "Collapse Costing"
                      : "Expand Costing"
                  }
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    costingDisclosure.onToggle();
                  }}
                  className={`transition-transform ${
                    costingDisclosure.isOpen ? "rotate-90" : ""
                  }`}
                />
              </HStack>
            </HStack>
            <div
              className={`grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3 pb-4 ${
                costingDisclosure.isOpen ? "" : "hidden"
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
                onChange={(value) => {
                  if (value && value.value !== item.data.procedureId) {
                    setProcedureWasChanged(true);
                  }
                  setProcessData((d) => ({
                    ...d,
                    procedureId: value?.value as string,
                  }));
                }}
              />
              {!temporaryItems[item.id] && processData.procedureId && (
                <div className="flex flex-col gap-2 w-auto">
                  {procedureWasChanged && (
                    <span className="text-sm text-muted-foreground">
                      The procedure was changed, but not synced to the
                      operation.
                    </span>
                  )}
                  <div>
                    <Button
                      variant="secondary"
                      rightIcon={<LuRefreshCcw />}
                      onClick={procedureSyncDisclosure.onOpen}
                    >
                      Sync Procedure
                    </Button>
                    {procedureSyncDisclosure.isOpen && (
                      <ProcedureSyncModal
                        operationId={item.id}
                        procedureId={processData.procedureId}
                        onClose={procedureSyncDisclosure.onClose}
                      />
                    )}
                  </div>
                </div>
              )}
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

function ProcedureSyncModal({
  operationId,
  procedureId,
  onClose,
}: {
  operationId: string;
  procedureId: string;
  onClose: () => void;
}) {
  const fetcher = useFetcher<{ success: boolean }>();
  useEffect(() => {
    if (fetcher.data?.success) {
      onClose();
    }
  }, [fetcher.data?.success, onClose]);

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <ModalContent>
        <ValidatedForm
          validator={procedureSyncValidator}
          action={path.to.jobOperationProcedureSync}
          method="post"
          fetcher={fetcher}
          defaultValues={{
            operationId,
            procedureId,
          }}
        >
          <ModalHeader>
            <ModalTitle>Are you sure?</ModalTitle>
          </ModalHeader>
          <ModalBody className="py-4">
            <Hidden name="operationId" />
            <Hidden name="procedureId" />
            <Alert variant="warning">
              <LuTriangleAlert className="h-4 w-4" />
              <AlertTitle>Potential Data Loss</AlertTitle>
              <AlertDescription>
                Syncing the procedure will update the operation with the new
                work instructions, steps, and parameters. Any steps that are not
                part of the procedure will be removed.
              </AlertDescription>
            </Alert>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Submit
              isLoading={fetcher.state !== "idle"}
              isDisabled={fetcher.state !== "idle"}
            >
              Sync
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}

type ProductionEventActivityProps = {
  item: Database["public"]["Tables"]["productionEvent"]["Row"];
};

const getActivityText = (
  item: Database["public"]["Tables"]["productionEvent"]["Row"]
) => {
  switch (item.type) {
    case "Setup":
      return item.duration
        ? `did ${formatDurationMilliseconds(item.duration * 1000)} of setup`
        : `started setup`;
    case "Labor":
      return item.duration
        ? `did ${formatDurationMilliseconds(item.duration * 1000)} of labor`
        : `started labor`;
    case "Machine":
      return item.duration
        ? `did ${formatDurationMilliseconds(item.duration * 1000)} of machine`
        : `started machine`;
    default:
      return "";
  }
};

const ProductionEventActivity = ({ item }: ProductionEventActivityProps) => {
  return (
    <Activity
      employeeId={item.employeeId ?? item.createdBy}
      activityMessage={getActivityText(item)}
      activityTime={formatDateTime(item.startTime)}
      activityIcon={
        item.type ? (
          <TimeTypeIcon
            type={item.type}
            className={cn(
              item.type === "Labor"
                ? "text-emerald-500"
                : item.type === "Machine"
                ? "text-blue-500"
                : "text-yellow-500"
            )}
          />
        ) : null
      }
    />
  );
};

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
  const fetcher = useFetcher<typeof editJobOperationToolAction>();

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
          action={path.to.jobOperationTool(id)}
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
            <div className="w-full grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
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
          action={path.to.deleteJobOperationTool(id)}
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
  const fetcher = useFetcher<typeof newJobOperationToolAction>();

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
      <div className="p-6 border rounded-lg bg-card">
        <ValidatedForm
          action={path.to.newJobOperationTool}
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
              <Tool name="toolId" label="Tool" autoFocus />
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

type Message = {
  id: string;
  createdBy: string;
  createdAt: string;
  note: string;
};

function OperationChat({ jobOperationId }: { jobOperationId: string }) {
  const user = useUser();
  const [employees] = usePeople();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { carbon, accessToken } = useCarbon();

  const fetchChat = async () => {
    if (!carbon) return;
    flushSync(() => {
      setIsLoading(true);
    });

    const { data, error } = await carbon
      ?.from("jobOperationNote")
      .select("*")
      .eq("jobOperationId", jobOperationId)
      .order("createdAt", { ascending: true });

    if (error) {
      console.error(error);
      return;
    }
    setMessages(data);
    setIsLoading(false);
  };

  useMount(() => {
    fetchChat();
  });

  const channelRef = useRef<RealtimeChannel | null>(null);

  useMount(() => {
    if (!channelRef.current && carbon && accessToken) {
      carbon.realtime.setAuth(accessToken);
      channelRef.current = carbon
        .channel(`job-operation-notes-${jobOperationId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "jobOperationNote",
            filter: `jobOperationId=eq.${jobOperationId}`,
          },
          (payload) => {
            setMessages((prev) => {
              if (prev.some((m) => m.id === payload.new.id)) {
                return prev;
              }
              return [...prev, payload.new as Message];
            });
          }
        )
        .subscribe();
    }

    return () => {
      if (channelRef.current) {
        channelRef.current.unsubscribe();
        carbon?.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  });

  useEffect(() => {
    if (carbon && accessToken && channelRef.current)
      carbon.realtime.setAuth(accessToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      block: "nearest",
      inline: "start",
      behavior: messages.length > 0 ? "smooth" : "auto",
    });
  }, [messages]);

  const [message, setMessage] = useState("");

  const notify = useDebounce(
    async () => {
      if (!carbon) return;

      const response = await fetch(path.to.api.messagingNotify, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "jobOperationNote",
          operationId: jobOperationId,
        }),
        credentials: "include", // This is sufficient for CORS with cookies
      });

      if (!response.ok) {
        console.error("Failed to notify user");
      }
    },
    5000,
    true
  );

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!message.trim()) return;

    const newMessage = {
      id: nanoid(),
      jobOperationId,
      createdBy: user.id,
      note: message,
      createdAt: new Date().toISOString(),
      companyId: user.company.id,
    };

    flushSync(() => {
      setMessages((prev) => [...prev, newMessage]);
      setMessage("");
    });

    await Promise.all([
      carbon?.from("jobOperationNote").insert(newMessage),
      notify(),
    ]);
  };

  return (
    <div className="flex flex-col h-[50dvh]">
      <ScrollArea className="flex-1 p-4">
        <Loading isLoading={isLoading}>
          <div className="flex flex-col gap-3">
            {messages.length === 0 ? (
              <div className="flex justify-center pt-16">
                <Empty />
              </div>
            ) : (
              messages.map((m) => {
                const createdBy = employees.find(
                  (employee) => employee.id === m.createdBy
                );
                const isUser = m.createdBy === user.id;
                return (
                  <div
                    key={m.id}
                    className={cn(
                      "flex gap-2 items-end",
                      isUser && "flex-row-reverse"
                    )}
                  >
                    <Avatar
                      src={createdBy?.avatarUrl ?? undefined}
                      name={createdBy?.name}
                    />

                    <div className="flex flex-col gap-1 max-w-[80%] ">
                      <div className="flex flex-col gap-1">
                        {!isUser && (
                          <span className="text-xs opacity-70">
                            {createdBy?.name}
                          </span>
                        )}
                        <div
                          className={cn(
                            "rounded-2xl p-3 w-full flex flex-col gap-1",
                            isUser ? "bg-blue-500 text-white" : "bg-muted"
                          )}
                        >
                          <p className="text-sm">{m.note}</p>

                          <span className="text-xs opacity-70">
                            {new Date(m.createdAt).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} style={{ height: 0 }} />
          </div>
        </Loading>
      </ScrollArea>

      <div>
        <form className="flex gap-2" onSubmit={handleSubmit}>
          <InputField
            className="flex-1"
            placeholder="Type a message..."
            name="message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <Button
            className="h-10"
            aria-label="Send"
            type="submit"
            leftIcon={<LuSend />}
          >
            Send
          </Button>
        </form>
      </div>
    </div>
  );
}
