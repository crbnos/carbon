"use client";
import { useCarbon } from "@carbon/auth";
import type { Database } from "@carbon/database";
import { Array as ArrayInput, Input, ValidatedForm } from "@carbon/form";
import { getLogger } from "@carbon/logger";
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
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  generateHTML,
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
  toast,
  useDebounce,
  useDisclosure,
  useMount,
  useRealtimeChannel,
  VStack
} from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import { formatDurationMilliseconds } from "@carbon/utils";
import { getLocalTimeZone, today } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale, useNumberFormatter } from "@react-aria/i18n";
import type { DragControls } from "framer-motion";
import { motion, Reorder, useDragControls } from "framer-motion";
import { nanoid } from "nanoid";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  LuActivity,
  LuChevronRight,
  LuCirclePlus,
  LuDollarSign,
  LuEllipsisVertical,
  LuGripVertical,
  LuHammer,
  LuInfo,
  LuListChecks,
  LuMaximize2,
  LuMinimize2,
  LuPaperclip,
  LuPlay,
  LuRefreshCcw,
  LuSend,
  LuShieldX,
  LuTriangleAlert
} from "react-icons/lu";
import {
  Link,
  useFetcher,
  useFetchers,
  useParams,
  useRevalidator
} from "react-router";
import type { z } from "zod";
import {
  Assignee,
  DirectionAwareTabs,
  EmployeeAvatar,
  Empty,
  TimeTypeIcon
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
  WorkCenter
} from "~/components/Form";
import AssemblyInstruction from "~/components/Form/AssemblyInstruction";
import InspectionDocument from "~/components/Form/InspectionDocument";
import Procedure from "~/components/Form/Procedure";
import { SupplierProcessPreview } from "~/components/Form/SupplierProcess";
import { getUnitHint } from "~/components/Form/UnitHint";
import UnitOfMeasure, {
  useUnitOfMeasure
} from "~/components/Form/UnitOfMeasure";
import { OperationTypeIcon, ProcedureStepTypeIcon } from "~/components/Icons";
import InfiniteScroll from "~/components/InfiniteScroll";
import { ConfirmDelete } from "~/components/Modals";
import { SlidesEditor, uploadStepSlideModel } from "~/components/SlidesEditor";
import type { Item, SortableItemRenderProps } from "~/components/SortableList";
import {
  SortableList,
  SortableListItem,
  SortableListItemPanel,
  SortableListItemToggle
} from "~/components/SortableList";
import { StepLinkEditor } from "~/components/StepLinkEditor";
import {
  useDateFormatter,
  usePermissions,
  useRouteData,
  useUrlParams,
  useUser
} from "~/hooks";
import type {
  OperationParameter,
  OperationStep,
  OperationStepSlide,
  OperationTool,
  SlideAnnotation,
  SlideSize
} from "~/modules/shared";
import {
  methodOperationOrders,
  operationParameterValidator,
  operationStepValidator,
  operationToolValidator,
  operationTypes,
  procedureStepType
} from "~/modules/shared";
import type { action as editJobOperationParameterAction } from "~/routes/x+/job+/methods+/operation.parameter.$id";
import type { action as newJobOperationParameterAction } from "~/routes/x+/job+/methods+/operation.parameter.new";
import type { action as editJobOperationStepAction } from "~/routes/x+/job+/methods+/operation.step.$id";
import type { action as editJobOperationToolAction } from "~/routes/x+/job+/methods+/operation.tool.$id";
import type { action as newJobOperationToolAction } from "~/routes/x+/job+/methods+/operation.tool.new";
import { useItems, usePeople, useTools } from "~/stores";
import { getPrivateUrl, path } from "~/utils/path";
import {
  jobOperationValidator,
  jobOperationValidatorForReleasedJob,
  procedureSyncValidator,
  syncAssemblyToBopValidator
} from "../../production.models";
import { getProductionEventsPage } from "../../production.service";
import type { Job, JobOperation } from "../../types";
import { JobOperationStatus, JobOperationTags } from "./JobOperationStatus";
import { OperationDueDatePicker } from "./OperationDueDatePicker";

const logger = getLogger("erp", "production", "job-bill-of-process");

export type Operation = z.infer<typeof jobOperationValidator> & {
  assignee: string | null;
  dueDate?: string | null;
  manuallyScheduled?: boolean;
  status: JobOperation["status"];
  tags: string[] | null;
  workInstruction: JSONContent | null;
  reworkId: string | null;
};

type ItemWithData = Item & {
  data: Operation;
};

type JobOperationStep = OperationStep & {
  jobOperationStepRecord?:
    | Database["public"]["Tables"]["jobOperationStepRecord"]["Row"][]
    | null;
  jobOperationStepSlide?: OperationStepSlide[] | null;
};

type JobMaterial = {
  id: string;
  itemId: string;
  description?: string | null;
  quantity?: number | null;
  jobOperationId?: string | null;
  jobMaterialStep?: { jobOperationStepId: string }[] | null;
};

type JobBillOfProcessProps = {
  jobMakeMethodId: string;
  locationId: string;
  materials: JobMaterial[];
  operations: (Operation & {
    jobOperationTool: OperationTool[];
    jobOperationParameter: OperationParameter[];
    jobOperationStep: JobOperationStep[];
  })[];
  tags: { name: string }[];
  itemId: string;
  salesOrderLineId: string;
  customerId: string;
};

function makeItems(
  operations: Operation[],
  tags: { name: string }[],
  temporaryItems: TemporaryItems,
  urlParams: { [key: string]: string },
  t: ReturnType<typeof useLingui>["t"]
): ItemWithData[] {
  return operations.map((operation) =>
    makeItem(operation, tags, temporaryItems, urlParams, t)
  );
}

