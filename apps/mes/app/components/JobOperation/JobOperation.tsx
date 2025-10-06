import {
  Badge,
  Button,
  cn,
  Copy,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Heading,
  HStack,
  IconButton,
  ModelViewer,
  Progress,
  ScrollArea,
  Separator,
  SidebarTrigger,
  SplitButton,
  Table,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tbody,
  Td,
  Th,
  Thead,
  toast,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Tr,
  useDisclosure,
  VStack,
  type JSONContent,
} from "@carbon/react";
import { generateHTML } from "@carbon/react/Editor";
import { Await, useFetcher, useNavigate, useParams } from "@remix-run/react";
import { Suspense, useEffect, useMemo, useState } from "react";
import {
  DeadlineIcon,
  FileIcon,
  FilePreview,
  OperationStatusIcon,
} from "~/components";
import { useUrlParams } from "~/hooks";
import type { productionEventType } from "~/services/models";
import type {
  Job,
  JobMakeMethod,
  JobMaterial,
  JobOperationParameter,
  JobOperationStep,
  Kanban,
  OperationWithDetails,
  ProductionEvent,
  StorageItem,
  TrackedEntity,
  TrackedInput,
} from "~/services/types";
import { path } from "~/utils/path";

import type { Result } from "@carbon/auth";
import { useKeyboardWedge, useMode } from "@carbon/remix";
import type { TrackedEntityAttributes } from "@carbon/utils";
import {
  convertDateStringToIsoString,
  convertKbToString,
  formatDate,
  formatDurationMilliseconds,
  formatRelativeTime,
  getItemReadableId,
  labelSizes,
} from "@carbon/utils";
import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import { flushSync } from "react-dom";
import { FaTasks } from "react-icons/fa";
import { FaCheck, FaPlus, FaTrash } from "react-icons/fa6";
import {
  LuAxis3D,
  LuBarcode,
  LuCheck,
  LuChevronLeft,
  LuChevronRight,
  LuCirclePlus,
  LuClipboardCheck,
  LuDownload,
  LuEllipsisVertical,
  LuGitBranchPlus,
  LuHammer,
  LuHardHat,
  LuPrinter,
  LuQrCode,
  LuSquareUser,
  LuTimer,
  LuTriangleAlert,
} from "react-icons/lu";
import { MethodIcon, TrackingTypeIcon } from "~/components/Icons";
import { getFileType } from "~/services/operations.service";
import { useItems } from "~/stores";
import ItemThumbnail from "../ItemThumbnail";
import { BatchIssueModal } from "./components/BatchIssueModal";
import { OperationChat } from "./components/Chat";
import {
  Controls,
  IconButtonWithTooltip,
  StartStopButton,
  Times,
  WorkTypeToggle,
} from "./components/Controls";
import { IssueModal } from "./components/IssueModal";
import { ParametersListItem } from "./components/Parameter";
import { QuantityModal } from "./components/QuantityModal";
import { SerialIssueModal } from "./components/SerialIssueModal";
import { SerialSelectorModal } from "./components/SerialSelectorModal";
import {
  DeleteStepRecordModal,
  RecordModal,
  StepsListItem,
} from "./components/Step";
import { TableSkeleton } from "./components/TableSkeleton";
import { useFiles } from "./hooks/useFiles";
import { useOperation } from "./hooks/useOperation";

type JobOperationProps = {
  events: ProductionEvent[];
  files: Promise<StorageItem[]>;
  kanban: Kanban | null;
  materials: Promise<{
    materials: JobMaterial[];
    trackedInputs: TrackedInput[];
  }>;
  method: JobMakeMethod | null;
  operation: OperationWithDetails;
  procedure: Promise<{
    attributes: JobOperationStep[];
    parameters: JobOperationParameter[];
  }>;
  job: Job;
  thumbnailPath: string | null;
  trackedEntities: TrackedEntity[];
  workCenter: Promise<PostgrestSingleResponse<{ name: string }>>;
};