function makeItem(
  operation: Operation,
  tags: { name: string }[],
  temporaryItems: TemporaryItems,
  urlParams: { [key: string]: string },
  t: ReturnType<typeof useLingui>["t"]
): ItemWithData {
  return {
    id: operation.id!,
    title: (
      <VStack spacing={0}>
        <HStack spacing={2}>
          <h3 className="font-semibold truncate cursor-pointer">
            {operation.description}
          </h3>
          {operation.reworkId && <Badge variant="red">Rework</Badge>}
        </HStack>
        {operation.operationType === "Outside Processing" && (
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
        {operation.operationType === "Outside Processing" ? (
          <Badge>Outside Processing</Badge>
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
        <HStack>
          <OperationDueDatePicker
            operationId={operation.id!}
            dueDate={operation.dueDate ?? null}
            manuallyScheduled={operation.manuallyScheduled}
          />
          <JobOperationTags operation={operation} availableTags={tags} />
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href={path.to.external.mesJobOperation(operation.id!)}
                title={t`Open in MES`}
              >
                <IconButton
                  icon={<LuPlay />}
                  variant="secondary"
                  aria-label={t`Open in MES`}
                  size="sm"
                />
              </a>
            </TooltipTrigger>
            <TooltipContent>
              <span>
                <Trans>Open in MES</Trans>
              </span>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                to={`${path.to.newIssue}?${new URLSearchParams({
                  jobOperationId: operation.id,
                  operationSupplierProcessId:
                    operation.operationSupplierProcessId ?? "",
                  ...urlParams
                }).toString()}`}
                title={t`Create Issue`}
              >
                <IconButton
                  icon={<LuShieldX />}
                  variant="secondary"
                  aria-label={t`Create Issue`}
                  size="sm"
                ></IconButton>
              </Link>
            </TooltipTrigger>
            <TooltipContent>
              <span>
                <Trans>Create Issue</Trans>
              </span>
            </TooltipContent>
          </Tooltip>
        </HStack>
      </HStack>
    ),
    data: operation
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
  operationType: "Process",
  assemblyInstructionId: "",
  inspectionDocumentId: "",
  overheadRate: 0,
  processId: "",
  procedureId: "",
  reworkId: null,
  setupTime: 0,
  setupUnit: "Total Minutes",
  status: "Todo",
  tags: [],
  workCenterId: "",
  workInstruction: {}
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
  materials,
  operations: initialOperations,
  tags,
  itemId,
  salesOrderLineId,
  customerId
}: JobBillOfProcessProps) => {
  const { t } = useLingui();
  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { carbon, accessToken } = useCarbon();
  const sortOrderFetcher = useFetcher<{}>();
  const deleteOperationFetcher = useFetcher<{
    success: boolean;
    error?: string;
  }>();
  const permissions = usePermissions();
  const {
    id: userId,
    company: { id: companyId }
  } = useUser();

  useEffect(() => {
    const result = deleteOperationFetcher.data;
    if (result && !result.success && result.error) {
      toast.error(result.error);
    }
  }, [deleteOperationFetcher.data]);

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
        reworkId: null,
        status: "Todo",
        workInstruction: {},
        jobOperationTool: [],
        tags: []
      });
    } else {
      operationsById.set(pendingOperation.id, {
        ...operationsById.get(pendingOperation.id)!,
        ...pendingOperation
      });
    }
  });

  // Add temporary items
  Object.entries(temporaryItems).forEach(([id, operation]) => {
    operationsById.set(id, {
      ...operation,
      jobOperationTool: []
    });
  });

  const operations = Array.from(operationsById.values()).sort(
    (a, b) => (orderState[a.id!] ?? a.order) - (orderState[b.id!] ?? b.order)
  );

  const items = makeItems(
    operations,
    tags,
    temporaryItems,
    {
      itemId,
      salesOrderLineId,
      customerId
    },
    t
  ).map((item) => ({
    ...item,
    checked: checkedState[item.id] ?? false
  }));

  const isDisabled = ["Completed", "Cancelled"].includes(
    jobData?.job?.status ?? ""
  );

  const onToggleItem = (id: string) => {
    if (!permissions.can("update", "parts")) return;
    setCheckedState((prev) => ({
      ...prev,
      [id]: !prev[id]
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
      jobMakeMethodId
    };

    setTemporaryItems((prev) => ({
      ...prev,
      [operationId]: newOperation
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
          action: path.to.jobOperationsDelete(jobId)
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
        order: index + 1
      }
    }));
    const updates = newItems.reduce<Record<string, number>>((acc, item) => {
      if (!temporaryItems[item.id]) {
        acc[item.id] = item.data.order;
      }
      return acc;
    }, {});

    setOrderState((prev) => ({
      ...prev,
      ...updates
    }));
    updateSortOrder(updates);
  };

  const updateSortOrder = useDebounce(
    (updates: Record<string, number>) => {
      let formData = new FormData();
      formData.append("updates", JSON.stringify(updates));
      sortOrderFetcher.submit(formData, {
        method: "post",
        action: path.to.jobOperationsOrder(jobId)
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
            updatedBy: userId
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
  const addOperationButtonRef = useRef<HTMLButtonElement>(null);

  useRealtimeChannel({
    topic: `production-events:${selectedItemId}`,
    enabled: !!selectedItemId && !temporaryItems[selectedItemId],
    setup(channel) {
      return channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "productionEvent",
          filter: `jobOperationId=eq.${selectedItemId}`
        },
        (payload) => {
          switch (payload.eventType) {
            case "INSERT":
              const { new: inserted } = payload;
              setProductionEvents((prevEvents) => [
                ...prevEvents,
                inserted as Database["public"]["Tables"]["productionEvent"]["Row"]
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
      );
    }
  });

  // Phase 3: keep the live job's BOP steps fresh without closing the panel. When steps are
  // added/edited/reordered for the open operation, or an operator records a step on the shop
  // floor (jobOperationStepRecord), revalidate so the loader re-serves the latest steps.
  const revalidator = useRevalidator();
  useRealtimeChannel({
    topic: `bop-steps:${selectedItemId}`,
    enabled: !!selectedItemId && !temporaryItems[selectedItemId],
    setup(channel) {
      const refresh = () => revalidator.revalidate();
      return channel
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "jobOperationStep",
            filter: `operationId=eq.${selectedItemId}`
          },
          refresh
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "jobOperationStepRecord" },
          refresh
        );
    }
  });

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
    onRemoveItem
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
        label: t`Details`,
        content: (
          <div className="flex w-full flex-col pr-2 py-2">
            <motion.div
              initial={{ opacity: 0, filter: "blur(4px)" }}
              animate={{ opacity: 1, filter: "blur(0px)" }}
              transition={{
                type: "spring",
                bounce: 0.2,
                duration: 0.75,
                delay: 0.15
              }}
            >
              <OperationForm
                item={item}
                itemId={itemId}
                isDisabled={isDisabled}
                job={jobData?.job}
                locationId={locationId}
                workInstruction={workInstructions[item.id] ?? {}}
                setWorkInstructions={setWorkInstructions}
                setTemporaryItems={setTemporaryItems}
                setSelectedItemId={setSelectedItemId}
                temporaryItems={temporaryItems}
                onSubmit={() => {
                  setSelectedItemId(null);
                  addOperationButtonRef.current?.scrollIntoView({
                    behavior: "smooth",
                    block: "nearest",
                    inline: "center"
                  });
                }}
              />
            </motion.div>
          </div>
        )
      },
      {
        id: 1,
        label: t`Instructions`,
        disabled:
          item.id in temporaryItems ||
          item.data.operationType === "Outside Processing",
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
                      [item.id]: content
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
                    )
                  }}
                />
              )}
            </div>
          </div>
        )
      },
      {
        id: 2,
        disabled:
          item.id in temporaryItems ||
          item.data.operationType === "Outside Processing",
        label: (
          <span className="flex items-center gap-2">
            <span>
              <Trans>Params</Trans>
            </span>
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
        )
      },
      {
        id: 3,
        disabled:
          item.id in temporaryItems ||
          item.data.operationType === "Outside Processing",
        label: (
          <span className="flex items-center gap-2">
            <span>
              <Trans>Steps</Trans>
            </span>
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
              materials={materials}
              tools={tools}
            />
          </div>
        )
      },
      {
        id: 4,
        disabled:
          item.id in temporaryItems ||
          item.data.operationType === "Outside Processing",
        label: (
          <span className="flex items-center gap-2">
            <span>
              <Trans>Tools</Trans>
            </span>
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
        )
      },
      {
        id: 5,
        disabled:
          item.id in temporaryItems ||
          item.data.operationType === "Outside Processing",
        label: t`Events`,
        content: (
          <div className="flex w-full flex-col pr-2 py-6 min-h-[300px]">
            <motion.div
              initial={{ opacity: 0, filter: "blur(4px)" }}
              animate={{ opacity: 1, filter: "blur(0px)" }}
              transition={{
                type: "spring",
                bounce: 0.2,
                duration: 0.75,
                delay: 0.15
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
        )
      },
      {
        id: 6,
        disabled:
          item.id in temporaryItems ||
          item.data.operationType === "Outside Processing",
        label: t`Chat`,
        content: <OperationChat jobOperationId={item.id} />
      }
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
        renderExtra={(item) => (
          <div>
            <SortableListItemToggle
              isOpen={isOpen}
              onToggle={() => setSelectedItemId(isOpen ? null : item.id)}
            />
            <SortableListItemPanel isOpen={isOpen}>
              <DirectionAwareTabs
                className="mr-auto"
                tabs={tabs}
                onChange={() => setTabChangeRerender(tabChangeRerender + 1)}
              />
            </SortableListItemPanel>
          </div>
        )}
      />
    );
  };

  return (
    <Card>
      <HStack className="justify-between">
        <CardHeader>
          <CardTitle>
            <Trans>Bill of Process</Trans>
          </CardTitle>
        </CardHeader>

        <CardAction>
          <Button
            ref={addOperationButtonRef}
            variant="secondary"
            isDisabled={
              !permissions.can("update", "production") ||
              selectedItemId !== null ||
              isDisabled
            }
            onClick={onAddItem}
          >
            <Trans>Add Operation</Trans>
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
  materials,
  tools
}: {
  operationId: string;
  isDisabled: boolean;
  steps: JobOperationStep[];
  temporaryItems: TemporaryItems;
  materials: JobMaterial[];
  tools: OperationTool[];
}) {
  const fetcher = useFetcher<typeof newJobOperationParameterAction>();
  const { t } = useLingui();
  const revalidator = useRevalidator();
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

  const disclosure = useDisclosure();

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
        action: path.to.jobOperationStepOrder(operationId)
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
        value: type
      })),
    []
  );

  const { carbon } = useCarbon();
  const {
    id: userId,
    company: { id: companyId }
  } = useUser();
  const [allItems] = useItems();
  // Slides chosen while creating a step are buffered here (the step has no id yet); they're
  // attached to the new step right after it's created. See the effect below.
  // A buffered slide is image XOR model (imagePath / modelUploadId).
  const [draftSlides, setDraftSlides] = useState<
    {
      id: string;
      imagePath: string | null;
      modelUploadId: string | null;
      caption: string;
      size: SlideSize;
      annotations: SlideAnnotation[];
    }[]
  >([]);
  const [draftUploading, setDraftUploading] = useState(false);
  const draftFileInputRef = useRef<HTMLInputElement>(null);
  const draftModelInputRef = useRef<HTMLInputElement>(null);

  // Parts (this operation's BOM materials) the operator can assign to a step. Parts picked
  // while CREATING a step are buffered here and attached right after the step is created.
  const operationParts = useMemo(
    () =>
      (materials ?? [])
        .filter((m) => m.jobOperationId === operationId)
        .map((m) => ({
          id: m.id,
          name: m.description || m.itemId,
          quantity: m.quantity ?? 1
        })),
    [materials, operationId]
  );
  const [draftParts, setDraftParts] = useState<string[]>([]);

  // Tools (this operation's tools) the operator can assign to a step — the tool twin of
  // operationParts/draftParts. Tools picked while CREATING a step are buffered here and
  // attached right after the step is created (see the effect below).
  const allTools = useTools();
  const operationTools = useMemo(
    () =>
      (tools ?? []).map((tl) => {
        const tool = allTools.find((x) => x.id === tl.toolId);
        return {
          id: tl.id ?? "",
          name: tool?.readableIdWithRevision ?? tl.toolId ?? "",
          secondary: tool?.name ?? undefined,
          quantity: tl.quantity ?? 1
        };
      }),
    [tools, allTools]
  );
  const [draftTools, setDraftTools] = useState<string[]>([]);

  const materialItemIds = useMemo(
    () => new Set((materials ?? []).map((m) => m.itemId)),
    [materials]
  );

  const itemMentions = useMemo(
    () =>
      allItems
        .filter((item) => materialItemIds.has(item.id))
        .map((item) => ({
          id: item.id,
          label: item.name ?? item.readableIdWithRevision,
          helper: item.name ? item.readableIdWithRevision : undefined
        })),
    [allItems, materialItemIds]
  );

  const onUploadImage = async (file: File) => {
    const fileType = file.name.split(".").pop();
    const fileName = `${companyId}/parts/${nanoid()}.${fileType}`;

    const result = await carbon?.storage.from("private").upload(fileName, file);

    if (result?.error) {
      toast.error(t`Failed to upload image`);
      throw new Error(result.error.message);
    }

    if (!result?.data) {
      throw new Error("Failed to upload image");
    }

    return getPrivateUrl(result.data.path);
  };

  const onAddDraftSlide = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !carbon) return;
    setDraftUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const fileName = `${companyId}/parts/${nanoid()}.${ext}`;
      const result = await carbon.storage
        .from("private")
        .upload(fileName, file);
      if (result.error || !result.data) {
        toast.error(t`Failed to upload image`);
        return;
      }
      setDraftSlides((prev) => [
        ...prev,
        {
          id: nanoid(),
          imagePath: result.data.path,
          modelUploadId: null,
          caption: "",
          size: "medium",
          annotations: []
        }
      ]);
    } finally {
      setDraftUploading(false);
    }
  };

  // Upload a chosen 3D model, register it as a modelUpload (which also kicks the
  // assembler's STEP → GLB conversion), and buffer it as a draft model slide.
  const onAddDraftModel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !carbon) return;
    setDraftUploading(true);
    try {
      const modelUploadId = await uploadStepSlideModel(carbon, companyId, file);
      if (!modelUploadId) {
        toast.error(t`Failed to upload model`);
        return;
      }
      setDraftSlides((prev) => [
        ...prev,
        {
          id: nanoid(),
          imagePath: null,
          modelUploadId,
          caption: "",
          size: "medium",
          annotations: []
        }
      ]);
    } finally {
      setDraftUploading(false);
    }
  };

  // When the new step is created, attach any buffered slides to it, then revalidate so they
  // show on the step and reset the buffer for the next step.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed off the created step id
  useEffect(() => {
    const newStepId = (fetcher.data as { id?: string | null } | undefined)?.id;
    if (!newStepId || draftSlides.length === 0 || !carbon) return;
    let cancelled = false;
    (async () => {
      const slideRows = draftSlides.map((slide, index) => ({
        stepId: newStepId,
        imagePath: slide.imagePath,
        modelUploadId: slide.modelUploadId,
        caption: slide.caption || null,
        sortOrder: index + 1,
        size: slide.size,
        annotations: slide.annotations,
        companyId,
        createdBy: userId
      }));
      const { error } = await carbon
        .from("jobOperationStepSlide")
        .insert(slideRows);
      if (cancelled) return;
      if (error) {
        toast.error(t`Failed to save slides`);
        return;
      }
      setDraftSlides([]);
      revalidator.revalidate();
    })();
    return () => {
      cancelled = true;
    };
  }, [fetcher.data]);

  // When the new step is created, attach any buffered parts, then revalidate + reset.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed off the created step id
  useEffect(() => {
    const newStepId = (fetcher.data as { id?: string | null } | undefined)?.id;
    if (!newStepId || draftParts.length === 0 || !carbon) return;
    let cancelled = false;
    (async () => {
      const { error } = await carbon.from("jobMaterialStep").insert(
        draftParts.map((jobMaterialId) => ({
          jobMaterialId,
          jobOperationStepId: newStepId
        }))
      );
      if (cancelled) return;
      if (error) {
        toast.error(t`Failed to save parts`);
        return;
      }
      setDraftParts([]);
      revalidator.revalidate();
    })();
    return () => {
      cancelled = true;
    };
  }, [fetcher.data]);

  // When the new step is created, attach any buffered tools, then revalidate + reset.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed off the created step id
  useEffect(() => {
    const newStepId = (fetcher.data as { id?: string | null } | undefined)?.id;
    if (!newStepId || draftTools.length === 0 || !carbon) return;
    let cancelled = false;
    (async () => {
      const { error } = await carbon.from("jobOperationToolStep").insert(
        draftTools.map((jobOperationToolId) => ({
          jobOperationToolId,
          jobOperationStepId: newStepId
        }))
      );
      if (cancelled) return;
      if (error) {
        toast.error(t`Failed to save tools`);
        return;
      }
      setDraftTools([]);
      revalidator.revalidate();
    })();
    return () => {
      cancelled = true;
    };
  }, [fetcher.data]);

  if (isDisabled && temporaryItems[operationId]) {
    return (
      <Alert className="max-w-[420px] mx-auto my-8">
        <LuTriangleAlert />
        <AlertTitle>
          <Trans>Cannot add steps to unsaved operation</Trans>
        </AlertTitle>
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
      {disclosure.isOpen ? (
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
                steps.reduce((acc, a) => Math.max(acc, a.sortOrder ?? 0), 0) +
                1,
              operationId
            }}
            onSubmit={() => {
              setType("Value");
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
                  label={t`Type`}
                  options={typeOptions}
                  value={type}
                  onChange={(option) => {
                    if (option) {
                      setType(option.value as OperationStep["type"]);
                    }
                  }}
                />
                <Input name="name" label={t`Name`} />
              </div>

              <VStack spacing={2} className="w-full col-span-2">
                <Label>
                  <Trans>Description</Trans>
                </Label>
                <Editor
                  initialValue={description}
                  onUpload={onUploadImage}
                  onChange={(value) => {
                    setDescription(value);
                  }}
                  mentions={[{ char: "@", items: itemMentions }]}
                  className="[&_.is-empty]:text-muted-foreground min-h-[120px] p-4 rounded-lg border w-full"
                />
              </VStack>

              {type === "Measurement" && (
                <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                  <UnitOfMeasure
                    name="unitOfMeasureCode"
                    label={t`Unit of Measure`}
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
                      label={t`Minimum`}
                      formatOptions={{
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 10
                      }}
                    />
                  )}
                  {numericControls.includes("max") && (
                    <Number
                      name="maxValue"
                      label={t`Maximum`}
                      formatOptions={{
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 10
                      }}
                    />
                  )}
                </div>
              )}
              {type === "List" && (
                <ArrayInput name="listValues" label={t`List Options`} />
              )}

              <SlidesEditor
                slides={draftSlides.map((slide) => ({
                  key: slide.id,
                  imagePath: slide.imagePath,
                  modelUploadId: slide.modelUploadId,
                  caption: slide.caption,
                  size: slide.size,
                  annotations: slide.annotations
                }))}
                isDisabled={isDisabled}
                busy={draftUploading}
                fileInputRef={draftFileInputRef}
                onFileChange={onAddDraftSlide}
                modelInputRef={draftModelInputRef}
                onModelFileChange={onAddDraftModel}
                onRemove={(index) =>
                  setDraftSlides((prev) => prev.filter((_, i) => i !== index))
                }
                onCaptionBlur={(index, caption) =>
                  setDraftSlides((prev) =>
                    prev.map((slide, i) =>
                      i === index ? { ...slide, caption } : slide
                    )
                  )
                }
                onAnnotationsChange={(index, annotations) =>
                  setDraftSlides((prev) =>
                    prev.map((slide, i) =>
                      i === index ? { ...slide, annotations } : slide
                    )
                  )
                }
              />

              <StepLinkEditor
                label={t`Parts`}
                addLabel={t`Add parts`}
                emptyLabel={t`No parts`}
                searchPlaceholder={t`Search parts...`}
                removeLabel={t`Remove part`}
                items={operationParts}
                linkedIds={draftParts}
                isDisabled={isDisabled}
                onAdd={(partId) =>
                  setDraftParts((prev) =>
                    prev.includes(partId) ? prev : [...prev, partId]
                  )
                }
                onRemove={(partId) =>
                  setDraftParts((prev) => prev.filter((id) => id !== partId))
                }
              />

              <StepLinkEditor
                label={t`Tools`}
                addLabel={t`Add tools`}
                emptyLabel={t`No tools`}
                searchPlaceholder={t`Search tools...`}
                removeLabel={t`Remove tool`}
                icon={<LuHammer />}
                items={operationTools}
                linkedIds={draftTools}
                isDisabled={isDisabled}
                onAdd={(toolId) =>
                  setDraftTools((prev) =>
                    prev.includes(toolId) ? prev : [...prev, toolId]
                  )
                }
                onRemove={(toolId) =>
                  setDraftTools((prev) => prev.filter((id) => id !== toolId))
                }
              />

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
      ) : (
        <div className="flex justify-end mb-4">
          <Button onClick={disclosure.onOpen} leftIcon={<LuCirclePlus />}>
            Add Step
          </Button>
        </div>
      )}

      {steps.length > 0 && (
        <div className="border rounded-lg ">
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
                <DraggableStepItem
                  key={stepId}
                  stepId={stepId}
                  isDisabled={isDisabled}
                >
                  {(dragControls) => (
                    <StepsListItem
                      attribute={step}
                      operationId={operationId}
                      typeOptions={typeOptions}
                      materials={materials}
                      tools={tools}
                      isDisabled={isDisabled}
                      dragControls={dragControls}
                      itemMentions={itemMentions}
                      className={cn(
                        index === 0 && "rounded-t-lg",
                        index === sortOrder.length - 1 &&
                          "rounded-b-lg border-none"
                      )}
                    />
                  )}
                </DraggableStepItem>
              );
            })}
          </Reorder.Group>
        </div>
      )}
    </Loading>
  );
}

// Parts assigned to an EXISTING job step — the step-side of the part↔step link. Toggles each
// jobMaterialStep link immediately via the material route. Job-tier twin of StepParts.
function JobStepParts({
  step,
  operationId,
  materials,
  isDisabled
}: {
  step: JobOperationStep;
  operationId: string;
  materials: JobMaterial[];
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher();

  const operationParts = (materials ?? [])
    .filter((m) => m.jobOperationId === operationId)
    .map((m) => ({
      id: m.id,
      name: m.description || m.itemId,
      quantity: m.quantity ?? 1
    }));

  const linkedPartIds = (materials ?? [])
    .filter((m) =>
      (m.jobMaterialStep ?? []).some((s) => s.jobOperationStepId === step.id)
    )
    .map((m) => m.id);

  const toggle = (partId: string, linked: boolean) => {
    if (!step.id) return;
    const fd = new FormData();
    fd.append("materialId", partId);
    fd.append("stepId", step.id);
    fd.append("linked", String(linked));
    fetcher.submit(fd, {
      method: "post",
      action: path.to.jobOperationStepMaterial
    });
  };

  return (
    <StepLinkEditor
      label={t`Parts`}
      addLabel={t`Add parts`}
      emptyLabel={t`No parts`}
      searchPlaceholder={t`Search parts...`}
      removeLabel={t`Remove part`}
      items={operationParts}
      linkedIds={linkedPartIds}
      isDisabled={isDisabled}
      busy={fetcher.state !== "idle"}
      onAdd={(id) => toggle(id, true)}
      onRemove={(id) => toggle(id, false)}
    />
  );
}

// Tools assigned to an EXISTING job step — the step-side of the tool↔step link. Toggles each
// jobOperationToolStep link immediately via the tool route. Job-tier twin of StepTools.
function JobStepTools({
  step,
  tools,
  isDisabled
}: {
  step: JobOperationStep;
  tools: OperationTool[];
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher();
  const allTools = useTools();

  const operationTools = (tools ?? []).map((tl) => {
    const tool = allTools.find((x) => x.id === tl.toolId);
    return {
      id: tl.id ?? "",
      name: tool?.readableIdWithRevision ?? tl.toolId ?? "",
      secondary: tool?.name ?? undefined,
      quantity: tl.quantity ?? 1
    };
  });

  const linkedToolIds = (tools ?? [])
    .filter((tl) =>
      (
        tl.jobOperationStepIds ??
        (
          (tl as { jobOperationToolStep?: { jobOperationStepId: string }[] })
            .jobOperationToolStep ?? []
        ).map((s) => s.jobOperationStepId)
      ).some((stepId) => stepId === step.id)
    )
    .map((tl) => tl.id ?? "");

  const toggle = (toolId: string, linked: boolean) => {
    if (!step.id) return;
    const fd = new FormData();
    fd.append("toolId", toolId);
    fd.append("stepId", step.id);
    fd.append("linked", String(linked));
    fetcher.submit(fd, {
      method: "post",
      action: path.to.jobOperationStepTool
    });
  };

  return (
    <StepLinkEditor
      label={t`Tools`}
      addLabel={t`Add tools`}
      emptyLabel={t`No tools`}
      searchPlaceholder={t`Search tools...`}
      removeLabel={t`Remove tool`}
      icon={<LuHammer />}
      items={operationTools}
      linkedIds={linkedToolIds}
      isDisabled={isDisabled}
      busy={fetcher.state !== "idle"}
      onAdd={(id) => toggle(id, true)}
      onRemove={(id) => toggle(id, false)}
    />
  );
}

// Reference images ("slides") for an EXISTING job step — upload, caption, resize, annotate,
// delete; persisted immediately via the job slide routes. Job-tier twin of the item
// StepSlides (BillOfProcess); reuses the shared SlidesEditor. Lets an operator's reference
// content be corrected on the job without recreating it, since the MES reads the job copy.
function JobStepSlides({
  step,
  isDisabled
}: {
  step: JobOperationStep;
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher();
  const captionFetcher = useFetcher();
  const { carbon } = useCarbon();
  const {
    company: { id: companyId }
  } = useUser();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const slides = ((step.jobOperationStepSlide ?? []) as OperationStepSlide[])
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  const nextSortOrder = () =>
    slides.reduce((m, s) => Math.max(m, s.sortOrder ?? 0), 0) + 1;

  const onAddFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !carbon || !step.id) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const fileName = `${companyId}/parts/${nanoid()}.${ext}`;
      const result = await carbon.storage
        .from("private")
        .upload(fileName, file);
      if (result.error || !result.data) {
        toast.error(t`Failed to upload image`);
        return;
      }
      const fd = new FormData();
      fd.append("stepId", step.id);
      fd.append("imagePath", result.data.path);
      fd.append("sortOrder", String(nextSortOrder()));
      fetcher.submit(fd, {
        method: "post",
        action: path.to.newJobOperationStepSlide
      });
    } finally {
      setUploading(false);
    }
  };

  // Upload a 3D model and attach it to the step as a model slide. The model-upload
  // API also starts the assembler's STEP → GLB conversion.
  const onAddModelFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !carbon || !step.id) return;
    setUploading(true);
    try {
      const modelUploadId = await uploadStepSlideModel(carbon, companyId, file);
      if (!modelUploadId) {
        toast.error(t`Failed to upload model`);
        return;
      }
      const fd = new FormData();
      fd.append("stepId", step.id);
      fd.append("modelUploadId", modelUploadId);
      fd.append("sortOrder", String(nextSortOrder()));
      fetcher.submit(fd, {
        method: "post",
        action: path.to.newJobOperationStepSlide
      });
    } finally {
      setUploading(false);
    }
  };

  // Update one slide: always carries the required fields (id → the route updates rather
  // than inserts; stepId + the slide's content field satisfy the validator) plus whatever
  // changed. Fields not sent are preserved, so a caption edit never wipes size/annotations
  // and vice-versa.
  function saveSlide(
    slide: OperationStepSlide,
    fields: Record<string, string>
  ) {
    const fd = new FormData();
    fd.append("id", slide.id);
    fd.append("stepId", slide.stepId);
    if (slide.imagePath) fd.append("imagePath", slide.imagePath);
    if (slide.modelUploadId) fd.append("modelUploadId", slide.modelUploadId);
    fd.append("sortOrder", String(slide.sortOrder ?? 1));
    for (const [key, value] of Object.entries(fields)) fd.append(key, value);
    captionFetcher.submit(fd, {
      method: "post",
      action: path.to.newJobOperationStepSlide
    });
  }

  return (
    <SlidesEditor
      slides={slides.map((s) => ({
        key: s.id,
        imagePath: s.imagePath,
        modelUploadId: s.modelUploadId,
        caption: s.caption,
        size: s.size,
        annotations: s.annotations
      }))}
      isDisabled={isDisabled}
      busy={uploading || fetcher.state !== "idle"}
      fileInputRef={fileInputRef}
      onFileChange={onAddFile}
      modelInputRef={modelInputRef}
      onModelFileChange={onAddModelFile}
      onRemove={(index) => {
        const slide = slides[index];
        if (!slide) return;
        fetcher.submit(null, {
          method: "post",
          action: path.to.deleteJobOperationStepSlide(slide.id)
        });
      }}
      onCaptionBlur={(index, caption) => {
        const slide = slides[index];
        if (slide && (slide.caption ?? "") !== caption)
          saveSlide(slide, { caption });
      }}
      onAnnotationsChange={(index, annotations) => {
        const slide = slides[index];
        if (slide)
          saveSlide(slide, { annotations: JSON.stringify(annotations) });
      }}
    />
  );
}