export const JobOperation = ({
  events,
  files,
  job,
  kanban,
  materials,
  method,
  operation: originalOperation,
  procedure,
  thumbnailPath,
  trackedEntities,
  workCenter,
}: JobOperationProps) => {
  const [params, setParams] = useUrlParams();

  const trackedEntityParam = params.get("trackedEntityId");
  const trackedEntityId = trackedEntityParam ?? trackedEntities[0]?.id;

  const parentIsSerial = method?.requiresSerialTracking;
  const parentIsBatch = method?.requiresBatchTracking;

  const serialIndex =
    trackedEntities.findIndex((entity) => entity.id === trackedEntityId) ?? 0;

  const navigate = useNavigate();

  const [items] = useItems();
  const { downloadFile, downloadModel, getFilePath } = useFiles(job);

  const attributeRecordModal = useDisclosure();
  const attributeRecordDeleteModal = useDisclosure();
  const [activeStep, setActiveStep] = useState(
    parentIsSerial ? serialIndex : 0
  );
  const [hasMultipleRecords, setHasMultipleRecords] = useState(false);

  useEffect(() => {
    if (parentIsSerial) {
      setActiveStep(serialIndex);
    }
  }, [parentIsSerial, serialIndex]);

  const isModalOpen =
    attributeRecordModal.isOpen || attributeRecordDeleteModal.isOpen;

  const {
    availableEntities,
    active,
    activeTab,
    completeModal,
    eventType,
    finishModal,
    isOverdue,
    issueModal,
    laborProductionEvent,
    machineProductionEvent,
    operation,
    progress,
    reworkModal,
    scrapModal,
    serialModal,
    selectedMaterial,
    setActiveTab,
    setEventType,
    setSelectedMaterial,
    setupProductionEvent,
  } = useOperation({
    operation: originalOperation,
    events,
    trackedEntities,
    pauseInterval: isModalOpen,
    procedure,
  });

  const controlsHeight = useMemo(() => {
    let operations = 1;
    if (operation.setupDuration > 0) operations++;
    if (operation.laborDuration > 0) operations++;
    if (operation.machineDuration > 0) operations++;
    return 40 + operations * 24;
  }, [
    operation.laborDuration,
    operation.machineDuration,
    operation.setupDuration,
  ]);

  const mode = useMode();
  const { operationId } = useParams();

  const modelUpload =
    job.modelPath || operation.itemModelPath
      ? {
          modelPath: operation.itemModelPath ?? job.modelPath,
          modelId: operation.itemModelId ?? job.modelId,
          modelName: operation.itemModelName ?? job.modelName,
          modelSize: operation.itemModelSize ?? job.modelSize,
        }
      : null;

  const [selectedStep, setSelectedStep] = useState<JobOperationStep | null>(
    null
  );

  const onRecordStepRecord = (attribute: JobOperationStep) => {
    flushSync(() => {
      setSelectedStep(attribute);
    });
    attributeRecordModal.onOpen();
  };

  const onDeleteStepRecord = (attribute: JobOperationStep) => {
    flushSync(() => {
      setSelectedStep(attribute);
    });
    attributeRecordDeleteModal.onOpen();
  };

  const onDeselectStep = () => {
    setSelectedStep(null);
    attributeRecordModal.onClose();
    attributeRecordDeleteModal.onClose();
  };

  const navigateToTrackingLabels = (
    zpl?: boolean,
    {
      labelSize,
      trackedEntityId,
    }: { labelSize?: string; trackedEntityId?: string } = {}
  ) => {
    if (!window) return;
    if (!operationId) return;

    if (zpl) {
      window.open(
        window.location.origin +
          path.to.file.operationLabelsZpl(operationId, {
            labelSize,
            trackedEntityId,
          }),
        "_blank"
      );
    } else {
      window.open(
        window.location.origin +
          path.to.file.operationLabelsPdf(operationId, {
            labelSize,
            trackedEntityId,
          }),
        "_blank"
      );
    }
  };

  const completeFetcher = useFetcher<Result>();
  useKeyboardWedge({
    test: (input) => {
      if (kanban?.completedBarcodeOverride) {
        return input === kanban.completedBarcodeOverride;
      } else if (kanban?.id) {
        return input === path.to.kanbanComplete(kanban.id);
      }
      return false;
    },
    callback: () => {
      completeFetcher.load(path.to.endOperation(operation.id));
    },
    active: !!kanban?.id,
  });

  return (
    <>
      <Tabs
        key={`operation-${operation.id}`}
        value={activeTab}
        onValueChange={setActiveTab}
        className="w-full h-screen bg-card relative"
        style={
          { "--controls-height": `${controlsHeight}px` } as React.CSSProperties
        }
      >
        <header className="flex h-[var(--header-height)] shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12 border-b px-2">
          <HStack className="w-full justify-between">
            <div className="flex items-center gap-0">
              <SidebarTrigger />

              <Button
                variant="ghost"
                leftIcon={<LuChevronLeft />}
                onClick={() => navigate(path.to.operations)}
                className="pl-2"
              >
                Schedule
              </Button>
            </div>
            <div className="hidden md:flex flex-shrink-0 items-center justify-end gap-2">
              <TabsList className="md:ml-auto">
                <TabsTrigger variant="primary" value="details">
                  Details
                </TabsTrigger>
                <TabsTrigger
                  variant="primary"
                  disabled={!job.modelPath && !operation.itemModelPath}
                  value="model"
                >
                  Model
                </TabsTrigger>
                <TabsTrigger
                  variant="primary"
                  disabled={
                    !operation.workInstruction ||
                    Object.keys(operation.workInstruction).length === 0
                  }
                  value="procedure"
                >
                  Procedure
                </TabsTrigger>
                <TabsTrigger variant="primary" value="chat">
                  Chat
                </TabsTrigger>
              </TabsList>
            </div>
          </HStack>
        </header>

        <div className="hidden md:flex items-center justify-between px-4 lg:pl-6 py-2 h-[var(--header-height)] bg-background gap-4 max-w-[100vw] overflow-x-hidden scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent">
          <HStack>
            <Heading size="h4">{operation.jobReadableId}</Heading>
            <a
              href={path.to.file.jobTraveler(operation.jobMakeMethodId)}
              target="_blank"
              rel="noreferrer"
            >
              <IconButton
                aria-label="Job Traveler"
                variant="secondary"
                icon={<LuQrCode />}
              />
            </a>
          </HStack>

          <HStack className="justify-end items-center gap-2">
            {job.customer?.name && (
              <HStack className="justify-start space-x-2">
                <LuSquareUser className="text-muted-foreground" />
                <span className="text-sm truncate">{job.customer.name}</span>
              </HStack>
            )}
            {operation.description && (
              <HStack className="justify-start space-x-2">
                <LuClipboardCheck className="text-muted-foreground" />
                <span className="text-sm truncate">
                  {operation.description}
                </span>
              </HStack>
            )}
            {operation.operationStatus && (
              <HStack className="justify-start space-x-2">
                <OperationStatusIcon
                  status={
                    operation.jobStatus === "Paused"
                      ? "Paused"
                      : operation.operationStatus
                  }
                />
                <span className="text-sm truncate">
                  {operation.jobStatus === "Paused"
                    ? "Paused"
                    : operation.operationStatus}
                </span>
              </HStack>
            )}
            {typeof operation.duration === "number" && (
              <HStack className="justify-start space-x-2">
                <LuTimer className="text-muted-foreground" />
                <span className="text-sm truncate">
                  {formatDurationMilliseconds(operation.duration)}
                </span>
              </HStack>
            )}
            {operation.jobDeadlineType && (
              <HStack className="justify-start space-x-2">
                <DeadlineIcon
                  deadlineType={operation.jobDeadlineType}
                  overdue={isOverdue}
                />

                <span
                  className={cn(
                    "text-sm truncate",
                    isOverdue ? "text-red-500" : ""
                  )}
                >
                  {["ASAP", "No Deadline"].includes(operation.jobDeadlineType)
                    ? operation.jobDeadlineType
                    : operation.jobDueDate
                    ? `Due ${formatRelativeTime(
                        convertDateStringToIsoString(operation.jobDueDate)
                      )}`
                    : "–"}
                </span>
              </HStack>
            )}
          </HStack>
        </div>
        <Separator />

        <TabsContent value="details" className="flex-col hidden md:flex">
          <ScrollArea className="w-full pr-[calc(var(--controls-width))] h-[calc(100dvh-var(--header-height)*2-var(--controls-height)-2rem)] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent">
            <div className="flex items-start justify-between p-4 lg:p-6">
              <HStack>
                {thumbnailPath && (
                  <ItemThumbnail thumbnailPath={thumbnailPath} size="xl" />
                )}
                <div className="flex flex-col flex-grow">
                  <Heading size="h3" className="line-clamp-1">
                    {operation.description}
                  </Heading>
                  <p className="text-muted-foreground line-clamp-1">
                    {operation.itemDescription}{" "}
                  </p>
                </div>
              </HStack>
              <div className="flex flex-col flex-shrink items-end">
                <Heading size="h2">
                  {formatDurationMilliseconds(
                    ((progress.setup ?? 0) +
                      (progress.labor ?? 0) +
                      (progress.machine ?? 0)) /
                      Math.max(operation.quantityComplete, 1),
                    {
                      style: "short",
                    }
                  )}
                </Heading>
                <p className="text-muted-foreground line-clamp-1">
                  {operation.itemUnitOfMeasure}
                </p>
              </div>
            </div>
            <Separator />
            <div className="flex items-start p-4 lg:p-6">
              <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-3 w-full">
                <div className="rounded-xl border bg-card text-card-foreground shadow">
                  <div className="p-6 flex flex-row items-center justify-between space-y-0 pb-2">
                    <h3 className="tracking-tight text-sm font-medium">
                      Completed
                    </h3>
                    <FaCheck className="h-3 w-3 text-emerald-500" />
                  </div>
                  <div className="p-6 pt-0">
                    <Heading size="h1">
                      {operation.quantityComplete} of{" "}
                      {operation.operationQuantity}
                    </Heading>
                  </div>
                </div>
                <div className="rounded-xl border bg-card text-card-foreground shadow">
                  <div className="p-6 flex flex-row items-center justify-between space-y-0 pb-2">
                    <h3 className="tracking-tight text-sm font-medium">
                      Scrapped
                    </h3>
                    <FaTrash className="h-3 w-3 text-muted-foreground" />
                  </div>
                  <div className="p-6 pt-0">
                    <Heading size="h1">{operation.quantityScrapped}</Heading>
                  </div>
                </div>
                <div className="rounded-xl border bg-card text-card-foreground shadow">
                  <div className="p-6 flex flex-row items-center justify-between space-y-0 pb-2">
                    <h3 className="tracking-tight text-sm font-medium">
                      Due Date
                    </h3>
                    <DeadlineIcon
                      deadlineType={operation.jobDeadlineType}
                      overdue={isOverdue}
                    />
                  </div>
                  <div className="p-6 pt-0">
                    <VStack className="justify-start" spacing={0}>
                      <Heading
                        size="h3"
                        className={cn(
                          "w-full truncate",
                          isOverdue ? "text-red-500" : ""
                        )}
                      >
                        {["ASAP", "No Deadline"].includes(
                          operation.jobDeadlineType
                        )
                          ? operation.jobDeadlineType
                          : operation.jobDueDate
                          ? `Due ${formatRelativeTime(
                              convertDateStringToIsoString(operation.jobDueDate)
                            )}`
                          : "–"}
                      </Heading>
                      <span className="text-muted-foreground text-sm">
                        {operation.jobDueDate
                          ? formatDate(operation.jobDueDate)
                          : null}
                      </span>
                    </VStack>
                  </div>
                </div>
              </div>
            </div>

            <Suspense key={`attributes-${operationId}`}>
              <Await resolve={procedure}>
                {(resolvedProcedure) => {
                  const { attributes, parameters } = resolvedProcedure;

                  return (
                    <>
                      {attributes.length > 0 && (
                        <>
                          <Separator />
                          <div className="flex flex-col items-start justify-between w-full">
                            <div className="flex flex-col gap-4 p-4 lg:p-6 w-full">
                              <HStack className="justify-between w-full">
                                <Heading size="h3">Steps</Heading>
                                <div className="flex items-center gap-2">
                                  {attributes.length > 0 &&
                                    (() => {
                                      const maxRecords = parentIsSerial
                                        ? trackedEntities.length
                                        : operation.operationQuantity +
                                          operation.quantityScrapped;

                                      const isRecordSetStarted =
                                        recordSetIsStarted(
                                          attributes,
                                          activeStep
                                        );

                                      const canCreateNewRecord =
                                        !parentIsSerial && isRecordSetStarted;

                                      const canNavigateNext =
                                        isRecordSetStarted &&
                                        activeStep <
                                          operation.operationQuantity +
                                            operation.quantityScrapped -
                                            1;

                                      const showNavigation =
                                        hasMultipleRecords ||
                                        attributes.some(
                                          (att) =>
                                            att.jobOperationStepRecord.length >
                                            1
                                        );

                                      return (
                                        <div className="flex flex-col items-end justify-center gap-2">
                                          <div className="flex items-center gap-1">
                                            {showNavigation &&
                                              !parentIsSerial && (
                                                <>
                                                  <IconButton
                                                    aria-label="Previous record set"
                                                    variant="secondary"
                                                    icon={<LuChevronLeft />}
                                                    onClick={() => {
                                                      setActiveStep(
                                                        activeStep - 1
                                                      );
                                                    }}
                                                    isDisabled={
                                                      activeStep === 0
                                                    }
                                                  />
                                                  <span className="text-sm font-medium px-2 min-w-[60px] text-center">
                                                    Record {activeStep + 1}
                                                  </span>
                                                  <IconButton
                                                    aria-label="Next record set"
                                                    variant="secondary"
                                                    icon={<LuChevronRight />}
                                                    onClick={() => {
                                                      setActiveStep(
                                                        activeStep + 1
                                                      );
                                                    }}
                                                    isDisabled={
                                                      !canNavigateNext
                                                    }
                                                  />
                                                </>
                                              )}
                                            {canCreateNewRecord &&
                                              !showNavigation && (
                                                <Button
                                                  aria-label="Add new record set"
                                                  variant="secondary"
                                                  leftIcon={<LuCirclePlus />}
                                                  onClick={() => {
                                                    const nextIndex =
                                                      activeStep + 1;
                                                    if (
                                                      nextIndex >= maxRecords
                                                    ) {
                                                      toast.warning(
                                                        "Maximum number of records reached"
                                                      );
                                                      return;
                                                    }
                                                    setHasMultipleRecords(true);
                                                    setActiveStep(nextIndex);
                                                  }}
                                                  isDisabled={
                                                    activeStep + 1 >= maxRecords
                                                  }
                                                >
                                                  New Record
                                                </Button>
                                              )}
                                            {parentIsSerial && (
                                              <Heading size="h2">
                                                {serialIndex + 1} of{" "}
                                                {operation.operationQuantity}
                                              </Heading>
                                            )}
                                          </div>

                                          <Progress
                                            value={
                                              (attributes.filter((a) =>
                                                a.jobOperationStepRecord.some(
                                                  (r) => r.index === activeStep
                                                )
                                              ).length /
                                                attributes.length) *
                                              100
                                            }
                                            className="h-2 w-24"
                                          />
                                          <span className="text-xs text-muted-foreground">
                                            {
                                              attributes.filter((a) =>
                                                a.jobOperationStepRecord.some(
                                                  (r) => r.index === activeStep
                                                )
                                              ).length
                                            }{" "}
                                            of {attributes.length} complete
                                          </span>
                                        </div>
                                      );
                                    })()}
                                </div>
                              </HStack>
                              <div className="border rounded-lg">
                                {attributes
                                  .sort(
                                    (a, b) =>
                                      (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
                                  )
                                  .map((step, index) => (
                                    <StepsListItem
                                      key={`step-${step.id}`}
                                      activeStep={activeStep}
                                      step={step}
                                      onRecord={onRecordStepRecord}
                                      onDelete={onDeleteStepRecord}
                                      operationId={operationId}
                                      className={
                                        index === attributes.length - 1
                                          ? "border-none"
                                          : ""
                                      }
                                    />
                                  ))}
                              </div>
                            </div>
                          </div>
                        </>
                      )}
                      {parameters.length > 0 && (
                        <>
                          <Separator />
                          <div className="flex flex-col items-start justify-between w-full">
                            <div className="flex flex-col gap-4 p-4 lg:p-6 w-full">
                              <HStack className="justify-between w-full">
                                <Heading size="h3">Process Parameters</Heading>
                              </HStack>
                              <div className="border rounded-lg">
                                {parameters
                                  .sort((a, b) =>
                                    (a.key ?? "").localeCompare(b.key ?? "")
                                  )
                                  .map((p, index) => (
                                    <ParametersListItem
                                      key={`parameter-${p.id}`}
                                      parameter={p}
                                      operationId={operationId}
                                      className={
                                        index === parameters.length - 1
                                          ? "border-none"
                                          : ""
                                      }
                                    />
                                  ))}
                              </div>
                            </div>
                          </div>
                        </>
                      )}
                    </>
                  );
                }}
              </Await>
            </Suspense>

            <Separator />
            <div className="flex flex-col items-start justify-between w-full">
              <div className="flex flex-col gap-4 p-4 lg:p-6 w-full">
                <HStack className="justify-between w-full">
                  <Heading size="h3">Materials</Heading>
                  <Button
                    aria-label="Issue Material"
                    leftIcon={<LuGitBranchPlus />}
                    variant="secondary"
                    onClick={() => {
                      flushSync(() => {
                        setSelectedMaterial(null);
                      });
                      issueModal.onOpen();
                    }}
                  >
                    Issue Material
                  </Button>
                </HStack>
                <Suspense
                  key={`materials-${operationId}`}
                  fallback={<TableSkeleton />}
                >
                  <Await resolve={materials}>
                    {(resolvedMaterials) => {
                      const baseMaterials = resolvedMaterials?.materials.filter(
                        (m) => !m.isKitComponent
                      );

                      const kitMaterialsByParentId =
                        resolvedMaterials?.materials
                          .filter((m) => m.isKitComponent ?? false)
                          .reduce((acc, material) => {
                            if (material.kitParentId) {
                              if (!acc[material.kitParentId]) {
                                acc[material.kitParentId] = [];
                              }
                              acc[material.kitParentId].push(material);
                            }
                            return acc;
                          }, {} as Record<string, JobMaterial[]>);

                      return (
                        <>
                          <Table className="w-full">
                            <Thead>
                              <Tr>
                                <Th>Part</Th>
                                <Th className="lg:table-cell hidden">Method</Th>
                                <Th>Estimated</Th>
                                <Th>Actual</Th>
                                <Th className="text-right" />
                              </Tr>
                            </Thead>
                            <Tbody>
                              {baseMaterials.length === 0 ? (
                                <Tr>
                                  <Td
                                    colSpan={24}
                                    className="py-8 text-muted-foreground text-center"
                                  >
                                    No materials
                                  </Td>
                                </Tr>
                              ) : (
                                baseMaterials.map((material) => {
                                  const isRelatedToOperation =
                                    material.jobOperationId === operationId;

                                  const someRelatedMaterialIsIssued =
                                    baseMaterials.some(
                                      (m) =>
                                        m.itemReadableIdWithoutRevision ===
                                          material.itemReadableIdWithoutRevision &&
                                        ((m.quantityIssued ?? 0) > 0 ||
                                          (material.quantityIssued ?? 0) > 0)
                                    );

                                  const kittedChildren = material.id
                                    ? kitMaterialsByParentId[material.id]
                                    : [];

                                  return (
                                    <>
                                      <Tr
                                        key={`material-${material.id}`}
                                        className={cn(
                                          !isRelatedToOperation &&
                                            "opacity-50 hover:opacity-100"
                                        )}
                                      >
                                        <Td>
                                          <HStack
                                            spacing={2}
                                            className="justify-between"
                                          >
                                            <VStack spacing={0}>
                                              <span className="font-semibold">
                                                {getItemReadableId(
                                                  items,
                                                  material.itemId ?? ""
                                                )}
                                              </span>
                                              <span className="text-muted-foreground text-xs">
                                                {material.description}
                                              </span>
                                            </VStack>
                                            {material.requiresBatchTracking ? (
                                              <Badge variant="secondary">
                                                <TrackingTypeIcon
                                                  type="Batch"
                                                  className="shrink-0"
                                                />
                                              </Badge>
                                            ) : material.requiresSerialTracking ? (
                                              <Badge variant="secondary">
                                                <TrackingTypeIcon
                                                  type="Serial"
                                                  className="shrink-0"
                                                />
                                              </Badge>
                                            ) : null}
                                          </HStack>
                                        </Td>
                                        <Td className="lg:table-cell hidden">
                                          <Badge variant="secondary">
                                            <MethodIcon
                                              type={material.methodType ?? ""}
                                              isKit={material.kit ?? false}
                                              className="mr-2"
                                            />
                                            {material.methodType === "Make" &&
                                            material.kit
                                              ? "Kit"
                                              : material.methodType}
                                          </Badge>
                                        </Td>

                                        <Td>
                                          {parentIsSerial &&
                                          (material.requiresBatchTracking ||
                                            material.requiresSerialTracking)
                                            ? `${material.quantity}/${material.estimatedQuantity}`
                                            : material.estimatedQuantity}
                                        </Td>
                                        <Td>
                                          {material.methodType === "Make" &&
                                          material.requiresBatchTracking ===
                                            false &&
                                          material.requiresSerialTracking ===
                                            false ? (
                                            <MethodIcon
                                              type="Make"
                                              isKit={material.kit ?? false}
                                            />
                                          ) : parentIsSerial &&
                                            (material.requiresBatchTracking ||
                                              material.requiresSerialTracking) ? (
                                            `${material.quantityIssued}/${material.quantity}`
                                          ) : (
                                            material.quantityIssued
                                          )}
                                        </Td>
                                        <Td className="text-right">
                                          {material.methodType !== "Make" &&
                                            material.requiresBatchTracking ===
                                              false &&
                                            material.requiresSerialTracking ===
                                              false && (
                                              <IconButton
                                                aria-label="Issue Material"
                                                variant="ghost"
                                                icon={<LuGitBranchPlus />}
                                                className="h-8 w-8"
                                                onClick={() => {
                                                  flushSync(() => {
                                                    setSelectedMaterial(
                                                      material
                                                    );
                                                  });
                                                  issueModal.onOpen();
                                                }}
                                              />
                                            )}
                                          {(material.requiresBatchTracking ||
                                            material.requiresSerialTracking) && (
                                            <Button
                                              className="flex-shrink-0"
                                              variant={
                                                someRelatedMaterialIsIssued ||
                                                !isRelatedToOperation
                                                  ? "secondary"
                                                  : "primary"
                                              }
                                              leftIcon={<LuQrCode />}
                                              onClick={() => {
                                                flushSync(() => {
                                                  setSelectedMaterial(material);
                                                });
                                                issueModal.onOpen();
                                              }}
                                            >
                                              Issue
                                            </Button>
                                          )}
                                        </Td>
                                      </Tr>

                                      {kittedChildren &&
                                        kittedChildren.map(
                                          (kittedChild, index) => (
                                            <Tr
                                              key={`kittedChild-${kittedChild.id}`}
                                              className={cn(
                                                index ===
                                                  kittedChildren.length - 1
                                                  ? "border-b"
                                                  : index === 0
                                                  ? "border-t"
                                                  : "",
                                                !isRelatedToOperation &&
                                                  "opacity-50 hover:opacity-100"
                                              )}
                                            >
                                              <Td className="pl-10">
                                                <HStack
                                                  spacing={2}
                                                  className="justify-between"
                                                >
                                                  <VStack spacing={0}>
                                                    <span className="font-semibold">
                                                      {getItemReadableId(
                                                        items,
                                                        kittedChild.itemId
                                                      )}
                                                    </span>
                                                    <span className="text-muted-foreground text-xs">
                                                      {kittedChild.description}
                                                    </span>
                                                  </VStack>
                                                  {kittedChild.requiresBatchTracking ? (
                                                    <Badge variant="secondary">
                                                      <TrackingTypeIcon
                                                        type="Batch"
                                                        className="shrink-0"
                                                      />
                                                    </Badge>
                                                  ) : kittedChild.requiresSerialTracking ? (
                                                    <Badge variant="secondary">
                                                      <TrackingTypeIcon
                                                        type="Serial"
                                                        className="shrink-0"
                                                      />
                                                    </Badge>
                                                  ) : null}
                                                </HStack>
                                              </Td>
                                              <Td className="lg:table-cell hidden">
                                                <Badge variant="secondary">
                                                  <MethodIcon
                                                    type={
                                                      kittedChild.methodType ??
                                                      ""
                                                    }
                                                    isKit={
                                                      kittedChild.kit ?? false
                                                    }
                                                    className="mr-2"
                                                  />
                                                  {kittedChild.methodType ===
                                                    "Make" && kittedChild.kit
                                                    ? "Kit"
                                                    : kittedChild.methodType}
                                                </Badge>
                                              </Td>

                                              <Td>
                                                {parentIsSerial &&
                                                (kittedChild.requiresBatchTracking ||
                                                  kittedChild.requiresSerialTracking)
                                                  ? `${kittedChild.quantity}/${kittedChild.estimatedQuantity}`
                                                  : kittedChild.estimatedQuantity}
                                              </Td>
                                              <Td>
                                                {kittedChild.methodType ===
                                                  "Make" &&
                                                kittedChild.requiresBatchTracking ===
                                                  false &&
                                                kittedChild.requiresSerialTracking ===
                                                  false ? (
                                                  <MethodIcon
                                                    type="Make"
                                                    isKit={
                                                      kittedChild.kit ?? false
                                                    }
                                                  />
                                                ) : parentIsSerial &&
                                                  (kittedChild.requiresBatchTracking ||
                                                    kittedChild.requiresSerialTracking) ? (
                                                  `${kittedChild.quantityIssued}/${kittedChild.quantity}`
                                                ) : (
                                                  kittedChild.quantityIssued
                                                )}
                                              </Td>
                                              <Td className="text-right">
                                                {kittedChild.methodType !==
                                                  "Make" &&
                                                  kittedChild.requiresBatchTracking ===
                                                    false &&
                                                  kittedChild.requiresSerialTracking ===
                                                    false && (
                                                    <IconButton
                                                      aria-label="Issue Material"
                                                      variant="ghost"
                                                      icon={<LuGitBranchPlus />}
                                                      className="h-8 w-8"
                                                      onClick={() => {
                                                        flushSync(() => {
                                                          setSelectedMaterial(
                                                            kittedChild
                                                          );
                                                        });
                                                        issueModal.onOpen();
                                                      }}
                                                    />
                                                  )}
                                                {(kittedChild.requiresBatchTracking ||
                                                  kittedChild.requiresSerialTracking) && (
                                                  <IconButton
                                                    aria-label="Issue Material"
                                                    variant="secondary"
                                                    icon={<LuQrCode />}
                                                    className="h-8 w-8"
                                                    onClick={() => {
                                                      flushSync(() => {
                                                        setSelectedMaterial(
                                                          kittedChild
                                                        );
                                                      });
                                                      issueModal.onOpen();
                                                    }}
                                                  />
                                                )}
                                              </Td>
                                            </Tr>
                                          )
                                        )}
                                    </>
                                  );
                                })
                              )}
                            </Tbody>
                          </Table>
                          {issueModal.isOpen &&
                            selectedMaterial?.requiresBatchTracking !== true &&
                            selectedMaterial?.requiresSerialTracking !==
                              true && (
                              <IssueModal
                                operationId={operation.id}
                                material={selectedMaterial ?? undefined}
                                onClose={() => {
                                  setSelectedMaterial(null);
                                  issueModal.onClose();
                                }}
                              />
                            )}
                          {issueModal.isOpen &&
                            selectedMaterial?.requiresBatchTracking ===
                              true && (
                              <BatchIssueModal
                                parentId={trackedEntityId ?? ""}
                                parentIdIsSerialized={
                                  method?.requiresSerialTracking ?? false
                                }
                                operationId={operation.id}
                                material={selectedMaterial ?? undefined}
                                trackedInputs={
                                  resolvedMaterials?.trackedInputs ?? []
                                }
                                onClose={() => {
                                  setSelectedMaterial(null);
                                  issueModal.onClose();
                                }}
                              />
                            )}
                          {issueModal.isOpen &&
                            selectedMaterial?.requiresSerialTracking ===
                              true && (
                              <SerialIssueModal
                                operationId={operation.id}
                                material={selectedMaterial ?? undefined}
                                parentId={trackedEntityId ?? ""}
                                parentIdIsSerialized={
                                  method?.requiresSerialTracking ?? false
                                }
                                trackedInputs={
                                  resolvedMaterials?.trackedInputs ?? []
                                }
                                onClose={() => {
                                  setSelectedMaterial(null);
                                  issueModal.onClose();
                                }}
                              />
                            )}
                        </>
                      );
                    }}
                  </Await>
                </Suspense>
              </div>
            </div>

            <Separator />
            <div className="flex flex-col items-start justify-between w-full">
              <div className="flex flex-col gap-4 p-4 lg:p-6 w-full">
                <Heading size="h3">Files</Heading>
                <p className="text-muted-foreground text-sm -mt-2">
                  Files related to the job and the opportunity line.
                </p>
                <Suspense
                  key={`files-${operationId}`}
                  fallback={<TableSkeleton />}
                >
                  <Await resolve={files}>
                    {(resolvedFiles) => (
                      <Table className="w-full">
                        <Thead>
                          <Tr>
                            <Th>Name</Th>
                            <Th>Size</Th>
                            <Th></Th>
                          </Tr>
                        </Thead>
                        <Tbody>
                          {resolvedFiles.length === 0 && !modelUpload ? (
                            <Tr>
                              <Td
                                colSpan={24}
                                className="py-8 text-muted-foreground text-center"
                              >
                                No files
                              </Td>
                            </Tr>
                          ) : (
                            <>
                              {modelUpload?.modelName && (
                                <Tr>
                                  <Td>
                                    <HStack>
                                      <LuAxis3D className="text-emerald-500 w-6 h-6" />
                                      <span>{modelUpload.modelName}</span>
                                    </HStack>
                                  </Td>
                                  <Td className="text-xs font-mono">
                                    {modelUpload.modelSize
                                      ? convertKbToString(
                                          Math.floor(
                                            (modelUpload.modelSize ?? 0) / 1024
                                          )
                                        )
                                      : "--"}
                                  </Td>
                                  <Td>
                                    <div className="flex justify-end w-full">
                                      <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                          <IconButton
                                            aria-label="More"
                                            icon={<LuEllipsisVertical />}
                                            variant="secondary"
                                          />
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                          <DropdownMenuItem
                                            onClick={() =>
                                              downloadModel(modelUpload)
                                            }
                                          >
                                            <DropdownMenuIcon
                                              icon={<LuDownload />}
                                            />
                                            Download
                                          </DropdownMenuItem>
                                        </DropdownMenuContent>
                                      </DropdownMenu>
                                    </div>
                                  </Td>
                                </Tr>
                              )}
                              {resolvedFiles.map((file) => {
                                const type = getFileType(file.name);
                                return (
                                  <Tr key={`file-${file.id}`}>
                                    <Td>
                                      <HStack>
                                        <FileIcon type={type} />
                                        <span
                                          className="font-medium"
                                          onClick={() => {
                                            if (
                                              ["PDF", "Image"].includes(type)
                                            ) {
                                              window.open(
                                                path.to.file.previewFile(
                                                  `${"private"}/${getFilePath(
                                                    file
                                                  )}`
                                                ),
                                                "_blank"
                                              );
                                            }
                                          }}
                                        >
                                          {["PDF", "Image"].includes(type) ? (
                                            <FilePreview
                                              bucket="private"
                                              pathToFile={getFilePath(file)}
                                              // @ts-ignore
                                              type={getFileType(file.name)}
                                            >
                                              {file.name}
                                            </FilePreview>
                                          ) : (
                                            file.name
                                          )}
                                        </span>
                                      </HStack>
                                    </Td>
                                    <Td className="text-xs font-mono">
                                      {convertKbToString(
                                        Math.floor(
                                          (file.metadata?.size ?? 0) / 1024
                                        )
                                      )}
                                    </Td>
                                    <Td>
                                      <div className="flex justify-end w-full">
                                        <DropdownMenu>
                                          <DropdownMenuTrigger asChild>
                                            <IconButton
                                              aria-label="More"
                                              icon={<LuEllipsisVertical />}
                                              variant="secondary"
                                            />
                                          </DropdownMenuTrigger>
                                          <DropdownMenuContent align="end">
                                            <DropdownMenuItem
                                              onClick={() => downloadFile(file)}
                                            >
                                              <DropdownMenuIcon
                                                icon={<LuDownload />}
                                              />
                                              Download
                                            </DropdownMenuItem>
                                          </DropdownMenuContent>
                                        </DropdownMenu>
                                      </div>
                                    </Td>
                                  </Tr>
                                );
                              })}
                            </>
                          )}
                        </Tbody>
                      </Table>
                    )}
                  </Await>
                </Suspense>
              </div>
            </div>

            {parentIsSerial && (
              <>
                <Separator />
                <div className="flex flex-col items-start justify-between w-full">
                  <div className="flex flex-col gap-4 p-4 lg:p-6 w-full">
                    <HStack className="justify-between w-full">
                      <Heading size="h3">Serial Numbers</Heading>
                      {trackedEntities?.length > 0 && (
                        <HStack>
                          <SplitButton
                            leftIcon={<LuQrCode />}
                            dropdownItems={labelSizes.map((size) => ({
                              label: size.name,
                              onClick: () =>
                                navigateToTrackingLabels(!!size.zpl, {
                                  labelSize: size.id,
                                }),
                            }))}
                            // TODO: if we knew the preferred label size, we could use that here
                            onClick={() => navigateToTrackingLabels(false)}
                          >
                            Tracking Labels
                          </SplitButton>
                          <Button variant="secondary" leftIcon={<LuBarcode />}>
                            Scan
                          </Button>
                        </HStack>
                      )}
                    </HStack>

                    <Table className="w-full">
                      <Thead>
                        <Tr>
                          <Th>Serial</Th>
                          <Th className="text-right" />
                        </Tr>
                      </Thead>
                      <Tbody>
                        {trackedEntities?.length === 0 ? (
                          <Tr>
                            <Td
                              colSpan={24}
                              className="py-8 text-muted-foreground text-center"
                            >
                              <LuTriangleAlert className="text-red-500 size-4" />
                              No serial numbers
                            </Td>
                          </Tr>
                        ) : (
                          trackedEntities?.map((entity) => (
                            <Tr key={`serial-${entity.id}`}>
                              <Td className="flex gap-2 items-center">
                                <span>{entity.id}</span>
                                {entity.id === trackedEntityId && (
                                  <LuCheck className="text-emerald-500 size-4" />
                                )}
                                <Copy text={entity.id} />
                              </Td>

                              <Td className="text-right">
                                <div className="flex justify-end gap-2">
                                  <IconButton
                                    aria-label="Print Label"
                                    size="sm"
                                    icon={<LuPrinter />}
                                    variant="secondary"
                                    onClick={() => {
                                      navigateToTrackingLabels(false, {
                                        trackedEntityId: entity.id,
                                      });
                                    }}
                                  />
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    isDisabled={entity.id === trackedEntityId}
                                    onClick={() => {
                                      const entityIndex =
                                        trackedEntities.findIndex(
                                          (e) => e.id === entity.id
                                        );
                                      if (entityIndex !== -1) {
                                        setActiveStep(entityIndex);
                                      }
                                      setParams({
                                        trackedEntityId: entity.id,
                                      });
                                    }}
                                  >
                                    Select
                                  </Button>
                                </div>
                              </Td>
                            </Tr>
                          ))
                        )}
                      </Tbody>
                    </Table>
                  </div>
                </div>
              </>
            )}
          </ScrollArea>
        </TabsContent>
        <TabsContent value="model">
          <div className="w-full h-[calc(100dvh-var(--header-height)*2)] p-0">
            <ModelViewer
              file={null}
              key={`model-${operation.itemModelPath ?? job.modelPath}`}
              url={`/file/preview/private/${
                operation.itemModelPath ?? job.modelPath
              }`}
              mode={mode}
              className="rounded-none"
            />
          </div>
        </TabsContent>
        <TabsContent value="procedure" className="flex flex-grow">
          <div className="flex h-[calc(100dvh-var(--header-height)*2-var(--controls-height)-2rem)] w-full">
            <Suspense key={`procedure-${operationId}`}>
              <Await resolve={procedure}>
                {(resolvedProcedure) => {
                  const { attributes, parameters } = resolvedProcedure;
                  if (attributes.length === 0 && parameters.length === 0)
                    return null;

                  return (
                    <ScrollArea className="hidden lg:block w-1/3 border-r shrink-0 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent">
                      <Tabs
                        defaultValue="attributes"
                        className="w-full flex-1 h-full flex flex-col"
                      >
                        <div className="w-full py-2 px-4 sticky top-0 z-10">
                          <TabsList className="w-full grid grid-cols-2">
                            <TabsTrigger value="attributes">Steps</TabsTrigger>
                            <TabsTrigger value="parameters">
                              Parameters
                            </TabsTrigger>
                          </TabsList>
                        </div>
                        <TabsContent
                          value="attributes"
                          className="w-full flex-1 flex flex-col overflow-y-auto data-[state=inactive]:hidden"
                        >
                          <VStack
                            className="w-full flex-1 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent"
                            spacing={0}
                          >
                            {attributes.length > 0 &&
                              (() => {
                                const maxRecords = parentIsSerial
                                  ? trackedEntities.length
                                  : operation.operationQuantity +
                                    operation.quantityScrapped;

                                const isRecordSetStarted = recordSetIsStarted(
                                  attributes,
                                  activeStep
                                );

                                const canCreateNewRecord =
                                  !parentIsSerial && isRecordSetStarted;

                                const canNavigateNext =
                                  isRecordSetStarted &&
                                  activeStep <
                                    operation.operationQuantity +
                                      operation.quantityScrapped -
                                      1;

                                const showNavigation =
                                  hasMultipleRecords ||
                                  attributes.some(
                                    (att) =>
                                      att.jobOperationStepRecord.length > 1
                                  );

                                return (
                                  <div className="flex items-end justify-between gap-1 w-full px-4 pb-2 border-b">
                                    <div className="flex items-center gap-1">
                                      {showNavigation && !parentIsSerial && (
                                        <>
                                          <IconButton
                                            aria-label="Previous record set"
                                            variant="secondary"
                                            icon={<LuChevronLeft />}
                                            onClick={() => {
                                              setActiveStep(activeStep - 1);
                                            }}
                                            isDisabled={activeStep === 0}
                                          />
                                          <span className="text-sm font-medium px-2 min-w-[60px] text-center">
                                            Record {activeStep + 1}
                                          </span>
                                          <IconButton
                                            aria-label="Next record set"
                                            variant="secondary"
                                            icon={<LuChevronRight />}
                                            onClick={() => {
                                              setActiveStep(activeStep + 1);
                                            }}
                                            isDisabled={!canNavigateNext}
                                          />
                                        </>
                                      )}
                                      {canCreateNewRecord &&
                                        !showNavigation && (
                                          <Button
                                            aria-label="Add new record set"
                                            variant="secondary"
                                            leftIcon={<LuCirclePlus />}
                                            onClick={() => {
                                              const nextIndex = activeStep + 1;
                                              if (nextIndex >= maxRecords) {
                                                toast.warning(
                                                  "Maximum number of records reached"
                                                );
                                                return;
                                              }
                                              setHasMultipleRecords(true);
                                              setActiveStep(nextIndex);
                                            }}
                                            isDisabled={
                                              activeStep + 1 >= maxRecords
                                            }
                                          >
                                            New Record
                                          </Button>
                                        )}
                                      {parentIsSerial && (
                                        <Heading size="h2">
                                          {serialIndex + 1} of{" "}
                                          {operation.operationQuantity}
                                        </Heading>
                                      )}
                                    </div>

                                    <div className="flex flex-col justify-center items-end gap-1">
                                      <Progress
                                        value={
                                          (attributes.filter((a) =>
                                            a.jobOperationStepRecord.some(
                                              (r) => r.index === activeStep
                                            )
                                          ).length /
                                            attributes.length) *
                                          100
                                        }
                                        className="h-2 w-24"
                                      />
                                      <span className="text-xs text-muted-foreground">
                                        {
                                          attributes.filter((a) =>
                                            a.jobOperationStepRecord.some(
                                              (r) => r.index === activeStep
                                            )
                                          ).length
                                        }{" "}
                                        of {attributes.length} completed
                                      </span>
                                    </div>
                                  </div>
                                );
                              })()}
                            {attributes.length > 0 && (
                              <>
                                <div className="flex flex-col items-start justify-between w-full">
                                  <div className="flex flex-col w-full">
                                    <div>
                                      {attributes
                                        .sort(
                                          (a, b) =>
                                            (a.sortOrder ?? 0) -
                                            (b.sortOrder ?? 0)
                                        )
                                        .map((step, index) => (
                                          <StepsListItem
                                            key={`step-${step.id}`}
                                            activeStep={activeStep}
                                            step={step}
                                            compact={true}
                                            onRecord={onRecordStepRecord}
                                            onDelete={onDeleteStepRecord}
                                            operationId={operationId}
                                            className={
                                              index === attributes.length - 1
                                                ? "border-none"
                                                : ""
                                            }
                                          />
                                        ))}
                                    </div>
                                  </div>
                                </div>
                              </>
                            )}
                          </VStack>
                        </TabsContent>
                        <TabsContent
                          value="parameters"
                          className="w-full flex-1 flex flex-col overflow-y-auto data-[state=inactive]:hidden"
                        >
                          <VStack
                            className="w-full flex-1 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent"
                            spacing={0}
                          >
                            {parameters.length > 0 && (
                              <>
                                <Separator />
                                <div className="flex flex-col items-start justify-between w-full">
                                  <div className="flex flex-col gap-4 w-full">
                                    <div>
                                      {parameters
                                        .sort((a, b) =>
                                          (a.key ?? "").localeCompare(
                                            b.key ?? ""
                                          )
                                        )
                                        .map((p, index) => (
                                          <ParametersListItem
                                            key={`parameter-${p.id}`}
                                            parameter={p}
                                            operationId={operationId}
                                            className={
                                              index === parameters.length - 1
                                                ? "border-none"
                                                : ""
                                            }
                                          />
                                        ))}
                                    </div>
                                  </div>
                                </div>
                              </>
                            )}
                          </VStack>
                        </TabsContent>
                      </Tabs>
                    </ScrollArea>
                  );
                }}
              </Await>
            </Suspense>

            <ScrollArea className="flex-1 p-4 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent">
              <div
                className="prose dark:prose-invert"
                dangerouslySetInnerHTML={{
                  __html: generateHTML(
                    (operation.workInstruction ?? {}) as JSONContent
                  ),
                }}
              />
            </ScrollArea>
          </div>
        </TabsContent>
        <TabsContent value="chat">
          <OperationChat operation={operation} />
        </TabsContent>
        {!["chat", "procedure"].includes(activeTab) && (
          <Controls>
            <div className="flex flex-col items-center gap-2 p-4">
              <VStack spacing={2}>
                <VStack spacing={1}>
                  <span className="text-muted-foreground text-xs">
                    Work Center
                  </span>
                  <Suspense
                    fallback={<Heading size="h4">...</Heading>}
                    key={`work-center-${operationId}`}
                  >
                    <Await resolve={workCenter}>
                      {(resolvedWorkCenter) =>
                        resolvedWorkCenter.data && (
                          <Heading size="h4" className="line-clamp-1">
                            {resolvedWorkCenter.data?.name}
                          </Heading>
                        )
                      }
                    </Await>
                  </Suspense>
                </VStack>

                <VStack className="hidden tall:flex" spacing={1}>
                  <span className="text-muted-foreground text-xs">Item</span>
                  <Heading size="h4" className="line-clamp-1">
                    {operation.itemReadableId}
                  </Heading>
                </VStack>
              </VStack>

              <div className="md:hidden flex flex-col items-center gap-2 w-full">
                <VStack spacing={1}>
                  <span className="text-muted-foreground text-xs">Job</span>
                  <HStack className="justify-start space-x-2">
                    <LuClipboardCheck className="text-muted-foreground" />
                    <span className="text-sm truncate">
                      {operation.jobReadableId}
                    </span>
                  </HStack>
                </VStack>
                {job.customer?.name && (
                  <VStack spacing={1}>
                    <span className="text-muted-foreground text-xs">
                      Customer
                    </span>
                    <HStack className="justify-start space-x-2">
                      <LuSquareUser className="text-muted-foreground" />
                      <span className="text-sm truncate">
                        {job.customer.name}
                      </span>
                    </HStack>
                  </VStack>
                )}

                {operation.description && (
                  <VStack spacing={1}>
                    <span className="text-muted-foreground text-xs">
                      Description
                    </span>
                    <HStack className="justify-start space-x-2">
                      <LuClipboardCheck className="text-muted-foreground" />
                      <span className="text-sm truncate">
                        {operation.description}
                      </span>
                    </HStack>
                  </VStack>
                )}
                {operation.jobDeadlineType && (
                  <VStack spacing={1}>
                    <span className="text-muted-foreground text-xs">
                      Deadline
                    </span>
                    <HStack className="justify-start space-x-2">
                      <DeadlineIcon
                        deadlineType={operation.jobDeadlineType}
                        overdue={isOverdue}
                      />

                      <span
                        className={cn(
                          "text-sm truncate",
                          isOverdue ? "text-red-500" : ""
                        )}
                      >
                        {["ASAP", "No Deadline"].includes(
                          operation.jobDeadlineType
                        )
                          ? operation.jobDeadlineType
                          : operation.jobDueDate
                          ? `Due ${formatRelativeTime(
                              convertDateStringToIsoString(operation.jobDueDate)
                            )}`
                          : "–"}
                      </span>
                    </HStack>
                  </VStack>
                )}
              </div>

              <WorkTypeToggle
                active={active}
                operation={operation}
                value={eventType}
                onChange={setEventType}
              />

              <StartStopButton
                eventType={eventType as (typeof productionEventType)[number]}
                job={job}
                operation={operation}
                setupProductionEvent={setupProductionEvent}
                laborProductionEvent={laborProductionEvent}
                machineProductionEvent={machineProductionEvent}
                isTrackedActivity={
                  method?.requiresSerialTracking === true ||
                  method?.requiresBatchTracking === true
                }
                trackedEntityId={trackedEntityId}
              />
              <div className="flex flex-row md:flex-col items-center gap-2 justify-center">
                {/* <IconButtonWithTooltip
                  icon={
                    <FaRedoAlt className="text-accent-foreground group-hover:text-accent-foreground/80" />
                  }
                  tooltip="Log Rework"
                  onClick={reworkModal.onOpen}
                /> 
                */}
                <IconButtonWithTooltip
                  disabled={
                    parentIsSerial &&
                    trackedEntities.some(
                      (entity) =>
                        entity.id === trackedEntityId &&
                        `Operation ${operationId}` in
                          (entity.attributes as TrackedEntityAttributes)
                    )
                  }
                  icon={
                    <FaTrash className="text-accent-foreground group-hover:text-accent-foreground/80" />
                  }
                  tooltip="Log Scrap"
                  onClick={scrapModal.onOpen}
                />

                <IconButtonWithTooltip
                  disabled={
                    parentIsSerial &&
                    trackedEntities.some(
                      (entity) =>
                        entity.id === trackedEntityId &&
                        `Operation ${operationId}` in
                          (entity.attributes as TrackedEntityAttributes)
                    )
                  }
                  icon={
                    <FaPlus className="text-accent-foreground group-hover:text-accent-foreground/80" />
                  }
                  tooltip="Log Completed"
                  onClick={completeModal.onOpen}
                />
                <IconButtonWithTooltip
                  icon={<FaCheck />}
                  variant={
                    operation.quantityComplete === operation.operationQuantity
                      ? "success"
                      : "default"
                  }
                  tooltip="Close Out"
                  onClick={finishModal.onOpen}
                />
              </div>
            </div>
          </Controls>
        )}
        {!["chat"].includes(activeTab) && (
          <Times>
            <div className=" lg:p-6">
              <div className="flex flex-col w-full gap-2">
                {operation.setupDuration > 0 && (
                  <HStack>
                    <Tooltip>
                      <TooltipTrigger>
                        <LuTimer className="h-4 w-4 mr-1" />
                      </TooltipTrigger>
                      <TooltipContent side="right">Setup</TooltipContent>
                    </Tooltip>
                    <Progress
                      numerator={formatDurationMilliseconds(progress.setup)}
                      denominator={formatDurationMilliseconds(
                        operation.setupDuration
                      )}
                      value={(progress.setup / operation.setupDuration) * 100}
                      indicatorClassName={
                        progress.setup > operation.setupDuration
                          ? "bg-red-500"
                          : ""
                      }
                    />
                  </HStack>
                )}
                {operation.laborDuration > 0 && (
                  <HStack>
                    <Tooltip>
                      <TooltipTrigger>
                        <LuHardHat className="h-4 w-4 mr-1" />
                      </TooltipTrigger>
                      <TooltipContent side="right">Labor</TooltipContent>
                    </Tooltip>
                    <Progress
                      numerator={formatDurationMilliseconds(progress.labor)}
                      denominator={formatDurationMilliseconds(
                        operation.laborDuration
                      )}
                      value={(progress.labor / operation.laborDuration) * 100}
                      indicatorClassName={
                        progress.labor > operation.laborDuration
                          ? "bg-red-500"
                          : ""
                      }
                    />
                  </HStack>
                )}
                {operation.machineDuration > 0 && (
                  <HStack>
                    <Tooltip>
                      <TooltipTrigger>
                        <LuHammer className="h-4 w-4 mr-1" />
                      </TooltipTrigger>
                      <TooltipContent side="right">Machine</TooltipContent>
                    </Tooltip>
                    <Progress
                      numerator={formatDurationMilliseconds(progress.machine)}
                      denominator={formatDurationMilliseconds(
                        operation.machineDuration
                      )}
                      value={
                        (progress.machine / operation.machineDuration) * 100
                      }
                      indicatorClassName={
                        progress.machine > operation.machineDuration
                          ? "bg-red-500"
                          : ""
                      }
                    />
                  </HStack>
                )}
                <HStack>
                  <Tooltip>
                    <TooltipTrigger>
                      <FaTasks className="h-4 w-4 mr-1" />
                    </TooltipTrigger>
                    <TooltipContent side="right">Quantity</TooltipContent>
                  </Tooltip>
                  <Progress
                    indicatorClassName={
                      operation.operationStatus === "Paused" &&
                      operation.quantityComplete < operation.operationQuantity
                        ? "bg-yellow-500"
                        : ""
                    }
                    numerator={operation.quantityComplete.toString()}
                    denominator={operation.operationQuantity.toString()}
                    value={
                      (operation.quantityComplete /
                        operation.operationQuantity) *
                      100
                    }
                  />
                </HStack>
              </div>
            </div>
          </Times>
        )}
      </Tabs>
      {reworkModal.isOpen && (
        <QuantityModal
          type="rework"
          laborProductionEvent={laborProductionEvent}
          machineProductionEvent={machineProductionEvent}
          operation={operation}
          parentIsSerial={parentIsSerial}
          parentIsBatch={parentIsBatch}
          setupProductionEvent={setupProductionEvent}
          trackedEntityId={trackedEntityId}
          onClose={reworkModal.onClose}
        />
      )}
      {scrapModal.isOpen && (
        <QuantityModal
          type="scrap"
          laborProductionEvent={laborProductionEvent}
          machineProductionEvent={machineProductionEvent}
          operation={operation}
          parentIsSerial={parentIsSerial}
          parentIsBatch={parentIsBatch}
          setupProductionEvent={setupProductionEvent}
          trackedEntityId={trackedEntityId}
          onClose={scrapModal.onClose}
        />
      )}
      {completeModal.isOpen && (
        <Suspense key={`complete-modal-${operationId}`}>
          <Await resolve={materials}>
            {(resolvedMaterials) => {
              return (
                <QuantityModal
                  type="complete"
                  laborProductionEvent={laborProductionEvent}
                  machineProductionEvent={machineProductionEvent}
                  materials={resolvedMaterials.materials}
                  operation={operation}
                  parentIsSerial={parentIsSerial}
                  parentIsBatch={parentIsBatch}
                  setupProductionEvent={setupProductionEvent}
                  trackedEntityId={trackedEntityId}
                  onClose={completeModal.onClose}
                />
              );
            }}
          </Await>
        </Suspense>
      )}
      {/* @ts-ignore */}
      {finishModal.isOpen && (
        <Suspense key={`finish-modal-${operationId}`}>
          <Await resolve={procedure}>
            {(resolvedProcedure) => {
              const { attributes } = resolvedProcedure;
              const allStepsRecorded = attributes.every(
                (a) => a.jobOperationStepRecord !== null
              );
              return (
                <QuantityModal
                  type="finish"
                  allStepsRecorded={allStepsRecorded}
                  laborProductionEvent={laborProductionEvent}
                  machineProductionEvent={machineProductionEvent}
                  operation={operation}
                  setupProductionEvent={setupProductionEvent}
                  trackedEntityId={trackedEntityId}
                  onClose={finishModal.onClose}
                />
              );
            }}
          </Await>
        </Suspense>
      )}

      {serialModal.isOpen && (
        <SerialSelectorModal
          availableEntities={availableEntities}
          onClose={serialModal.onClose}
          onCancel={() => navigate(path.to.operations)}
          onSelect={(entity) => {
            const entityIndex = availableEntities.findIndex(
              (e) => e.id === entity.id
            );
            if (entityIndex !== -1) {
              setActiveStep(entityIndex);
            }
            setParams({
              trackedEntityId: entity.id,
            });
            serialModal.onClose();
          }}
        />
      )}

      {attributeRecordModal.isOpen && selectedStep ? (
        <RecordModal
          key={selectedStep.id}
          activeStep={activeStep}
          attribute={selectedStep}
          onClose={onDeselectStep}
        />
      ) : null}

      {attributeRecordDeleteModal.isOpen && selectedStep && (
        <DeleteStepRecordModal
          onClose={onDeselectStep}
          id={
            selectedStep?.jobOperationStepRecord.find(
              (r) => r.index === activeStep
            )?.id ?? ""
          }
          title="Delete Step"
          description="Are you sure you want to delete this step?"
        />
      )}
    </>
  );
};

function recordSetIsStarted(
  attributes: JobOperationStep[],
  activeStep: number
) {
  return attributes.some((att) =>
    att.jobOperationStepRecord.some(
      (record) =>
        record.index === activeStep &&
        (record.value !== null ||
          record.numericValue !== null ||
          record.booleanValue !== null ||
          record.userValue !== null)
    )
  );
}