function DraggableStepItem({
  stepId,
  isDisabled,
  children
}: {
  stepId: string;
  isDisabled: boolean;
  children: (dragControls: DragControls) => ReactNode;
}) {
  const dragControls = useDragControls();
  return (
    <Reorder.Item
      key={stepId}
      value={stepId}
      dragListener={false}
      dragControls={dragControls}
    >
      {children(dragControls)}
    </Reorder.Item>
  );
}

function StepsListItem({
  attribute,
  operationId,
  typeOptions,
  materials,
  tools,
  isDisabled = false,
  dragControls,
  itemMentions,
  className
}: {
  attribute: JobOperationStep;
  operationId: string;
  typeOptions: { label: JSX.Element; value: string }[];
  materials: JobMaterial[];
  tools: OperationTool[];
  isDisabled?: boolean;
  dragControls?: DragControls;
  itemMentions: { id: string; label: string }[];
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
    createdAt
  } = attribute;

  const { formatRelativeTime } = useDateFormatter();
  const disclosure = useDisclosure();
  const deleteModalDisclosure = useDisclosure();
  const submitted = useRef(false);
  const fetcher = useFetcher<typeof editJobOperationStepAction>();
  const duplicateStepFetcher = useFetcher();
  const { t } = useLingui();
  const [description, setDescription] = useState<JSONContent>(() => {
    if (!attribute.description) return {};
    // Handle both object and string formats
    if (typeof attribute.description === "object") {
      return attribute.description as JSONContent;
    }
    try {
      return JSON.parse(attribute.description);
      // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
    } catch (e) {
      return {};
    }
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (submitted.current && fetcher.state === "idle") {
      disclosure.onClose();
      submitted.current = false;
    }
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
    company: { id: companyId }
  } = useUser();

  const onUploadImage = async (file: File) => {
    const fileType = file.name.split(".").pop();
    const fileName = `${companyId}/parts/${nanoid()}.${fileType}`;

    const result = await carbon?.storage.from("private").upload(fileName, file);

    if (result?.error) {
      toast.error(t`Failed to upload image`);
      throw new Error(result.error.message);
    }

    if (!result?.data) {
      throw new Error("Failed to upload image");
    }

    return getPrivateUrl(result.data.path);
  };

  if (!id) return null;

  return (
    <div className={cn("border-b p-6 bg-card", className)}>
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
            operationId
          }}
          className="w-full"
        >
          <Hidden name="operationId" />
          <Hidden name="description" value={JSON.stringify(description)} />
          <VStack spacing={4}>
            <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
              <SelectControlled
                name="type"
                label={t`Type`}
                options={typeOptions}
                onChange={(option) => {
                  if (option) {
                    setType(option.value as OperationStep["type"]);
                  }
                }}
              />
              <Input name="name" label={t`Name`} />
            </div>

            <VStack spacing={2} className="w-full col-span-2">
              <Label>
                <Trans>Description</Trans>
              </Label>
              <Editor
                initialValue={description}
                onUpload={onUploadImage}
                onChange={(value) => {
                  setDescription(value);
                }}
                mentions={[{ char: "@", items: itemMentions }]}
                className="[&_.is-empty]:text-muted-foreground min-h-[120px] p-4 rounded-lg border w-full"
              />
            </VStack>

            {type === "Measurement" && (
              <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                <UnitOfMeasure
                  name="unitOfMeasureCode"
                  label={t`Unit of Measure`}
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
                    label={t`Minimum`}
                    formatOptions={{
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 10
                    }}
                  />
                )}
                {numericControls.includes("max") && (
                  <Number
                    name="maxValue"
                    label={t`Maximum`}
                    formatOptions={{
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 10
                    }}
                  />
                )}
              </div>
            )}
            {type === "List" && (
              <ArrayInput name="listValues" label={t`List Options`} />
            )}
            <JobStepSlides step={attribute} isDisabled={isDisabled} />
            <JobStepParts
              step={attribute}
              operationId={operationId}
              materials={materials}
              isDisabled={isDisabled}
            />
            <JobStepTools
              step={attribute}
              tools={tools}
              isDisabled={isDisabled}
            />
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
        <div className="flex flex-col gap-2 w-full">
          <div className="flex flex-1 justify-between items-center w-full">
            <HStack spacing={4} className="w-1/2">
              <IconButton
                aria-label={t`Drag handle`}
                icon={<LuGripVertical />}
                variant="ghost"
                disabled={isDisabled}
                className="cursor-grab active:cursor-grabbing"
                onPointerDown={(e) => {
                  if (!isDisabled && dragControls) dragControls.start(e);
                }}
                style={{ touchAction: "none" }}
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
                    Object.keys(attribute.description).length > 0 ? (
                      <Tooltip>
                        <TooltipTrigger>
                          <LuInfo className="text-muted-foreground size-3" />
                        </TooltipTrigger>
                        <TooltipContent side="right">
                          <p
                            className="prose prose-sm dark:prose-invert text-foreground text-sm"
                            dangerouslySetInnerHTML={{
                              __html: generateHTML(attribute.description)
                            }}
                          />
                        </TooltipContent>
                      </Tooltip>
                    ) : null}
                  </HStack>
                  {attribute.type === "Measurement" && (
                    <span className="text-xs text-muted-foreground">
                      {attribute.minValue !== null &&
                      attribute.maxValue !== null
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
                    aria-label={t`Open menu`}
                    icon={<LuEllipsisVertical />}
                    variant="ghost"
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={disclosure.onOpen}>
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      duplicateStepFetcher.submit(null, {
                        method: "post",
                        action: path.to.duplicateJobOperationStep(id)
                      })
                    }
                  >
                    Duplicate
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
          {attribute.jobOperationStepRecord && (
            <PreviewStepRecords attribute={attribute} />
          )}
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

function PreviewStepRecords({ attribute }: { attribute: JobOperationStep }) {
  const { formatRelativeTime } = useDateFormatter();
  if (
    !attribute.jobOperationStepRecord ||
    !Array.isArray(attribute.jobOperationStepRecord) ||
    attribute.jobOperationStepRecord.length === 0
  ) {
    // No records yet — don't render the empty bordered box (it shows as a stray line).
    return null;
  }

  const records = attribute.jobOperationStepRecord;

  return (
    <div className="mt-4">
      <div className="border rounded-lg overflow-hidden">
        {records.map((record, index) => (
          <div
            key={record.id || index}
            className={cn(
              "flex flex-1 items-center justify-between px-3 py-2",
              index !== records.length - 1 && "border-b"
            )}
          >
            <div className="flex w-1/2 items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground font-medium">
                Record {index + 1}
              </span>
              <div className="text-right font-medium">
                <PreviewStepRecord attribute={attribute} record={record} />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 w-1/2">
              <HStack spacing={2}>
                <span className="text-xs text-muted-foreground">
                  Created {formatRelativeTime(record.createdAt ?? "")}
                </span>
                <EmployeeAvatar
                  employeeId={record.createdBy}
                  withName={false}
                />
              </HStack>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PreviewStepRecord({
  attribute,
  record
}: {
  attribute: JobOperationStep;
  record: any;
}) {
  const { formatDateTime } = useDateFormatter();
  const unitOfMeasures = useUnitOfMeasure();
  const [employees] = usePeople();
  const numberFormatter = useNumberFormatter();

  return (
    <>
      {attribute.type === "Task" && (
        <Checkbox checked={record.booleanValue ?? false} />
      )}
      {attribute.type === "Checkbox" && (
        <Checkbox checked={record.booleanValue ?? false} />
      )}
      {attribute.type === "Value" && <p className="text-sm">{record.value}</p>}
      {attribute.type === "Measurement" &&
        typeof record.numericValue === "number" && (
          <p
            className={cn(
              "text-sm",
              attribute.minValue !== null &&
                attribute.minValue !== undefined &&
                record.numericValue < attribute.minValue &&
                "text-red-500",
              attribute.maxValue !== null &&
                attribute.maxValue !== undefined &&
                record.numericValue > attribute.maxValue &&
                "text-red-500"
            )}
          >
            {numberFormatter.format(record.numericValue)}{" "}
            {
              unitOfMeasures.find(
                (u) => u.value === attribute.unitOfMeasureCode
              )?.label
            }
          </p>
        )}
      {attribute.type === "Timestamp" && (
        <p className="text-sm">{formatDateTime(record.value ?? "")}</p>
      )}
      {attribute.type === "List" && <p className="text-sm">{record.value}</p>}
      {attribute.type === "Person" && (
        <p className="text-sm">
          {employees.find((e) => e.id === record.userValue)?.name}
        </p>
      )}
      {attribute.type === "File" && record.value && (
        <div className="flex justify-end gap-2 text-xs">
          <LuPaperclip className="size-4 text-muted-foreground" />
          <a
            href={getPrivateUrl(record.value)}
            target="_blank"
            rel="noopener noreferrer"
          >
            View File
          </a>
        </div>
      )}
      {attribute.type === "Inspection" && (
        <div className="flex justify-end gap-2 items-center text-sm">
          {record.value && (
            <>
              <LuPaperclip className="size-4 text-muted-foreground" />
              <a
                href={getPrivateUrl(record.value)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs"
              >
                View File
              </a>
            </>
          )}
          <Checkbox checked={record.booleanValue ?? false} />
        </div>
      )}
    </>
  );
}

function ParametersForm({
  operationId,
  isDisabled,
  parameters,
  temporaryItems
}: {
  operationId: string;
  isDisabled: boolean;
  parameters: OperationParameter[];
  temporaryItems: TemporaryItems;
}) {
  const fetcher = useFetcher<typeof newJobOperationParameterAction>();
  const { t } = useLingui();

  if (isDisabled && temporaryItems[operationId]) {
    return (
      <Alert className="max-w-[420px] mx-auto my-8">
        <LuTriangleAlert />
        <AlertTitle>
          <Trans>Cannot add parameters to unsaved operation</Trans>
        </AlertTitle>
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
            operationId
          }}
          className="w-full"
        >
          <Hidden name="operationId" />
          <VStack spacing={4}>
            <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
              <Input
                name="key"
                label={t`Key`}
                autoFocus={parameters.length === 0}
              />
              <Input name="value" label={t`Value`} />
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
  className
}: {
  parameter: OperationParameter;
  operationId: string;
  className?: string;
}) {
  const { formatRelativeTime } = useDateFormatter();
  const disclosure = useDisclosure();
  const deleteModalDisclosure = useDisclosure();
  const submitted = useRef(false);
  const fetcher = useFetcher<typeof editJobOperationParameterAction>();
  const { t } = useLingui();

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (submitted.current && fetcher.state === "idle") {
      disclosure.onClose();
      submitted.current = false;
    }
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
            operationId
          }}
          className="w-full"
        >
          <Hidden name="operationId" />
          <VStack spacing={4}>
            <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
              <Input name="key" label={t`Key`} />
              <Input name="value" label={t`Value`} />
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
                  aria-label={t`Open menu`}
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
  itemId,
  isDisabled,
  job,
  locationId,
  workInstruction,
  setWorkInstructions,
  setTemporaryItems,
  setSelectedItemId,
  temporaryItems,
  onSubmit
}: {
  item: ItemWithData;
  itemId: string;
  isDisabled: boolean;
  job?: Job;
  locationId: string;
  workInstruction: JSONContent;
  setWorkInstructions: Dispatch<SetStateAction<PendingWorkInstructions>>;
  setTemporaryItems: Dispatch<SetStateAction<TemporaryItems>>;
  setSelectedItemId: Dispatch<SetStateAction<string | null>>;
  onSubmit: () => void;
  temporaryItems: TemporaryItems;
}) {
  const { jobId } = useParams();
  const { t } = useLingui();
  const { company } = useUser();
  if (!jobId) throw new Error("jobId not found");

  const fetcher = useFetcher<{
    id: string;
    success: boolean;
    message: string;
  }>();
  const { carbon } = useCarbon();
  const baseCurrency = company?.baseCurrencyCode ?? "USD";

  useEffect(() => {
    if (fetcher.data?.id) {
      // Clear temporary item after successful save
      setTemporaryItems((prev) => {
        const { [item.id]: _, ...rest } = prev;
        return rest;
      });
      if (fetcher.data?.success) {
        toast.success(fetcher.data.message);
      }
      onSubmit();
    }
  }, [item.id, fetcher.data, onSubmit, setTemporaryItems]);

  const machineDisclosure = useDisclosure();
  const laborDisclosure = useDisclosure();
  const assemblyDisclosure = useDisclosure();
  const [assemblyWasChanged, setAssemblyWasChanged] = useState(false);
  const assemblySyncDisclosure = useDisclosure();
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
    assemblyInstructionId: string;
    inspectionDocumentId: string;
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
    operationType: item.data.operationType ?? "Process",
    assemblyInstructionId: item.data.assemblyInstructionId ?? "",
    inspectionDocumentId: item.data.inspectionDocumentId ?? "",
    operationUnitCost: item.data.operationUnitCost ?? 0,
    overheadRate: item.data.overheadRate ?? 0,
    processId: item.data.processId ?? "",
    procedureId: item.data.procedureId ?? "",
    setupTime: item.data.setupTime ?? 0,
    setupUnit: item.data.setupUnit ?? "Total Minutes",
    setupUnitHint: getUnitHint(item.data.setupUnit)
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
      carbon.from("supplierProcess").select("*").eq("processId", processId)
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
      // processType and operationType share one enum — the process's type is the
      // default operation type.
      operationType: process.data?.processType ?? "Process"
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
      overheadRate: data?.overheadRate ?? 0
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
      operationLeadTime: data?.leadTime ?? 0
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
          label={t`Process`}
          onChange={(value) => {
            onProcessChange(value?.value as string);
          }}
        />
        <SelectControlled
          name="operationType"
          label={t`Operation Type`}
          termId="operation-type"
          placeholder={t`Operation Type`}
          options={operationTypes.map((o) => ({
            value: o,
            label: (
              <span className="flex items-center gap-2">
                <OperationTypeIcon type={o} />
                <span>{o}</span>
              </span>
            )
          }))}
          value={processData.operationType}
          onChange={(value) => {
            const next = (value?.value as string) ?? "Process";
            setProcessData((d) => ({
              ...d,
              operationType: next,
              // Each type has exactly one instruction source — clear the ones
              // that no longer apply (the upsert normalizes server-side too).
              ...(next !== "Process" ? { procedureId: "" } : {}),
              ...(next !== "Assembly" ? { assemblyInstructionId: "" } : {}),
              ...(next !== "Inspection" ? { inspectionDocumentId: "" } : {}),
              // Machine only applies to Process operations.
              ...(next !== "Process" ? { machineTime: 0 } : {}),
              // Crossing the in-house <-> Outside Processing boundary changes the
              // meaningful time units; reset to defaults. Switching between in-house
              // types keeps whatever units the user picked.
              ...((next === "Outside Processing") !==
              (d.operationType === "Outside Processing")
                ? {
                    setupUnit: "Total Minutes",
                    laborUnit: "Minutes/Piece",
                    machineUnit: "Minutes/Piece"
                  }
                : {})
            }));
          }}
        />

        {processData.operationType === "Outside Processing" ? (
          <>
            <SupplierProcess
              name="operationSupplierProcessId"
              label={t`Supplier`}
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
              label={t`Minimum Cost`}
              minValue={0}
              value={processData.operationMinimumCost}
              formatOptions={{
                style: "currency",
                currency: baseCurrency
              }}
              onChange={(newValue) =>
                setProcessData((d) => ({
                  ...d,
                  operationMinimumCost: newValue
                }))
              }
            />
            <NumberControlled
              name="operationUnitCost"
              label={t`Unit Cost`}
              minValue={0}
              value={processData.operationUnitCost}
              formatOptions={{
                style: "currency",
                currency: baseCurrency
              }}
              onChange={(newValue) =>
                setProcessData((d) => ({
                  ...d,
                  operationUnitCost: newValue
                }))
              }
            />
            <NumberControlled
              name="operationLeadTime"
              label={t`Lead Time`}
              minValue={0}
              value={processData.operationLeadTime}
              onChange={(newValue) =>
                setProcessData((d) => ({
                  ...d,
                  operationLeadTime: newValue
                }))
              }
            />
          </>
        ) : (
          <WorkCenter
            name="workCenterId"
            label={t`Work Center`}
            termId="work-center"
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

        <InputControlled
          name="description"
          label={t`Description`}
          value={processData.description}
          onChange={(newValue) => {
            setProcessData((d) => ({ ...d, description: newValue }));
          }}
          className="col-span-2"
        />

        <Select
          name="operationOrder"
          label={t`Operation Order`}
          placeholder={t`Operation Order`}
          options={methodOperationOrders.map((o) => ({
            value: o,
            label: o
          }))}
        />
      </div>

      {processData.operationType !== "Outside Processing" && (
        <>
          <div className="border border-border rounded-md shadow-sm p-4 flex flex-col gap-4">
            <HStack
              className="w-full justify-between cursor-pointer"
              onClick={setupDisclosure.onToggle}
            >
              <HStack>
                <TimeTypeIcon type="Setup" />
                <Label>
                  <Trans>Setup</Trans>
                </Label>
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
                    setupDisclosure.isOpen ? t`Collapse Setup` : t`Expand Setup`
                  }
                  variant="ghost"
                  size="md"
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
                label={t`Setup`}
                value={processData.setupUnitHint}
                onChange={(hint) => {
                  setProcessData((d) => ({
                    ...d,
                    setupUnitHint: hint,
                    setupUnit:
                      hint === "Fixed" ? "Total Minutes" : "Minutes/Piece"
                  }));
                }}
              />
              <NumberControlled
                name="setupTime"
                label={t`Setup Time`}
                isOptional={false}
                minValue={0}
                value={processData.setupTime}
                onChange={(newValue) =>
                  setProcessData((d) => ({
                    ...d,
                    setupTime: newValue
                  }))
                }
              />
              <StandardFactor
                name="setupUnit"
                label={t`Setup Unit`}
                isOptional={false}
                hint={processData.setupUnitHint}
                value={processData.setupUnit}
                onChange={(newValue) => {
                  setProcessData((d) => ({
                    ...d,
                    setupUnit: newValue?.value ?? "Total Minutes"
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
                <Label>
                  <Trans>Labor</Trans>
                </Label>
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
                    laborDisclosure.isOpen ? t`Collapse Labor` : t`Expand Labor`
                  }
                  variant="ghost"
                  size="md"
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
                label={t`Labor`}
                value={processData.laborUnitHint}
                onChange={(hint) => {
                  setProcessData((d) => ({
                    ...d,
                    laborUnitHint: hint,
                    laborUnit:
                      hint === "Fixed" ? "Total Minutes" : "Minutes/Piece"
                  }));
                }}
              />
              <NumberControlled
                name="laborTime"
                label={t`Labor Time`}
                isOptional={false}
                minValue={0}
                value={processData.laborTime}
                onChange={(newValue) =>
                  setProcessData((d) => ({
                    ...d,
                    laborTime: newValue
                  }))
                }
              />
              <StandardFactor
                name="laborUnit"
                label={t`Labor Unit`}
                isOptional={false}
                hint={processData.laborUnitHint}
                value={processData.laborUnit}
                onChange={(newValue) => {
                  setProcessData((d) => ({
                    ...d,
                    laborUnit: newValue?.value ?? "Total Minutes"
                  }));
                }}
              />
            </div>
          </div>

          {processData.operationType === "Process" && (
            <div className="border border-border rounded-md shadow-sm p-4 flex flex-col gap-4">
              <HStack
                className="w-full justify-between cursor-pointer"
                onClick={machineDisclosure.onToggle}
              >
                <HStack>
                  <TimeTypeIcon type="Machine" />
                  <Label>
                    <Trans>Machine</Trans>
                  </Label>
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
                        ? t`Collapse Machine`
                        : t`Expand Machine`
                    }
                    variant="ghost"
                    size="md"
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
                  label={t`Machine`}
                  value={processData.machineUnitHint}
                  onChange={(hint) => {
                    setProcessData((d) => ({
                      ...d,
                      machineUnitHint: hint,
                      machineUnit:
                        hint === "Fixed" ? "Total Minutes" : "Minutes/Piece"
                    }));
                  }}
                />
                <NumberControlled
                  name="machineTime"
                  label={t`Machine Time`}
                  isOptional={false}
                  minValue={0}
                  value={processData.machineTime}
                  onChange={(newValue) =>
                    setProcessData((d) => ({
                      ...d,
                      machineTime: newValue
                    }))
                  }
                />
                <StandardFactor
                  name="machineUnit"
                  label={t`Machine Unit`}
                  isOptional={false}
                  hint={processData.machineUnitHint}
                  value={processData.machineUnit}
                  onChange={(newValue) => {
                    setProcessData((d) => ({
                      ...d,
                      machineUnit: newValue?.value ?? "Total Minutes"
                    }));
                  }}
                />
              </div>
            </div>
          )}

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
                  size="md"
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
                label={t`Labor Rate`}
                minValue={0}
                value={processData.laborRate}
                formatOptions={{
                  style: "currency",
                  currency: baseCurrency
                }}
                onChange={(newValue) =>
                  setProcessData((d) => ({
                    ...d,
                    laborRate: newValue
                  }))
                }
              />
              {processData.operationType === "Process" && (
                <NumberControlled
                  name="machineRate"
                  label={t`Machine Rate`}
                  minValue={0}
                  value={processData.machineRate}
                  formatOptions={{
                    style: "currency",
                    currency: baseCurrency
                  }}
                  onChange={(newValue) =>
                    setProcessData((d) => ({
                      ...d,
                      machineRate: newValue
                    }))
                  }
                />
              )}
              <NumberControlled
                name="overheadRate"
                label={t`Overhead Rate`}
                minValue={0}
                value={processData.overheadRate}
                formatOptions={{
                  style: "currency",
                  currency: baseCurrency
                }}
                onChange={(newValue) =>
                  setProcessData((d) => ({
                    ...d,
                    overheadRate: newValue
                  }))
                }
              />
            </div>
          </div>

          {processData.operationType === "Process" && (
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
                    size="md"
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
                  label={t`Procedure`}
                  processId={processData.processId}
                  value={processData.procedureId}
                  onChange={(value) => {
                    if (value && value.value !== item.data.procedureId) {
                      setProcedureWasChanged(true);
                    }
                    setProcessData((d) => ({
                      ...d,
                      procedureId: value?.value as string
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
          )}

          {processData.operationType === "Assembly" && (
            <div className="border border-border rounded-md shadow-sm p-4 flex flex-col gap-4">
              <HStack
                className="w-full justify-between cursor-pointer"
                onClick={assemblyDisclosure.onToggle}
              >
                <HStack>
                  <OperationTypeIcon type="Assembly" />
                  <Label>Assembly Instruction</Label>
                </HStack>
                <HStack>
                  {processData.assemblyInstructionId && (
                    <Badge variant="secondary">
                      <OperationTypeIcon
                        type="Assembly"
                        className="h-3 w-3 mr-1"
                      />
                      Assembly Instruction
                    </Badge>
                  )}
                  <IconButton
                    icon={<LuChevronRight />}
                    aria-label={
                      assemblyDisclosure.isOpen
                        ? "Collapse Assembly Instruction"
                        : "Expand Assembly Instruction"
                    }
                    variant="ghost"
                    size="md"
                    onClick={(e) => {
                      e.stopPropagation();
                      assemblyDisclosure.onToggle();
                    }}
                    className={`transition-transform ${
                      assemblyDisclosure.isOpen ? "rotate-90" : ""
                    }`}
                  />
                </HStack>
              </HStack>
              <div
                className={`grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-1 pb-4 ${
                  assemblyDisclosure.isOpen ? "" : "hidden"
                }`}
              >
                <AssemblyInstruction
                  name="assemblyInstructionId"
                  label={t`Assembly Instruction`}
                  itemId={itemId}
                  value={processData.assemblyInstructionId}
                  onChange={(value) => {
                    if (
                      value &&
                      value.value !== item.data.assemblyInstructionId
                    ) {
                      setAssemblyWasChanged(true);
                    }
                    setProcessData((d) => ({
                      ...d,
                      assemblyInstructionId: value?.value as string
                    }));
                  }}
                />
                {!temporaryItems[item.id] &&
                  processData.assemblyInstructionId && (
                    <div className="flex flex-col gap-2 w-auto">
                      {assemblyWasChanged && (
                        <span className="text-sm text-muted-foreground">
                          The assembly instruction was changed, but its steps
                          were not synced to the operation.
                        </span>
                      )}
                      <div>
                        <Button
                          variant="secondary"
                          rightIcon={<LuRefreshCcw />}
                          onClick={assemblySyncDisclosure.onOpen}
                        >
                          Sync Assembly Steps
                        </Button>
                        {assemblySyncDisclosure.isOpen && (
                          <AssemblyStepsSyncModal
                            operationId={item.id}
                            assemblyInstructionId={
                              processData.assemblyInstructionId
                            }
                            onClose={assemblySyncDisclosure.onClose}
                          />
                        )}
                      </div>
                    </div>
                  )}
              </div>
            </div>
          )}

          {processData.operationType === "Inspection" && (
            <div className="border border-border rounded-md shadow-sm p-4 flex flex-col gap-4">
              <HStack className="w-full justify-between">
                <HStack>
                  <OperationTypeIcon type="Inspection" />
                  <Label>Inspection Plan</Label>
                </HStack>
                {processData.inspectionDocumentId && (
                  <Badge variant="secondary">
                    <OperationTypeIcon
                      type="Inspection"
                      className="h-3 w-3 mr-1"
                    />
                    Inspection Plan
                  </Badge>
                )}
              </HStack>
              <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-1 pb-4">
                <InspectionDocument
                  name="inspectionDocumentId"
                  label={t`Inspection Plan`}
                  isOptional={false}
                  itemId={itemId}
                  value={processData.inspectionDocumentId}
                  onChange={(value) => {
                    setProcessData((d) => ({
                      ...d,
                      inspectionDocumentId: value?.value as string
                    }));
                  }}
                />
              </div>
            </div>
          )}
        </>
      )}
      <motion.div
        className="flex w-full items-center justify-end p-2"
        initial={{ opacity: 0, filter: "blur(4px)" }}
        animate={{ opacity: 1, filter: "blur(0px)" }}
        transition={{
          type: "spring",
          bounce: 0,
          duration: 0.55
        }}
      >
        <motion.div layout className="ml-auto mr-1 pt-2">
          <Submit isDisabled={isDisabled}>
            <Trans>Save</Trans>
          </Submit>
        </motion.div>
      </motion.div>
    </ValidatedForm>
  );
}

function ProcedureSyncModal({
  operationId,
  procedureId,
  onClose
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
            procedureId
          }}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Are you sure?</Trans>
            </ModalTitle>
          </ModalHeader>
          <ModalBody className="py-4">
            <Hidden name="operationId" />
            <Hidden name="procedureId" />
            <Alert variant="warning">
              <LuTriangleAlert className="h-4 w-4" />
              <AlertTitle>
                <Trans>Potential Data Loss</Trans>
              </AlertTitle>
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

function AssemblyStepsSyncModal({
  operationId,
  assemblyInstructionId,
  onClose
}: {
  operationId: string;
  assemblyInstructionId: string;
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
          validator={syncAssemblyToBopValidator}
          action={path.to.assemblySyncBop(assemblyInstructionId)}
          method="post"
          fetcher={fetcher}
          defaultValues={{
            operationId
          }}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Are you sure?</Trans>
            </ModalTitle>
          </ModalHeader>
          <ModalBody className="py-4">
            <Hidden name="operationId" />
            <Alert variant="warning">
              <LuTriangleAlert className="h-4 w-4" />
              <AlertTitle>
                <Trans>Potential Data Loss</Trans>
              </AlertTitle>
              <AlertDescription>
                Syncing updates the operation's steps from the assembly
                instruction. Steps previously synced from an instruction are
                updated or removed to match; hand-authored steps are kept.
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
  const { formatDateTime } = useDateFormatter();
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
  className
}: {
  tool: OperationTool;
  operationId: string;
  className?: string;
}) {
  const { formatRelativeTime } = useDateFormatter();
  const disclosure = useDisclosure();
  const deleteModalDisclosure = useDisclosure();
  const submitted = useRef(false);
  const fetcher = useFetcher<typeof editJobOperationToolAction>();
  const { t } = useLingui();

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (submitted.current && fetcher.state === "idle") {
      disclosure.onClose();
      submitted.current = false;
    }
  }, [fetcher.state]);

  const tools = useTools();
  const tool = tools.find((t) => t.id === toolId);
  if (!tool || !id) return null;

  const isUpdated = updatedBy !== null;
  const person = isUpdated ? updatedBy : createdBy;
  const date = updatedAt ?? createdAt;

  return (
    <div className={cn("border-b p-6 bg-card", className)}>
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
            operationId
          }}
          className="w-full"
        >
          <Hidden name="operationId" />
          <VStack spacing={4}>
            <div className="w-full grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
              <Tool name="toolId" label={t`Tool`} autoFocus />
              <Number name="quantity" label={t`Quantity`} />
            </div>

            {/* Tool↔step assignment lives on the step editor now (not here). */}

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
                  aria-label={t`Open menu`}
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
  temporaryItems
}: {
  operationId: string;
  isDisabled: boolean;
  tools: OperationTool[];
  temporaryItems: TemporaryItems;
}) {
  const fetcher = useFetcher<typeof newJobOperationToolAction>();
  const { t } = useLingui();

  if (isDisabled && temporaryItems[operationId]) {
    return (
      <Alert className="max-w-[420px] mx-auto my-8">
        <LuTriangleAlert />
        <AlertTitle>
          <Trans>Cannot add tools to unsaved operation</Trans>
        </AlertTitle>
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
            operationId
          }}
          className="w-full"
        >
          <Hidden name="operationId" />
          <VStack spacing={4}>
            <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
              <Tool name="toolId" label={t`Tool`} autoFocus />
              <Number name="quantity" label={t`Quantity`} />
            </div>

            {/* Tool↔step assignment lives on the step editor now, not here — a tool added
                from this form starts operation-level (shown on every step in the MES). */}

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
                className={cn(
                  index === 0 && "rounded-t-lg",
                  index === tools.length - 1 && "rounded-b-lg border-none"
                )}
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
  const { t } = useLingui();
  const { locale } = useLocale();
  const [isLoading, setIsLoading] = useState(false);
  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
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
      logger.error("Failed to update job bill of process", { error });
      return;
    }
    setMessages(data);
    setIsLoading(false);
  };

  useMount(() => {
    fetchChat();
  });

  useRealtimeChannel({
    topic: `job-operation-notes-${jobOperationId}`,
    setup(channel) {
      return channel.on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "jobOperationNote",
          filter: `jobOperationId=eq.${jobOperationId}`
        },
        (payload) => {
          setMessages((prev) => {
            if (prev.some((m) => m.id === payload.new.id)) {
              return prev;
            }
            return [...prev, payload.new as Message];
          });
        }
      );
    }
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      block: "nearest",
      inline: "start",
      behavior: messages.length > 0 ? "smooth" : "auto"
    });
  }, [messages]);

  const [message, setMessage] = useState("");

  const notify = useDebounce(
    async () => {
      if (!carbon) return;

      const response = await fetch(path.to.api.messagingNotify, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          type: "jobOperationNote",
          operationId: jobOperationId
        }),
        credentials: "include" // This is sufficient for CORS with cookies
      });

      if (!response.ok) {
        logger.error("Failed to notify user");
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
      companyId: user.company.id
    };

    flushSync(() => {
      setMessages((prev) => [...prev, newMessage]);
      setMessage("");
    });

    await Promise.all([
      carbon?.from("jobOperationNote").insert(newMessage),
      notify()
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
                            {new Date(m.createdAt).toLocaleTimeString(locale, {
                              hour: "2-digit",
                              minute: "2-digit"
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
            placeholder={t`Type a message...`}
            name="message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <Button
            className="h-10"
            aria-label={t`Send`}
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
