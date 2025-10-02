import {
  Alert,
  AlertDescription,
  AlertTitle,
  Avatar,
  Badge,
  Button,
  Checkbox,
  cn,
  Combobox as ComboboxBase,
  Copy,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Heading,
  HStack,
  IconButton,
  Input,
  InputGroup,
  InputRightElement,
  Loading,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModelViewer,
  NumberDecrementStepper,
  NumberField,
  NumberIncrementStepper,
  NumberInput,
  NumberInputGroup,
  NumberInputStepper,
  Progress,
  ScrollArea,
  Separator,
  SidebarTrigger,
  Skeleton,
  SplitButton,
  Switch,
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
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  Tr,
  useDebounce,
  useDisclosure,
  useInterval,
  useMount,
  VStack,
  type JSONContent,
} from "@carbon/react";
import { generateHTML } from "@carbon/react/Editor";
import {
  Await,
  useFetcher,
  useNavigate,
  useParams,
  useRevalidator,
} from "@remix-run/react";
import type { ComponentProps, ReactNode } from "react";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DeadlineIcon,
  FileIcon,
  FilePreview,
  OperationStatusIcon,
} from "~/components";
import { useUrlParams, useUser } from "~/hooks";
import type { productionEventType } from "~/services/models";
import {
  finishValidator,
  issueValidator,
  nonScrapQuantityValidator,
  productionEventValidator,
  scrapQuantityValidator,
  stepRecordValidator,
} from "~/services/models";
import type {
  Job,
  JobMakeMethod,
  JobMaterial,
  JobOperationAttribute,
  JobOperationParameter,
  Kanban,
  OperationWithDetails,
  ProductionEvent,
  ProductionQuantity,
  StorageItem,
  TrackedEntity,
  TrackedInput,
} from "~/services/types";
import { path } from "~/utils/path";

import type { Result } from "@carbon/auth";
import { useCarbon } from "@carbon/auth";
import {
  Combobox,
  DateTimePicker,
  Hidden,
  Input as InputField,
  Number,
  NumberControlled,
  Select,
  Submit,
  TextArea,
  ValidatedForm,
} from "@carbon/form";
import { useKeyboardWedge, useMode } from "@carbon/remix";
import type { TrackedEntityAttributes } from "@carbon/utils";
import {
  convertDateStringToIsoString,
  convertKbToString,
  formatDate,
  formatDateTime,
  formatDurationMilliseconds,
  formatRelativeTime,
  getItemReadableId,
  labelSizes,
} from "@carbon/utils";
import {
  getLocalTimeZone,
  now,
  parseAbsolute,
  toZoned,
} from "@internationalized/date";
import { useNumberFormatter } from "@react-aria/i18n";
import type {
  PostgrestSingleResponse,
  RealtimeChannel,
} from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import { flushSync } from "react-dom";
import { FaTasks } from "react-icons/fa";
import { FaCheck, FaPause, FaPlay, FaPlus, FaTrash } from "react-icons/fa6";
import {
  LuActivity,
  LuAxis3D,
  LuBarcode,
  LuCheck,
  LuChevronDown,
  LuChevronLeft,
  LuChevronRight,
  LuChevronUp,
  LuCircleCheck,
  LuCirclePlus,
  LuClipboardCheck,
  LuDownload,
  LuEllipsisVertical,
  LuFile,
  LuGitBranchPlus,
  LuHammer,
  LuHardHat,
  LuList,
  LuPaperclip,
  LuPrinter,
  LuQrCode,
  LuSend,
  LuSquareUser,
  LuTimer,
  LuTrash,
  LuTriangleAlert,
  LuUndo2,
  LuX,
} from "react-icons/lu";
import {
  MethodIcon,
  ProcedureStepTypeIcon,
  TrackingTypeIcon,
} from "~/components/Icons";
import type {
  getBatchNumbersForItem,
  getSerialNumbersForItem,
} from "~/services/inventory.service";
import { getFileType } from "~/services/operations.service";
import { useItems, usePeople } from "~/stores";
import FileDropzone from "./FileDropzone";
import ItemThumbnail from "./ItemThumbnail";
import ScrapReason from "./ScrapReason";

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
    attributes: JobOperationAttribute[];
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

  const [selectedAttribute, setSelectedAttribute] =
    useState<JobOperationAttribute | null>(null);

  const onRecordAttributeRecord = (attribute: JobOperationAttribute) => {
    flushSync(() => {
      setSelectedAttribute(attribute);
    });
    attributeRecordModal.onOpen();
  };

  const onDeleteAttributeRecord = (attribute: JobOperationAttribute) => {
    flushSync(() => {
      setSelectedAttribute(attribute);
    });
    attributeRecordDeleteModal.onOpen();
  };

  const onDeselectAttribute = () => {
    setSelectedAttribute(null);
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
                                  .map((a, index) => (
                                    <AttributesListItem
                                      key={`attribute-${a.id}`}
                                      activeStep={activeStep}
                                      attribute={a}
                                      onRecord={onRecordAttributeRecord}
                                      onDelete={onDeleteAttributeRecord}
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
                                            <IconButton
                                              aria-label="Issue Material"
                                              variant="secondary"
                                              icon={<LuQrCode />}
                                              className="h-8 w-8"
                                              onClick={() => {
                                                flushSync(() => {
                                                  setSelectedMaterial(material);
                                                });
                                                issueModal.onOpen();
                                              }}
                                            />
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
                                        .map((a, index) => (
                                          <AttributesListItem
                                            key={`attribute-${a.id}`}
                                            activeStep={activeStep}
                                            attribute={a}
                                            compact={true}
                                            onRecord={onRecordAttributeRecord}
                                            onDelete={onDeleteAttributeRecord}
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
              const allAttributesRecorded = attributes.every(
                (a) => a.jobOperationStepRecord !== null
              );
              return (
                <QuantityModal
                  type="finish"
                  allAttributesRecorded={allAttributesRecorded}
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

      {attributeRecordModal.isOpen && selectedAttribute ? (
        <RecordModal
          key={selectedAttribute.id}
          activeStep={activeStep}
          attribute={selectedAttribute}
          onClose={onDeselectAttribute}
        />
      ) : null}

      {attributeRecordDeleteModal.isOpen && selectedAttribute && (
        <DeleteAttributeRecordModal
          onClose={onDeselectAttribute}
          id={
            selectedAttribute?.jobOperationStepRecord.find(
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

type Message = {
  id: string;
  createdBy: string;
  createdAt: string;
  note: string;
};

function recordSetIsStarted(
  attributes: JobOperationAttribute[],
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

function OperationChat({ operation }: { operation: OperationWithDetails }) {
  const user = useUser();
  const [employees] = usePeople();
  const [messages, setMessages] = useState<Message[]>([]);

  const [isLoading, setIsLoading] = useState(false);
  const { carbon, accessToken } = useCarbon();

  const fetchChats = async () => {
    if (!carbon) return;
    flushSync(() => {
      setIsLoading(true);
    });

    const { data, error } = await carbon
      ?.from("jobOperationNote")
      .select("*")
      .eq("jobOperationId", operation.id)
      .order("createdAt", { ascending: true });

    if (error) {
      console.error(error);
      return;
    }
    setMessages(data);
    setIsLoading(false);
  };

  useMount(() => {
    fetchChats();
  });

  const channelRef = useRef<RealtimeChannel | null>(null);

  useMount(() => {
    if (!channelRef.current && carbon && accessToken) {
      carbon.realtime.setAuth(accessToken);
      channelRef.current = carbon
        .channel(`job-operation-notes-${operation.id}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "jobOperationNote",
            filter: `jobOperationId=eq.${operation.id}`,
          },
          (payload) => {
            setMessages((prev) => {
              if (prev.some((note) => note.id === payload.new.id)) {
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
      block: "start",
      behavior: messages.length > 0 ? "smooth" : "auto",
    });
  }, [messages]);

  const [message, setMessage] = useState("");

  const notify = useDebounce(
    async () => {
      if (!carbon) return;

      const response = await fetch(path.to.messagingNotify, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "jobOperationNote",
          operationId: operation.id,
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
      jobOperationId: operation.id,
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
    <div className="flex flex-col h-[calc(100dvh-var(--header-height)*2)]">
      <ScrollArea className="flex-1 p-4">
        <Loading isLoading={isLoading}>
          <div className="flex flex-col gap-3">
            {messages.map((m) => {
              const createdBy = employees.find(
                (employee) => employee.id === m.createdBy
              );
              const isUser = m.createdBy === user.id;
              return (
                <div
                  key={`message-${m.id}`}
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
            })}
            <div ref={messagesEndRef} style={{ height: 0 }} />
          </div>
        </Loading>
      </ScrollArea>

      <div className="border-t p-4">
        <form className="flex gap-2" onSubmit={handleSubmit}>
          <Input
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

function useOperation({
  operation,
  events,
  trackedEntities,
  pauseInterval,
  procedure,
}: {
  operation: OperationWithDetails;
  events: ProductionEvent[];
  trackedEntities: TrackedEntity[];
  pauseInterval: boolean;
  procedure: Promise<{
    attributes: JobOperationAttribute[];
    parameters: JobOperationParameter[];
  }>;
}) {
  const [params] = useUrlParams();
  const trackedEntityParam = params.get("trackedEntityId");
  const { carbon, accessToken } = useCarbon();
  const user = useUser();
  const revalidator = useRevalidator();
  const channelRef = useRef<RealtimeChannel | null>(null);

  const scrapModal = useDisclosure();
  const reworkModal = useDisclosure();
  const completeModal = useDisclosure();
  const finishModal = useDisclosure();
  const issueModal = useDisclosure();
  const serialModal = useDisclosure();

  // we do this to avoid re-rendering when the modal is open
  const isAnyModalOpen =
    pauseInterval ||
    scrapModal.isOpen ||
    reworkModal.isOpen ||
    completeModal.isOpen ||
    finishModal.isOpen ||
    issueModal.isOpen ||
    serialModal.isOpen;

  const [selectedMaterial, setSelectedMaterial] = useState<JobMaterial | null>(
    null
  );

  const [activeTab, setActiveTab] = useState("details");
  const [eventType, setEventType] = useState(() => {
    if (operation.setupDuration > 0) {
      return "Setup";
    }
    if (operation.machineDuration > 0) {
      return "Machine";
    }
    return "Labor";
  });

  const [operationState, setOperationState] = useState(operation);

  const [eventState, setEventState] = useState<ProductionEvent[]>(events);

  useEffect(() => {
    setEventState(events);
  }, [events]);

  useEffect(() => {
    setOperationState(operation);
  }, [operation]);

  useMount(() => {
    if (!channelRef.current && carbon && accessToken) {
      carbon.realtime.setAuth(accessToken);
      channelRef.current = carbon
        .channel(`job-operations:${operation.id}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "job",
            filter: `id=eq.${operation.jobId}`,
          },
          (payload) => {
            if (payload.eventType === "UPDATE") {
              revalidator.revalidate();
            }
          }
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "productionEvent",
            filter: `jobOperationId=eq.${operation.id}`,
          },
          (payload) => {
            switch (payload.eventType) {
              case "INSERT":
                const { new: inserted } = payload;
                setEventState((prevEvents) => [
                  ...prevEvents,
                  inserted as ProductionEvent,
                ]);
                break;
              case "UPDATE":
                const { new: updated } = payload;

                setEventState((prevEvents) =>
                  prevEvents.map((event) =>
                    event.id === updated.id
                      ? ({
                          ...event,
                          ...updated,
                        } as ProductionEvent)
                      : event
                  )
                );
                break;
              case "DELETE":
                const { old: deleted } = payload;
                setEventState((prevEvents) =>
                  prevEvents.filter((event) => event.id !== deleted.id)
                );
                break;
              default:
                break;
            }
          }
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "jobOperation",
            filter: `id=eq.${operation.id}`,
          },
          (payload) => {
            if (payload.eventType === "UPDATE") {
              const updated = payload.new;
              setOperationState((prev) => ({
                ...prev,
                ...updated,
                operationStatus: updated.status ?? prev.operationStatus,
              }));
            } else if (payload.eventType === "DELETE") {
              toast.error("This operation has been deleted");
              window.location.href = path.to.operations;
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
  });

  useEffect(() => {
    if (carbon && accessToken && channelRef.current)
      carbon.realtime.setAuth(accessToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const getProgress = useCallback(() => {
    const timeNow = now(getLocalTimeZone());
    return eventState.reduce(
      (acc, event) => {
        if (event.endTime && event.type) {
          acc[event.type.toLowerCase() as keyof typeof acc] +=
            (event.duration ?? 0) * 1000;
        } else if (event.startTime && event.type) {
          const startTime = toZoned(
            parseAbsolute(event.startTime, getLocalTimeZone()),
            getLocalTimeZone()
          );

          const difference = timeNow.compare(startTime);

          if (difference > 0) {
            acc[event.type.toLowerCase() as keyof typeof acc] += difference;
          }
        }
        return acc;
      },
      {
        setup: 0,
        labor: 0,
        machine: 0,
      }
    );
  }, [eventState]);

  const [progress, setProgress] = useState<{
    setup: number;
    labor: number;
    machine: number;
  }>(getProgress);

  const activeEvents = useMemo(() => {
    return {
      setupProductionEvent: events.find(
        (e) =>
          e.type === "Setup" && e.endTime === null && e.employeeId === user.id
      ),
      laborProductionEvent: events.find(
        (e) =>
          e.type === "Labor" && e.endTime === null && e.employeeId === user.id
      ),
      machineProductionEvent: eventState.find(
        (e) => e.type === "Machine" && e.endTime === null
      ),
    };
  }, [eventState, events, user.id]);

  const active = useMemo(() => {
    return {
      setup: !!activeEvents.setupProductionEvent,
      labor: !!activeEvents.laborProductionEvent,
      machine: !!activeEvents.machineProductionEvent,
    };
  }, [activeEvents]);

  useInterval(
    () => {
      setProgress(getProgress());
    },
    (active.setup || active.labor || active.machine) && !isAnyModalOpen
      ? 1000
      : null
  );

  const { operationId } = useParams();
  const [availableEntities, setAvailableEntities] = useState<TrackedEntity[]>(
    []
  );
  // show the serial selector with the remaining serial numbers for the operation
  useEffect(() => {
    if (trackedEntityParam) return;
    const uncompletedEntities = trackedEntities.filter(
      (entity) =>
        !(
          `Operation ${operationId}` in
          ((entity.attributes as TrackedEntityAttributes) ?? {})
        )
    );
    if (uncompletedEntities.length > 0) serialModal.onOpen();
    setAvailableEntities(uncompletedEntities);
    // causes an infinite loop on navigation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackedEntities, trackedEntityParam]);

  return {
    active,
    availableEntities,
    hasActiveEvents:
      progress.setup > 0 || progress.labor > 0 || progress.machine > 0,
    ...activeEvents,
    progress,
    operation: operationState,

    activeTab,
    eventType,
    scrapModal,
    reworkModal,
    completeModal,
    finishModal,
    issueModal,
    serialModal,
    isOverdue: operation.jobDueDate
      ? new Date(operation.jobDueDate) < new Date()
      : false,
    selectedMaterial,
    setSelectedMaterial,
    setActiveTab,
    setEventType,
  };
}

function useFiles(job: Job) {
  const user = useUser();

  const getFilePath = useCallback(
    (file: StorageItem) => {
      const companyId = user.company.id;
      const { bucket } = file;
      let id: string | null = "";

      switch (bucket) {
        case "job":
          id = job.id;
          break;
        case "opportunity-line":
          id = job.salesOrderLineId ?? job.quoteLineId;
          break;
        case "parts":
          id = job.itemId;
          break;
      }

      return `${companyId}/${bucket}/${id}/${file.name}`;
    },
    [job.id, job.itemId, job.quoteLineId, job.salesOrderLineId, user.company.id]
  );

  const downloadFile = useCallback(
    async (file: StorageItem) => {
      const url = path.to.file.previewFile(`private/${getFilePath(file)}`);
      try {
        const response = await fetch(url);
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        document.body.appendChild(a);
        a.href = blobUrl;
        a.download = file.name;
        a.click();
        window.URL.revokeObjectURL(blobUrl);
        document.body.removeChild(a);
      } catch (error) {
        toast.error("Error downloading file");
        console.error(error);
      }
    },
    [getFilePath]
  );

  const downloadModel = useCallback(
    async (model: { modelPath: string; modelName: string }) => {
      if (!model.modelPath || !model.modelName) {
        toast.error("Model data is missing");
        return;
      }

      const url = path.to.file.previewFile(`private/${model.modelPath}`);
      try {
        const response = await fetch(url);
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        document.body.appendChild(a);
        a.href = blobUrl;
        a.download = model.modelName;
        a.click();
        window.URL.revokeObjectURL(blobUrl);
        document.body.removeChild(a);
      } catch (error) {
        toast.error("Error downloading file");
        console.error(error);
      }
    },
    []
  );

  return {
    downloadFile,
    downloadModel,
    getFilePath,
  };
}

function TableSkeleton() {
  return (
    <Table>
      <Thead>
        <Tr>
          <Th>
            <Skeleton className="h-4 w-full" />
          </Th>
          <Th>
            <Skeleton className="h-4 w-full" />
          </Th>
        </Tr>
      </Thead>
      <Tbody>
        {[...Array(5)].map((_, index) => (
          <Tr key={`skeleton-${index}`}>
            <Td>
              <Skeleton className="h-4 w-full" />
            </Td>
            <Td>
              <Skeleton className="h-4 w-full" />
            </Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}

function Controls({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col md:absolute p-2 top-[calc(var(--header-height)*2-2px)] right-0 w-full md:w-[var(--controls-width)] md:min-h-[180px] z-1 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 md:border-l border-y md:rounded-bl-lg",
        className
      )}
    >
      {children}
    </div>
  );
}

function Times({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <TooltipProvider>
      <div
        className={cn(
          "flex flex-col md:absolute p-2 bottom-2 md:left-1/2 md:transform md:-translate-x-1/2 w-full md:w-[calc(100%-2rem)] z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b md:border md:rounded-lg",
          className
        )}
      >
        {children}
      </div>
    </TooltipProvider>
  );
}

function ButtonWithTooltip({
  tooltip,
  children,
  ...props
}: ComponentProps<"button"> & { tooltip: string }) {
  return (
    <Tooltip>
      <TooltipTrigger>
        <button {...props}>{children}</button>
      </TooltipTrigger>
      <TooltipContent side="top">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function IconButtonWithTooltip({
  icon,
  tooltip,
  disabled,
  variant,
  ...props
}: ComponentProps<"button"> & {
  icon: ReactNode;
  tooltip: string;
  variant?: "default" | "success" | "destructive";
  disabled?: boolean;
}) {
  return (
    <ButtonWithTooltip
      {...props}
      tooltip={tooltip}
      disabled={disabled}
      className={cn(
        "size-16 text-xl md:text-lg md:size-[8dvh] flex flex-row items-center gap-2 justify-center bg-accent rounded-full shadow-lg hover:cursor-pointer hover:shadow-xl hover:accent hover:scale-105 transition-all disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-30 text-accent-foreground group-hover:text-accent-foreground/80",
        variant === "success" &&
          "bg-emerald-500 !text-white hover:bg-emerald-600 hover:text-white",
        variant === "destructive" &&
          "bg-red-500 !text-white hover:bg-red-600 hover:text-white"
      )}
    >
      {icon}
    </ButtonWithTooltip>
  );
}

function WorkTypeToggle({
  active,
  operation,
  value,
  onChange,
  className,
}: {
  active: { setup: boolean; labor: boolean; machine: boolean };
  operation: OperationWithDetails;
  value: string;
  onChange: (type: string) => void;
  className?: string;
}) {
  const count = useMemo(() => {
    let count = 0;
    if (operation.setupDuration > 0) {
      count++;
    }
    if (operation.laborDuration > 0) {
      count++;
    }
    if (operation.machineDuration > 0) {
      count++;
    }
    return count;
  }, [
    operation.laborDuration,
    operation.machineDuration,
    operation.setupDuration,
  ]);

  return (
    <ToggleGroup
      value={value}
      type="single"
      onValueChange={onChange}
      disabled={!!value && count <= 1}
      className={cn(
        "grid w-full",
        count <= 1 && "grid-cols-1",
        count === 2 && "grid-cols-2 py-2",
        count === 3 && "grid-cols-3 py-2",
        className
      )}
    >
      {operation.setupDuration > 0 && (
        <ToggleGroupItem
          className="flex flex-col items-center relative justify-center text-center h-14 w-full"
          value="Setup"
          size="lg"
          aria-label="Toggle setup"
        >
          <LuTimer className="size-6 pt-1" />
          <span className="text-xxs">Setup</span>
          {active.setup && (
            <span className="absolute -top-1 -right-1 h-3 w-3 bg-emerald-500 rounded-full" />
          )}
        </ToggleGroupItem>
      )}
      {operation.laborDuration > 0 && (
        <ToggleGroupItem
          className="flex flex-col items-center relative justify-center text-center h-14 w-full"
          value="Labor"
          size="lg"
          aria-label="Toggle labor"
        >
          <LuHardHat className="size-6 pt-1" />
          <span className="text-xxs">Labor</span>
          {active.labor && (
            <span className="absolute -top-1 -right-1 h-3 w-3 bg-emerald-500 rounded-full" />
          )}
        </ToggleGroupItem>
      )}
      {operation.machineDuration > 0 && (
        <ToggleGroupItem
          className="flex flex-col items-center relative justify-center text-center h-14 w-full"
          value="Machine"
          size="lg"
          aria-label="Toggle machine"
        >
          <LuHammer className="size-6 pt-1" />
          <span className="text-xxs">Machine</span>
          {active.machine && (
            <span className="absolute -top-1 -right-1 h-3 w-3 bg-emerald-500 rounded-full" />
          )}
        </ToggleGroupItem>
      )}
    </ToggleGroup>
  );
}

const startStopFormId = "start-stop-form";
function StartStopButton({
  className,
  job,
  operation,
  eventType,
  setupProductionEvent,
  laborProductionEvent,
  machineProductionEvent,
  isTrackedActivity,
  trackedEntityId,
  ...props
}: ComponentProps<"button"> & {
  eventType: (typeof productionEventType)[number];
  job: Job;
  operation: OperationWithDetails;
  setupProductionEvent: ProductionEvent | undefined;
  laborProductionEvent: ProductionEvent | undefined;
  machineProductionEvent: ProductionEvent | undefined;
  isTrackedActivity: boolean;
  trackedEntityId: string | undefined;
}) {
  const fetcher = useFetcher<ProductionEvent>();

  const isActive = useMemo(() => {
    if (fetcher.formData?.get("action") === "End") {
      return false;
    }
    if (eventType === "Setup") {
      return (
        (fetcher.formData?.get("action") === "Start" &&
          fetcher.formData.get("type") === "Setup") ||
        !!setupProductionEvent
      );
    }
    if (eventType === "Labor") {
      return (
        (fetcher.formData?.get("action") === "Start" &&
          fetcher.formData.get("type") === "Labor") ||
        !!laborProductionEvent
      );
    }
    return (
      (fetcher.formData?.get("action") === "Start" &&
        fetcher.formData.get("type") === "Machine") ||
      !!machineProductionEvent
    );
  }, [
    eventType,
    setupProductionEvent,
    laborProductionEvent,
    machineProductionEvent,
    fetcher.formData,
  ]);

  const id = useMemo(() => {
    if (eventType === "Setup") {
      return setupProductionEvent?.id;
    }
    if (eventType === "Labor") {
      return laborProductionEvent?.id;
    }
    return machineProductionEvent?.id;
  }, [
    eventType,
    setupProductionEvent,
    laborProductionEvent,
    machineProductionEvent,
  ]);

  return (
    <ValidatedForm
      id={startStopFormId}
      action={path.to.productionEvent}
      method="post"
      validator={productionEventValidator}
      defaultValues={{
        id,
        jobOperationId: operation.id,
        timezone: getLocalTimeZone(),
        action: isActive ? "End" : "Start",
        type: eventType,
        workCenterId: operation.workCenterId ?? undefined,
      }}
      fetcher={fetcher}
    >
      <Hidden name="id" value={id} />
      {isTrackedActivity && (
        <Hidden name="trackedEntityId" value={trackedEntityId} />
      )}
      <Hidden name="jobOperationId" value={operation.id} />
      <Hidden name="timezone" />

      <Hidden name="action" value={isActive ? "End" : "Start"} />
      <Hidden name="type" value={eventType} />
      <Hidden name="workCenterId" value={operation.workCenterId ?? undefined} />
      {isActive ? (
        <PauseButton disabled={fetcher.state !== "idle"} type="submit" />
      ) : (
        <PlayButton disabled={fetcher.state !== "idle"} type="submit" />
      )}
    </ValidatedForm>
  );
}

function PauseButton({ className, ...props }: ComponentProps<"button">) {
  return (
    <ButtonWithTooltip
      {...props}
      tooltip="Pause"
      className="group size-24 tall:size-32 flex flex-row items-center gap-2 justify-center bg-red-500 rounded-full shadow-lg hover:cursor-pointer hover:drop-shadow-xl hover:bg-red-600 hover:scale-105 transition-all text-accent disabled:bg-muted disabled:text-muted-foreground/80 text-4xl border-b-4 border-red-700 active:border-b-0 active:translate-y-1 disabled:bg-gray-500 disabled:hover:bg-gray-600 disabled:border-gray-700 disabled:text-white"
    >
      <FaPause className="group-hover:scale-110" />
    </ButtonWithTooltip>
  );
}

function PlayButton({ className, ...props }: ComponentProps<"button">) {
  return (
    <ButtonWithTooltip
      {...props}
      tooltip="Start"
      className="group size-24 tall:size-32 flex flex-row items-center gap-2 justify-center bg-emerald-500 rounded-full shadow-lg hover:cursor-pointer hover:drop-shadow-xl hover:bg-emerald-600 hover:scale-105 transition-all text-accent disabled:bg-muted disabled:text-muted-foreground/80 text-4xl border-b-4 border-emerald-700 active:border-b-0 active:translate-y-1 disabled:bg-gray-500 disabled:hover:bg-gray-600 disabled:border-gray-700 disabled:text-white"
    >
      <FaPlay className="group-hover:scale-110" />
    </ButtonWithTooltip>
  );
}

function QuantityModal({
  allAttributesRecorded = true,
  laborProductionEvent,
  machineProductionEvent,
  materials = [],
  operation,
  parentIsSerial = false,
  parentIsBatch = false,
  setupProductionEvent,
  trackedEntityId,
  type,
  onClose,
}: {
  allAttributesRecorded?: boolean;
  laborProductionEvent: ProductionEvent | undefined;
  machineProductionEvent: ProductionEvent | undefined;
  materials?: JobMaterial[];
  operation: OperationWithDetails;
  parentIsSerial?: boolean;
  parentIsBatch?: boolean;
  setupProductionEvent: ProductionEvent | undefined;
  trackedEntityId: string;
  type: "scrap" | "rework" | "complete" | "finish";
  onClose: () => void;
}) {
  const fetcher = useFetcher<ProductionQuantity>();
  const [quantity, setQuantity] = useState(type === "finish" ? 0 : 1);

  const titleMap = {
    scrap: `Log scrap for ${operation.itemReadableId}`,
    rework: `Log rework for ${operation.itemReadableId}`,
    complete: `Log completed for ${operation.itemReadableId}`,
    finish: `Close out ${operation.itemReadableId}`,
  };

  const isOperationComplete =
    operation.quantityComplete >= operation.operationQuantity;

  const descriptionMap = {
    scrap: "Select a scrap quantity and reason",
    rework: "Select a rework quantity",
    complete: "Select a completion quantity",
    finish:
      "Are you sure you want to close out this operation? This will end all active production events for this operation.",
  };

  const actionMap = {
    scrap: path.to.scrap,
    rework: path.to.rework,
    complete: path.to.complete,
    finish: path.to.finish,
  };

  const actionButtonMap = {
    scrap: "Log Scrap",
    rework: "Log Rework",
    complete: "Log Completed",
    finish: isOperationComplete ? "Close" : "Close Anyways",
  };

  const validatorMap = {
    scrap: scrapQuantityValidator,
    rework: nonScrapQuantityValidator,
    complete: nonScrapQuantityValidator,
    finish: finishValidator,
  };

  const hasUnissuedMaterials = useMemo(() => {
    return (
      parentIsSerial &&
      materials.some(
        (material) =>
          material.jobOperationId === operation.id &&
          (material?.quantityIssued ?? 0) < (material?.quantity ?? 0)
      )
    );
  }, [materials, parentIsSerial, operation.id]);

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
          action={actionMap[type]}
          method="post"
          validator={validatorMap[type]}
          defaultValues={{
            // @ts-ignore
            trackedEntityId:
              parentIsSerial || parentIsBatch ? trackedEntityId : undefined,
            jobOperationId: operation.id,
            // @ts-ignore
            quantity: type === "finish" ? undefined : 1,
            setupProductionEventId: setupProductionEvent?.id,
            laborProductionEventId: laborProductionEvent?.id,
            machineProductionEventId: machineProductionEvent?.id,
          }}
          fetcher={fetcher}
          onSubmit={() => {
            onClose();
          }}
        >
          <ModalHeader>
            <ModalTitle>{titleMap[type]}</ModalTitle>
            <ModalDescription>{descriptionMap[type]}</ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Hidden name="trackedEntityId" />
            <Hidden
              name="trackingType"
              value={
                parentIsSerial ? "Serial" : parentIsBatch ? "Batch" : undefined
              }
            />
            <Hidden name="jobOperationId" />
            <Hidden name="setupProductionEventId" />
            <Hidden name="laborProductionEventId" />
            <Hidden name="machineProductionEventId" />
            <VStack spacing={2}>
              {hasUnissuedMaterials && (
                <Alert variant="destructive">
                  <LuTriangleAlert className="h-4 w-4" />
                  <AlertTitle>Unissued materials</AlertTitle>
                  <AlertDescription>
                    Please issue all materials for this operation before
                    closing.
                  </AlertDescription>
                </Alert>
              )}

              {type === "finish" && !isOperationComplete && (
                <Alert variant="destructive">
                  <LuTriangleAlert className="h-4 w-4" />
                  <AlertTitle>Insufficient quantity</AlertTitle>
                  <AlertDescription>
                    The completed quantity for this operation is less than the
                    required quantity of {operation.operationQuantity}.
                  </AlertDescription>
                </Alert>
              )}
              {type === "finish" && !allAttributesRecorded && (
                <Alert variant="destructive">
                  <LuTriangleAlert className="h-4 w-4" />
                  <AlertTitle>Steps are missing</AlertTitle>
                  <AlertDescription>
                    Please record all steps for this operation before closing.
                  </AlertDescription>
                </Alert>
              )}
              {type !== "finish" && (
                <>
                  <NumberControlled
                    name="quantity"
                    label="Quantity"
                    value={quantity}
                    onChange={setQuantity}
                    isReadOnly={parentIsSerial}
                    minValue={1}
                  />
                </>
              )}
              {type === "scrap" ? (
                <>
                  <ScrapReason name="scrapReasonId" label="Scrap Reason" />
                  <TextArea label="Notes" name="notes" />
                </>
              ) : (
                <>
                  <NumberControlled
                    name="totalQuantity"
                    label="Total Quantity"
                    value={
                      quantity +
                      (type === "rework"
                        ? operation.quantityReworked
                        : operation.quantityComplete)
                    }
                    isReadOnly
                  />
                </>
              )}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>

            <Button
              variant={
                type === "scrap" || (!isOperationComplete && type === "finish")
                  ? "destructive"
                  : "primary"
              }
              type="submit"
            >
              {actionButtonMap[type]}
            </Button>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}

function SerialSelectorModal({
  availableEntities,
  onCancel,
  onClose,
  onSelect,
}: {
  availableEntities: TrackedEntity[];
  onCancel: () => void;
  onClose: () => void;
  onSelect: (entity: TrackedEntity) => void;
}) {
  const [serial, setSerial] = useState("");

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
        <ModalHeader>
          <ModalTitle>Select Serial Number</ModalTitle>
          <ModalDescription>
            Select a serial number to continue with this operation
          </ModalDescription>
        </ModalHeader>
        <ModalBody>
          <Tabs defaultValue="scan">
            <TabsList className="grid w-full grid-cols-2 mb-4">
              <TabsTrigger value="scan">
                <LuQrCode className="mr-2" />
                Scan
              </TabsTrigger>
              <TabsTrigger value="select">
                <LuList className="mr-2" />
                Select
              </TabsTrigger>
            </TabsList>
            <TabsContent value="select" className="mt-4">
              <ScrollArea className="max-h-[40dvh]">
                <VStack spacing={2}>
                  {availableEntities.length === 0 ? (
                    <p className="text-center text-muted-foreground">
                      No available serial numbers found
                    </p>
                  ) : (
                    availableEntities.map((entity) => {
                      return (
                        <HStack
                          key={entity.id}
                          className="w-full justify-between p-4 border rounded-md"
                        >
                          <VStack spacing={1} className="w-full items-start">
                            <p className="text-sm">{entity.id}</p>
                          </VStack>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => onSelect(entity)}
                          >
                            Select
                          </Button>
                        </HStack>
                      );
                    })
                  )}
                </VStack>
              </ScrollArea>
            </TabsContent>
            <TabsContent value="scan" className="mt-4">
              <VStack spacing={4}>
                <InputGroup>
                  <Input
                    autoFocus
                    placeholder="Scan or enter serial number"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const entity = availableEntities.find(
                          (entity) => entity.id === e.currentTarget.value
                        );
                        if (entity) {
                          onSelect(entity);
                        }
                      }
                    }}
                    value={serial}
                    onChange={(e) => setSerial(e.target.value)}
                  />
                  <InputRightElement>
                    {serial &&
                      (availableEntities.some(
                        (entity) => entity.id === serial
                      ) ? (
                        <LuCheck className="text-green-500" />
                      ) : (
                        <LuX className="text-red-500" />
                      ))}
                  </InputRightElement>
                </InputGroup>
              </VStack>
            </TabsContent>
          </Tabs>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function SerialIssueModal({
  operationId,
  material,
  parentId,
  parentIdIsSerialized,
  trackedInputs,
  onClose,
}: {
  parentId: string;
  parentIdIsSerialized: boolean;
  operationId: string;
  material?: JobMaterial;
  trackedInputs: TrackedInput[];
  onClose: () => void;
}) {
  const fetcher = useFetcher<{ success: boolean; message: string }>();
  const unconsumeFetcher = useFetcher<{ success: boolean; message: string }>();
  const { data: serialNumbers } = useSerialNumbers(material?.itemId ?? "");

  const [errors, setErrors] = useState<Record<number, string>>({});

  const options = useMemo(() => {
    return (
      serialNumbers?.data
        ?.filter((serialNumber) => serialNumber.status === "Available")
        .map((serialNumber) => {
          const attributes = serialNumber.attributes as TrackedEntityAttributes;
          return {
            label: serialNumber.id ?? "",
            value: serialNumber.id,
            helper: attributes["Serial Number"]
              ? `Serial ${attributes["Serial Number"]}`
              : attributes["Batch Number"]
              ? `Batch ${attributes["Batch Number"]}`
              : undefined,
          };
        }) ?? []
    );
  }, [serialNumbers]);

  const initialQuantity = parentIdIsSerialized
    ? material?.quantity ?? 1
    : material?.estimatedQuantity ?? 1;

  const [selectedSerialNumbers, setSelectedSerialNumbers] = useState<
    Array<{
      index: number;
      id: string;
    }>
  >(
    Array(initialQuantity)
      .fill("")
      .map((_, index) => ({ index, id: "" }))
  );

  const [selectedTrackedInputs, setSelectedTrackedInputs] = useState<string[]>(
    []
  );

  const validateSerialNumber = useCallback(
    (value: string, index: number) => {
      if (!value) return "Serial number is required";

      // Check for duplicates
      const isDuplicate = selectedSerialNumbers.some(
        (sn, i) => sn.id === value && i !== index
      );
      if (isDuplicate) return "Duplicate serial number";

      // Check if serial number exists in options
      const isValid = options.some((option) => option.value === value);
      if (!isValid) {
        const serialNumber = serialNumbers?.data?.find((sn) => sn.id === value);
        if (serialNumber) return `Serial number is ${serialNumber.status}`;
        return "Serial number is not available";
      }

      return null;
    },
    [selectedSerialNumbers, options, serialNumbers?.data]
  );

  const updateSerialNumber = useCallback(
    (serialNumber: { index: number; id: string }) => {
      setSelectedSerialNumbers((prev) => {
        const newSerialNumbers = [...prev];
        newSerialNumbers[serialNumber.index] = serialNumber;
        return newSerialNumbers;
      });
    },
    []
  );

  const addSerialNumber = useCallback(() => {
    setSelectedSerialNumbers((prev) => {
      const newIndex = prev.length;
      return [...prev, { index: newIndex, id: "" }];
    });
  }, []);

  const removeSerialNumber = useCallback((indexToRemove: number) => {
    setSelectedSerialNumbers((prev) => {
      // Remove the item at the specified index
      const filtered = prev.filter((_, i) => i !== indexToRemove);

      // Reindex the remaining items
      return filtered.map((item, i) => ({ ...item, index: i }));
    });

    // Clean up any errors for the removed index
    setErrors((prev) => {
      const newErrors = { ...prev };
      delete newErrors[indexToRemove];

      // Reindex the errors for indices greater than the removed one
      const reindexedErrors: Record<number, string> = {};
      Object.entries(newErrors).forEach(([key, value]) => {
        const keyNum = parseInt(key);
        if (keyNum > indexToRemove) {
          reindexedErrors[keyNum - 1] = value;
        } else {
          reindexedErrors[keyNum] = value;
        }
      });

      return reindexedErrors;
    });
  }, []);

  const handleSubmit = useCallback(() => {
    // Validate all serial numbers
    let hasErrors = false;
    const newErrors: Record<number, string> = {};

    selectedSerialNumbers.forEach((sn) => {
      const error = validateSerialNumber(sn.id, sn.index);
      if (error) {
        newErrors[sn.index] = error;
        hasErrors = true;
      }
    });

    setErrors(newErrors);

    if (!hasErrors) {
      // Submit to the API
      const payload = {
        materialId: material?.id!,
        parentTrackedEntityId: parentId,
        children: selectedSerialNumbers.map((sn) => ({
          trackedEntityId: sn.id,
          quantity: 1,
        })),
      };

      fetcher.submit(JSON.stringify(payload), {
        method: "post",
        action: path.to.issueTrackedEntity,
        encType: "application/json",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedSerialNumbers,
    validateSerialNumber,
    operationId,
    parentId,
    onClose,
    material?.id,
  ]);

  const handleUnconsume = useCallback(() => {
    if (selectedTrackedInputs.length === 0) {
      toast.error("Please select at least one item to unconsume");
      return;
    }

    const payload = {
      materialId: material?.id!,
      parentTrackedEntityId: parentId,
      children: selectedTrackedInputs.map((id) => ({
        trackedEntityId: id,
        quantity: 1,
      })),
    };

    unconsumeFetcher.submit(JSON.stringify(payload), {
      method: "post",
      action: path.to.unconsume,
      encType: "application/json",
    });
  }, [selectedTrackedInputs, material?.id, parentId, unconsumeFetcher]);

  useEffect(() => {
    if (fetcher.data?.success) {
      onClose();
      if (fetcher.data.message) {
        toast.success(fetcher.data.message);
      }
    } else if (fetcher.data?.message) {
      toast.error(fetcher.data.message);
    }
  }, [fetcher.data, onClose]);

  useEffect(() => {
    if (unconsumeFetcher.data?.success) {
      onClose();
      if (unconsumeFetcher.data.message) {
        toast.success(unconsumeFetcher.data.message);
      }
    } else if (unconsumeFetcher.data?.message) {
      toast.error(unconsumeFetcher.data.message);
    }
  }, [unconsumeFetcher.data, onClose]);

  const [activeTab, setActiveTab] = useState("scan");

  const toggleTrackedInput = useCallback((id: string) => {
    setSelectedTrackedInputs((prev) => {
      if (prev.includes(id)) {
        return prev.filter((item) => item !== id);
      } else {
        return [...prev, id];
      }
    });
  }, []);

  const [items] = useItems();

  return (
    <Modal open onOpenChange={onClose}>
      <ModalContent>
        <ModalTitle>
          {getItemReadableId(items, material?.itemId) ?? "Material"}
        </ModalTitle>
        <ModalDescription>{material?.description}</ModalDescription>
        <ModalBody>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList
              className={cn(
                "grid w-full grid-cols-2 mb-4",
                trackedInputs.length > 0 && "grid-cols-3"
              )}
            >
              <TabsTrigger value="scan">
                <LuQrCode className="mr-2" />
                Scan
              </TabsTrigger>
              <TabsTrigger value="select">
                <LuList className="mr-2" />
                Select
              </TabsTrigger>
              {trackedInputs.length > 0 && (
                <TabsTrigger value="unconsume">
                  <LuUndo2 className="mr-2" />
                  Unconsume
                </TabsTrigger>
              )}
            </TabsList>
            <TabsContent value="scan">
              <div className="flex flex-col gap-4">
                {selectedSerialNumbers.map((serialNumber, index) => (
                  <div
                    key={`${index}-serial-scan`}
                    className="flex flex-col gap-1"
                  >
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <InputGroup>
                          <Input
                            placeholder={`Serial Number ${index + 1}`}
                            value={serialNumber.id}
                            onChange={(e) => {
                              const newValue = e.target.value;
                              const newSerialNumbers = [
                                ...selectedSerialNumbers,
                              ];
                              newSerialNumbers[index] = {
                                index,
                                id: newValue,
                              };
                              setSelectedSerialNumbers(newSerialNumbers);
                            }}
                            onBlur={(e) => {
                              const newValue = e.target.value;
                              const error = validateSerialNumber(
                                newValue,
                                index
                              );

                              setErrors((prev) => {
                                const newErrors = { ...prev };
                                if (error) {
                                  newErrors[index] = error;
                                } else {
                                  delete newErrors[index];
                                }
                                return newErrors;
                              });

                              if (!error) {
                                updateSerialNumber({
                                  index,
                                  id: newValue,
                                });
                              } else {
                                // Clear the input value but keep the error message
                                const newSerialNumbers = [
                                  ...selectedSerialNumbers,
                                ];
                                newSerialNumbers[index] = {
                                  index,
                                  id: "",
                                };
                                setSelectedSerialNumbers(newSerialNumbers);
                              }
                            }}
                            className={cn(
                              errors[index] && "border-destructive"
                            )}
                          />
                          <InputRightElement className="pl-2">
                            {!errors[index] && serialNumber.id ? (
                              <LuCheck className="text-emerald-500" />
                            ) : (
                              <LuQrCode />
                            )}
                          </InputRightElement>
                        </InputGroup>
                      </div>
                      {index > 0 && (
                        <IconButton
                          aria-label="Remove Serial Number"
                          icon={<LuX />}
                          variant="ghost"
                          onClick={() => removeSerialNumber(index)}
                          className="flex-shrink-0"
                        />
                      )}
                    </div>
                    {errors[index] && (
                      <span className="text-xs text-destructive">
                        {errors[index]}
                      </span>
                    )}
                  </div>
                ))}
                <div>
                  <Button
                    type="button"
                    variant="secondary"
                    leftIcon={<LuCirclePlus />}
                    onClick={addSerialNumber}
                  >
                    Add
                  </Button>
                </div>
              </div>
            </TabsContent>
            <TabsContent value="select">
              <div className="flex flex-col gap-4">
                {selectedSerialNumbers.map((serialNumber, index) => (
                  <div
                    key={`${index}-serial-select`}
                    className="flex flex-col gap-1"
                  >
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <ComboboxBase
                          placeholder={`Select Serial Number ${index + 1}`}
                          value={serialNumber.id}
                          onChange={(value) => {
                            const newSerialNumbers = [...selectedSerialNumbers];
                            newSerialNumbers[index] = {
                              index,
                              id: value,
                            };
                            setSelectedSerialNumbers(newSerialNumbers);

                            // Validate on change for select
                            const error = validateSerialNumber(value, index);
                            setErrors((prev) => {
                              const newErrors = { ...prev };
                              if (error) {
                                newErrors[index] = error;
                              } else {
                                delete newErrors[index];
                              }
                              return newErrors;
                            });
                          }}
                          options={options}
                        />
                      </div>
                      {index > 0 && (
                        <IconButton
                          aria-label="Remove Serial Number"
                          icon={<LuX />}
                          variant="ghost"
                          onClick={() => removeSerialNumber(index)}
                          className="flex-shrink-0"
                        />
                      )}
                    </div>
                    {errors[index] && (
                      <span className="text-xs text-destructive">
                        {errors[index]}
                      </span>
                    )}
                  </div>
                ))}
                <div>
                  <Button
                    type="button"
                    variant="secondary"
                    leftIcon={<LuCirclePlus />}
                    onClick={addSerialNumber}
                  >
                    Add
                  </Button>
                </div>
              </div>
            </TabsContent>
            {trackedInputs.length > 0 && (
              <TabsContent value="unconsume">
                <div className="flex flex-col gap-4">
                  {trackedInputs.map((input) => {
                    const attributes =
                      input.attributes as TrackedEntityAttributes;
                    const serialNumber = attributes["Serial Number"];

                    return (
                      <div
                        key={input.id}
                        className="flex items-center gap-3 p-2 border rounded-md"
                      >
                        <Checkbox
                          id={`unconsume-${input.id}`}
                          checked={selectedTrackedInputs.includes(input.id)}
                          onCheckedChange={() => toggleTrackedInput(input.id)}
                        />
                        <label
                          htmlFor={`unconsume-${input.id}`}
                          className="flex-1 cursor-pointer"
                        >
                          <div className="font-medium text-sm">{input.id}</div>
                          {serialNumber && (
                            <div className="text-xs text-muted-foreground">
                              Serial: {serialNumber}
                            </div>
                          )}
                        </label>
                      </div>
                    );
                  })}

                  {trackedInputs.length === 0 && (
                    <Alert variant="warning">
                      <AlertTitle>No consumed materials</AlertTitle>
                      <AlertDescription>
                        There are no consumed materials to unconsume.
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              </TabsContent>
            )}
          </Tabs>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {activeTab === "unconsume" ? (
            <Button
              variant="destructive"
              onClick={handleUnconsume}
              isLoading={unconsumeFetcher.state !== "idle"}
              isDisabled={
                unconsumeFetcher.state !== "idle" ||
                selectedTrackedInputs.length === 0
              }
            >
              Unconsume
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={handleSubmit}
              isLoading={fetcher.state !== "idle"}
              isDisabled={fetcher.state !== "idle"}
            >
              Issue
            </Button>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function useSerialNumbers(itemId?: string) {
  const serialNumbersFetcher =
    useFetcher<Awaited<ReturnType<typeof getSerialNumbersForItem>>>();

  useEffect(() => {
    if (itemId) {
      serialNumbersFetcher.load(path.to.api.serialNumbers(itemId));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  return { data: serialNumbersFetcher.data };
}

function BatchIssueModal({
  parentId,
  parentIdIsSerialized,
  operationId,
  material,
  trackedInputs,
  onClose,
}: {
  parentId: string;
  parentIdIsSerialized: boolean;
  operationId: string;
  material?: JobMaterial;
  trackedInputs: TrackedInput[];
  onClose: () => void;
}) {
  const { data: batchNumbers } = useBatchNumbers(material?.itemId ?? "");

  const [errors, setErrors] = useState<Record<number, string>>({});

  const options = useMemo(() => {
    return (
      batchNumbers?.data
        ?.filter((batchNumber) => batchNumber.status === "Available")
        .map((batchNumber) => {
          const attributes = batchNumber.attributes as TrackedEntityAttributes;
          return {
            label: batchNumber.id ?? "",
            value: batchNumber.id,
            helper: attributes["Batch Number"]
              ? `${batchNumber.quantity} Available ${
                  attributes["Batch Number"]
                    ? `of Batch ${attributes["Batch Number"]}`
                    : ""
                }`
              : undefined,
            availableQuantity: batchNumber.quantity,
          };
        }) ?? []
    );
  }, [batchNumbers]);

  const unconsumeOptions = useMemo(() => {
    return trackedInputs.map((input) => ({
      label: input.id,
      value: input.id,
      helper: `${input.quantity} ${
        (input.attributes as TrackedEntityAttributes)?.["Batch Number"]
          ? `of Batch ${
              (input.attributes as TrackedEntityAttributes)?.["Batch Number"]
            }`
          : ""
      }`,
    }));
  }, [trackedInputs]);

  const initialQuantity = parentIdIsSerialized
    ? material?.quantity ?? 1
    : material?.estimatedQuantity ?? 1;

  const [selectedBatchNumbers, setSelectedBatchNumbers] = useState<
    Array<{
      index: number;
      id: string;
      quantity: number;
    }>
  >(
    Array(1)
      .fill("")
      .map((_, index) => ({ index, id: "", quantity: initialQuantity }))
  );

  const validateBatchNumber = useCallback(
    (value: string, quantity: number, index: number) => {
      if (!value) return "Batch number is required";

      // Check for duplicates
      const isDuplicate = selectedBatchNumbers.some(
        (bn, i) => bn.id === value && i !== index
      );
      if (isDuplicate) return "Duplicate batch number";

      // Check if batch number exists in options
      const batchOption = options.find((option) => option.value === value);
      if (!batchOption) {
        const batchNumber = batchNumbers?.data?.find((bn) => bn.id === value);
        if (batchNumber) return `Batch number is ${batchNumber.status}`;
        return "Batch number is not available";
      }

      // Check if quantity is valid
      if (quantity <= 0) return "Quantity must be greater than 0";
      if (quantity > batchOption.availableQuantity)
        return `Quantity cannot exceed available quantity (${batchOption.availableQuantity})`;

      return null;
    },
    [selectedBatchNumbers, options, batchNumbers?.data]
  );

  const updateBatchNumber = useCallback(
    (batchNumber: { index: number; id: string; quantity: number }) => {
      setSelectedBatchNumbers((prev) => {
        const newBatchNumbers = [...prev];
        newBatchNumbers[batchNumber.index] = batchNumber;
        return newBatchNumbers;
      });
    },
    []
  );

  const addBatchNumber = useCallback(() => {
    setSelectedBatchNumbers((prev) => {
      const newIndex = prev.length;
      return [...prev, { index: newIndex, id: "", quantity: 1 }];
    });
  }, []);

  const removeBatchNumber = useCallback((indexToRemove: number) => {
    setSelectedBatchNumbers((prev) => {
      // Remove the item at the specified index
      const filtered = prev.filter((_, i) => i !== indexToRemove);

      // Reindex the remaining items
      return filtered.map((item, i) => ({ ...item, index: i }));
    });

    // Clean up any errors for the removed index
    setErrors((prev) => {
      const newErrors = { ...prev };
      delete newErrors[indexToRemove];

      // Reindex the errors for indices greater than the removed one
      const reindexedErrors: Record<number, string> = {};
      Object.entries(newErrors).forEach(([key, value]) => {
        const keyNum = parseInt(key);
        if (keyNum > indexToRemove) {
          reindexedErrors[keyNum - 1] = value;
        } else {
          reindexedErrors[keyNum] = value;
        }
      });

      return reindexedErrors;
    });
  }, []);

  const fetcher = useFetcher<{ success: boolean; message: string }>();

  const handleSubmit = useCallback(() => {
    // Validate all batch numbers
    let hasErrors = false;
    const newErrors: Record<number, string> = {};

    selectedBatchNumbers.forEach((bn) => {
      const error = validateBatchNumber(bn.id, bn.quantity, bn.index);
      if (error) {
        newErrors[bn.index] = error;
        hasErrors = true;
      }
    });

    setErrors(newErrors);

    if (!hasErrors) {
      // Submit to the API
      const payload = {
        materialId: material?.id!,
        parentTrackedEntityId: parentId,
        children: selectedBatchNumbers.map((bn) => ({
          trackedEntityId: bn.id,
          quantity: bn.quantity,
        })),
      };

      fetcher.submit(JSON.stringify(payload), {
        method: "post",
        action: path.to.issueTrackedEntity,
        encType: "application/json",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedBatchNumbers,
    validateBatchNumber,
    operationId,
    parentId,
    onClose,
    material?.id,
  ]);

  useEffect(() => {
    if (fetcher.data?.success) {
      onClose();
      if (fetcher.data.message) {
        toast.success(fetcher.data.message);
      }
    } else if (fetcher.data?.message) {
      toast.error(fetcher.data.message);
    }
  }, [fetcher.data, onClose]);

  const validateBatchInput = useCallback(
    (value: string, index: number) => {
      if (!value) {
        setErrors((prev) => ({ ...prev, [index]: "Batch number is required" }));
        return false;
      }

      // Check for duplicates by comparing with all other batch numbers
      // This ensures we catch duplicates even after adding new batch numbers
      const duplicateIndices = selectedBatchNumbers
        .map((bn, i) => (bn.id === value && i !== index ? i : -1))
        .filter((i) => i !== -1);

      if (duplicateIndices.length > 0) {
        setErrors((prev) => ({ ...prev, [index]: "Duplicate batch number" }));
        return false;
      }

      // Check if batch number exists in options
      const batchOption = options.find((option) => option.value === value);
      if (!batchOption) {
        setErrors((prev) => ({
          ...prev,
          [index]: "Batch number is not available",
        }));
        return false;
      }

      // Check if the requested quantity exceeds available quantity
      const currentBatchNumber = selectedBatchNumbers[index];
      if (currentBatchNumber.quantity > batchOption.availableQuantity) {
        // If we need more than available, create a new batch row with remaining quantity
        const remainingQuantity =
          currentBatchNumber.quantity - batchOption.availableQuantity;

        // Update current row to use maximum available quantity
        updateBatchNumber({
          ...currentBatchNumber,
          id: value,
          quantity: batchOption.availableQuantity,
        });

        // Add a new row for the remaining quantity
        setSelectedBatchNumbers((prev) => {
          const newIndex = prev.length;
          return [
            ...prev,
            { index: newIndex, id: "", quantity: remainingQuantity },
          ];
        });
      }

      // Clear errors if valid
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[index];
        return newErrors;
      });
      return true;
    },
    [selectedBatchNumbers, options, updateBatchNumber]
  );

  const [activeTab, setActiveTab] = useState("scan");

  const [unconsumedBatch, setUnconsumedBatch] = useState("");
  const handleUnconsume = useCallback(() => {
    const payload = {
      materialId: material?.id!,
      parentTrackedEntityId: parentId,
      children: [
        {
          trackedEntityId: unconsumedBatch,
          quantity:
            trackedInputs.find((input) => input.id === unconsumedBatch)
              ?.quantity ?? 0,
        },
      ],
    };

    fetcher.submit(JSON.stringify(payload), {
      method: "post",
      action: path.to.unconsume,
      encType: "application/json",
    });
    // fetcher is not needed to be in the dependency array
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unconsumedBatch, material?.id, parentId, trackedInputs]);

  const [items] = useItems();

  return (
    <Modal open onOpenChange={onClose}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            {getItemReadableId(items, material?.itemId) ?? "Material"}
          </ModalTitle>
          <ModalDescription>{material?.description}</ModalDescription>
        </ModalHeader>
        <ModalBody>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList
              className={cn(
                "grid w-full grid-cols-2 mb-4",
                trackedInputs.length > 0 && "grid-cols-3"
              )}
            >
              <TabsTrigger value="scan">
                <LuQrCode className="mr-2" />
                Scan
              </TabsTrigger>
              <TabsTrigger value="select">
                <LuList className="mr-2" />
                Select
              </TabsTrigger>
              {trackedInputs.length > 0 && (
                <TabsTrigger value="unconsume">
                  <LuUndo2 className="mr-2" />
                  Unconsume
                </TabsTrigger>
              )}
            </TabsList>
            <TabsContent value="scan">
              <div className="flex flex-col gap-4">
                {selectedBatchNumbers.map((batchNumber, index) => (
                  <div key={index} className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <InputGroup>
                          <Input
                            value={batchNumber.id}
                            onChange={(e) => {
                              const newValue = e.target.value;
                              updateBatchNumber({
                                ...batchNumber,
                                id: newValue,
                              });
                            }}
                            onBlur={(e) => {
                              validateBatchInput(e.target.value, index);
                            }}
                            placeholder="Scan batch number"
                          />
                          <InputRightElement className="pl-2">
                            {!errors[index] && batchNumber.id ? (
                              <LuCheck className="text-emerald-500" />
                            ) : (
                              <LuQrCode />
                            )}
                          </InputRightElement>
                        </InputGroup>
                      </div>
                      <div className="w-24">
                        <NumberField
                          id={`quantity-${index}`}
                          value={batchNumber.quantity}
                          onChange={(value) =>
                            updateBatchNumber({
                              ...batchNumber,
                              quantity: value,
                            })
                          }
                          minValue={0.01}
                          maxValue={
                            options.find((o) => o.value === batchNumber.id)
                              ?.availableQuantity ?? 999999
                          }
                        >
                          <NumberInputGroup className="relative">
                            <NumberInput />
                            <NumberInputStepper>
                              <NumberIncrementStepper>
                                <LuChevronUp size="1em" strokeWidth="3" />
                              </NumberIncrementStepper>
                              <NumberDecrementStepper>
                                <LuChevronDown size="1em" strokeWidth="3" />
                              </NumberDecrementStepper>
                            </NumberInputStepper>
                          </NumberInputGroup>
                        </NumberField>
                      </div>
                      {index > 0 && (
                        <IconButton
                          aria-label="Remove Batch Number"
                          icon={<LuX />}
                          variant="ghost"
                          onClick={() => removeBatchNumber(index)}
                        />
                      )}
                    </div>
                    {errors[index] && (
                      <span className="text-xs text-destructive">
                        {errors[index]}
                      </span>
                    )}
                  </div>
                ))}
                <div>
                  <Button
                    type="button"
                    variant="secondary"
                    leftIcon={<LuCirclePlus />}
                    onClick={addBatchNumber}
                  >
                    Add
                  </Button>
                </div>
              </div>
            </TabsContent>
            <TabsContent value="select">
              <div className="flex flex-col gap-4">
                {selectedBatchNumbers.map((batchNumber, index) => (
                  <div key={index} className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <ComboboxBase
                          value={batchNumber.id}
                          onChange={(value) => {
                            updateBatchNumber({
                              ...batchNumber,
                              id: value,
                            });
                            validateBatchInput(value, index);
                          }}
                          options={options}
                          placeholder="Select batch number"
                        />
                      </div>
                      <div className="w-24">
                        <NumberField
                          value={batchNumber.quantity}
                          onChange={(value) =>
                            updateBatchNumber({
                              ...batchNumber,
                              quantity: value,
                            })
                          }
                          minValue={0.01}
                          maxValue={
                            options.find((o) => o.value === batchNumber.id)
                              ?.availableQuantity ?? 999999
                          }
                        >
                          <NumberInputGroup className="relative">
                            <NumberInput />
                            <NumberInputStepper>
                              <NumberIncrementStepper>
                                <LuChevronUp size="1em" strokeWidth="3" />
                              </NumberIncrementStepper>
                              <NumberDecrementStepper>
                                <LuChevronDown size="1em" strokeWidth="3" />
                              </NumberDecrementStepper>
                            </NumberInputStepper>
                          </NumberInputGroup>
                        </NumberField>
                      </div>
                      {index > 0 && (
                        <IconButton
                          aria-label="Remove Batch Number"
                          icon={<LuX />}
                          variant="ghost"
                          onClick={() => removeBatchNumber(index)}
                        />
                      )}
                    </div>
                    {errors[index] && (
                      <span className="text-xs text-destructive">
                        {errors[index]}
                      </span>
                    )}
                  </div>
                ))}
                <div>
                  <Button
                    type="button"
                    variant="secondary"
                    leftIcon={<LuCirclePlus />}
                    onClick={addBatchNumber}
                  >
                    Add Batch
                  </Button>
                </div>
              </div>
            </TabsContent>
            {trackedInputs.length > 0 && (
              <TabsContent value="unconsume">
                <div className="flex flex-col gap-4">
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <ComboboxBase
                        value={unconsumedBatch}
                        onChange={(value) => {
                          setUnconsumedBatch(value);
                        }}
                        options={unconsumeOptions}
                        placeholder="Select batch to unconsume"
                      />
                    </div>
                    {unconsumedBatch && (
                      <div className="w-24">
                        <Input
                          isReadOnly
                          value={
                            trackedInputs
                              .find((input) => input.id === unconsumedBatch)
                              ?.quantity.toString() ?? "0"
                          }
                        />
                      </div>
                    )}
                  </div>

                  <div className="h-8" />
                </div>
              </TabsContent>
            )}
          </Tabs>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {activeTab === "unconsume" ? (
            <Button
              variant="destructive"
              onClick={handleUnconsume}
              isLoading={fetcher.state !== "idle"}
              isDisabled={fetcher.state !== "idle" || !unconsumedBatch}
            >
              Unconsume
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={handleSubmit}
              isLoading={fetcher.state !== "idle"}
              isDisabled={fetcher.state !== "idle"}
            >
              Issue
            </Button>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function useBatchNumbers(itemId?: string) {
  const batchNumbersFetcher =
    useFetcher<Awaited<ReturnType<typeof getBatchNumbersForItem>>>();

  useEffect(() => {
    if (itemId) {
      batchNumbersFetcher.load(path.to.api.batchNumbers(itemId));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  return { data: batchNumbersFetcher.data };
}

function IssueModal({
  operationId,
  material,
  onClose,
}: {
  operationId: string;
  material?: JobMaterial;
  onClose: () => void;
}) {
  const [items] = useItems();
  const itemOptions = useMemo(() => {
    return items
      .filter((i) => !["Batch", "Serial"].includes(i.itemTrackingType))
      .map((item) => ({
        label: item.readableIdWithRevision,
        helper: item.name,
        value: item.id,
      }));
  }, [items]);

  return (
    <Modal open onOpenChange={onClose}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Issue Material</ModalTitle>
          <ModalDescription>
            Manually add or subtract material from the required quantities.
          </ModalDescription>
        </ModalHeader>

        <ValidatedForm
          method="post"
          action={path.to.issue}
          onSubmit={onClose}
          validator={issueValidator}
          defaultValues={{
            materialId: material?.id ?? "",
            jobOperationId: operationId,
            itemId: material?.itemId ?? "",
            quantity:
              (material?.estimatedQuantity ?? 0) -
              (material?.quantityIssued ?? 0),
            adjustmentType: "Negative Adjmt.",
          }}
        >
          <ModalBody>
            <Hidden name="jobOperationId" />
            <Hidden name="materialId" />
            {material?.id && (
              <Hidden name="adjustmentType" value="Negative Adjmt." />
            )}
            <VStack spacing={4}>
              <Combobox name="itemId" label="Item" options={itemOptions} />
              {!material?.id && (
                <Select
                  name="adjustmentType"
                  label="Adjustment Type"
                  options={[
                    {
                      label: "Add to Inventory",
                      value: "Positive Adjmt.",
                    },
                    {
                      label: "Pull from Inventory",
                      value: "Negative Adjmt.",
                    },
                  ]}
                />
              )}
              <Number name="quantity" label="Quantity" />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Issue
            </Button>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
function AttributesListItem({
  activeStep,
  attribute,
  compact = false,
  operationId,
  className,
  onRecord,
  onDelete,
}: {
  activeStep: number;
  attribute: JobOperationAttribute;
  compact?: boolean;
  operationId?: string;
  className: string;
  onRecord: (attribute: JobOperationAttribute) => void;
  onDelete: (attribute: JobOperationAttribute) => void;
}) {
  const disclosure = useDisclosure();
  const fetcher = useFetcher<{ success: boolean }>();
  const user = useUser();
  const { name, description, type, unitOfMeasureCode, minValue, maxValue } =
    attribute;

  const hasDescription = description && Object.keys(description).length > 0;

  if (!operationId) return null;
  const record = attribute.jobOperationStepRecord.find(
    (r) => r.index === activeStep
  );

  return (
    <div className={cn("border-b hover:bg-muted/30 p-6", className)}>
      <div className="flex flex-1 justify-between items-center w-full gap-2">
        <HStack spacing={4} className="w-2/3">
          <HStack spacing={4} className="flex-1">
            <div className="bg-muted border rounded-full flex items-center justify-center p-2">
              <ProcedureStepTypeIcon type={type} />
            </div>
            <VStack spacing={0}>
              <HStack>
                <span className="text-foreground text-sm font-medium">
                  {name}
                </span>
              </HStack>
              {type === "Measurement" && (
                <span className="text-xs text-muted-foreground">
                  {minValue !== null && maxValue !== null
                    ? `Must be between ${minValue} and ${maxValue} ${unitOfMeasureCode}`
                    : minValue !== null
                    ? `Must be > ${minValue} ${unitOfMeasureCode}`
                    : maxValue !== null
                    ? `Must be < ${maxValue} ${unitOfMeasureCode}`
                    : null}
                </span>
              )}
            </VStack>
            {!compact && (
              <PreviewAttributeRecord
                attribute={attribute}
                activeStep={activeStep}
              />
            )}
          </HStack>
        </HStack>
        <div className="flex items-center justify-end gap-2">
          {record ? (
            <div className="flex items-center gap-2">
              {type !== "Task" &&
                (compact ? (
                  <IconButton
                    aria-label="Update attribute"
                    variant="secondary"
                    icon={<LuCircleCheck />}
                    isDisabled={record?.createdBy !== user?.id}
                    onClick={() => onRecord(attribute)}
                    className={cn(
                      "text-emerald-500",
                      attribute.minValue !== null &&
                        record?.numericValue != null &&
                        record?.numericValue < attribute.minValue &&
                        "text-red-500",
                      attribute.maxValue !== null &&
                        record?.numericValue != null &&
                        record?.numericValue > attribute.maxValue &&
                        "text-red-500"
                    )}
                  />
                ) : (
                  <Button
                    variant="secondary"
                    rightIcon={<LuCircleCheck />}
                    onClick={() => onRecord(attribute)}
                  >
                    Update
                  </Button>
                ))}
              <IconButton
                aria-label="Delete attribute"
                variant="secondary"
                icon={<LuTrash />}
                isDisabled={record?.createdBy !== user?.id}
                onClick={() => onDelete(attribute)}
              />
            </div>
          ) : type === "Task" ? (
            <fetcher.Form method="post" action={path.to.record}>
              <input type="hidden" name="index" value={activeStep} />
              <input
                type="hidden"
                name="jobOperationStepId"
                value={attribute.id}
              />

              <input type="hidden" name="booleanValue" value="true" />
              {compact ? (
                <IconButton
                  aria-label="Record attribute"
                  variant="secondary"
                  icon={<LuCircleCheck />}
                  type="submit"
                  isLoading={fetcher.state !== "idle"}
                  isDisabled={fetcher.state !== "idle"}
                />
              ) : (
                <Button
                  type="submit"
                  variant="secondary"
                  rightIcon={<LuCircleCheck />}
                  isLoading={fetcher.state !== "idle"}
                  isDisabled={fetcher.state !== "idle"}
                >
                  Complete
                </Button>
              )}
            </fetcher.Form>
          ) : compact ? (
            <IconButton
              aria-label="Record attribute"
              variant="secondary"
              icon={<LuCircleCheck />}
              onClick={() => onRecord(attribute)}
            />
          ) : (
            <Button
              variant="secondary"
              rightIcon={<LuCircleCheck />}
              onClick={() => onRecord(attribute)}
            >
              Record
            </Button>
          )}
          {hasDescription && (
            <IconButton
              aria-label={
                disclosure.isOpen ? "Hide description" : "Show description"
              }
              variant="ghost"
              icon={disclosure.isOpen ? <LuChevronDown /> : <LuChevronRight />}
              onClick={disclosure.onToggle}
            />
          )}
        </div>
      </div>
      {disclosure.isOpen && hasDescription && (
        <div
          className="mt-4 text-sm prose prose-sm dark:prose-invert"
          dangerouslySetInnerHTML={{
            __html: generateHTML(description as JSONContent),
          }}
        />
      )}
    </div>
  );
}

function PreviewAttributeRecord({
  activeStep,
  attribute,
}: {
  activeStep: number;
  attribute: JobOperationAttribute;
}) {
  const [employees] = usePeople();
  const numberFormatter = useNumberFormatter();

  if (!attribute.jobOperationStepRecord) return null;
  const record = attribute.jobOperationStepRecord.find(
    (r) => r.index === activeStep
  );

  return (
    <div className="min-w-[200px] truncate text-right font-medium">
      {attribute.type === "Task" && (
        <Checkbox checked={record?.booleanValue ?? false} />
      )}
      {attribute.type === "Checkbox" && (
        <Checkbox checked={record?.booleanValue ?? false} />
      )}
      {attribute.type === "Value" && <p className="text-sm">{record?.value}</p>}
      {attribute.type === "Measurement" &&
        typeof record?.numericValue === "number" && (
          <p
            className={cn(
              "text-sm",
              attribute.minValue !== null &&
                record?.numericValue < attribute.minValue &&
                "text-red-500",
              attribute.maxValue !== null &&
                record?.numericValue > attribute.maxValue &&
                "text-red-500"
            )}
          >
            {numberFormatter.format(record?.numericValue)}{" "}
            {attribute.unitOfMeasureCode}
          </p>
        )}
      {attribute.type === "Timestamp" && (
        <p className="text-sm">{formatDateTime(record?.value ?? "")}</p>
      )}
      {attribute.type === "List" && <p className="text-sm">{record?.value}</p>}
      {attribute.type === "Person" && (
        <p className="text-sm">
          {employees.find((e) => e.id === record?.userValue)?.name}
        </p>
      )}
      {attribute.type === "File" && record?.value && (
        <div className="flex justify-end gap-2 text-sm">
          <LuPaperclip className="size-4 text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

function ParametersListItem({
  parameter,
  operationId,
  className,
}: {
  parameter: JobOperationParameter;
  operationId?: string;
  className: string;
}) {
  const { key, value } = parameter;

  if (!operationId) return null;
  return (
    <div className={cn("border-b p-6 hover:bg-muted/30", className)}>
      <div className="flex flex-1 justify-between items-center w-full">
        <HStack spacing={4} className="w-2/3">
          <HStack spacing={4} className="flex-1">
            <div className="bg-muted border rounded-full flex items-center justify-center p-2">
              <LuActivity />
            </div>
            <p className="text-foreground text-sm font-medium">{key}</p>
          </HStack>
        </HStack>
        <div className="flex items-center justify-end gap-2">
          <p
            className={cn(
              "text-foreground",
              value?.length > 8
                ? "text-sm"
                : "text-2xl font-semibold tracking-tight"
            )}
          >
            {value}
          </p>
        </div>
      </div>
    </div>
  );
}

function RecordModal({
  attribute,
  activeStep,
  onClose,
}: {
  attribute: JobOperationAttribute;
  activeStep: number;
  onClose: () => void;
}) {
  const [employees] = usePeople();
  const employeeOptions = useMemo(() => {
    return employees.map((employee) => ({
      label: employee.name,
      value: employee.id,
    }));
  }, [employees]);

  const { carbon } = useCarbon();
  const { company } = useUser();
  const [file, setFile] = useState<File | null>(null);
  const [filePath, setFilePath] = useState<string | null>(null);

  const fetcher = useFetcher<{ success: boolean }>();

  const onDrop = async (acceptedFiles: File[]) => {
    if (!acceptedFiles[0] || !carbon) return;
    const fileUpload = acceptedFiles[0];

    setFile(fileUpload);
    toast.info(`Uploading ${fileUpload.name}`);

    const fileName = `${company.id}/job/${attribute.operationId}/${fileUpload.name}`;

    const upload = await carbon?.storage
      .from("private")
      .upload(fileName, fileUpload, {
        cacheControl: `${12 * 60 * 60}`,
        upsert: true,
      });

    if (upload.error) {
      toast.error(`Failed to upload file: ${fileUpload.name}`);
    } else if (upload.data?.path) {
      toast.success(`Uploaded: ${fileUpload.name}`);
      setFilePath(upload.data.path);
    }
  };

  useEffect(() => {
    if (fetcher.data?.success) {
      onClose();
    }
  }, [fetcher.data?.success, onClose]);

  const record = attribute?.jobOperationStepRecord.find(
    (r) => r.index === activeStep
  );

  const [booleanControlled, setBooleanControlled] = useState(
    record?.booleanValue ?? false
  );

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
          method="post"
          validator={stepRecordValidator}
          action={path.to.record}
          onSubmit={onClose}
          defaultValues={{
            index: activeStep,
            jobOperationStepId: attribute.id,
            value:
              record?.value ??
              (attribute.type === "Timestamp" ? new Date().toISOString() : ""),
            numericValue: record?.numericValue ?? 0,
            userValue: record?.userValue ?? "",
          }}
          fetcher={fetcher}
        >
          <ModalHeader>
            <ModalTitle>
              {attribute.name} - Set {activeStep + 1}
            </ModalTitle>
          </ModalHeader>
          <ModalBody>
            <Hidden name="id" />
            <Hidden name="jobOperationStepId" />
            <Hidden name="index" />
            {attribute.type === "Checkbox" && (
              <Hidden
                name="booleanValue"
                value={booleanControlled ? "true" : "false"}
              />
            )}
            {attribute.type === "File" && (
              <Hidden name="value" value={filePath ?? ""} />
            )}
            <VStack spacing={4}>
              {attribute.description && (
                <div
                  className="flex flex-col gap-2"
                  dangerouslySetInnerHTML={{
                    __html: generateHTML(attribute.description as JSONContent),
                  }}
                />
              )}
              {attribute.type === "Value" && (
                <InputField name="value" label="" />
              )}
              {attribute.type === "Measurement" && (
                <Number name="numericValue" label="" />
              )}
              {attribute.type === "Timestamp" && (
                <DateTimePicker name="value" label="" />
              )}
              {attribute.type === "Checkbox" && (
                <Switch
                  checked={booleanControlled}
                  onCheckedChange={(checked) => setBooleanControlled(!!checked)}
                />
              )}
              {attribute.type === "Person" && (
                <Combobox name="userValue" label="" options={employeeOptions} />
              )}
              {attribute.type === "List" && (
                <Select
                  name="value"
                  label=""
                  options={(attribute.listValues ?? []).map((value) => ({
                    label: value,
                    value,
                  }))}
                />
              )}
              {attribute.type === "File" &&
                (file ? (
                  <div className="flex flex-col gap-2 items-center justify-center py-6 w-full">
                    <LuFile className="size-10 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">{file.name}</p>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setFile(null);
                        setFilePath(null);
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                ) : (
                  <FileDropzone onDrop={onDrop} />
                ))}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Submit
              isLoading={fetcher.state !== "idle"}
              isDisabled={
                fetcher.state !== "idle" ||
                (attribute.type === "File" && !filePath)
              }
              rightIcon={<LuCircleCheck />}
              type="submit"
            >
              Record
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}

function DeleteAttributeRecordModal({
  onClose,
  id,
  title,
  description,
}: {
  onClose: () => void;
  id: string;
  title: string;
  description: string;
}) {
  const fetcher = useFetcher<{ success: boolean }>();

  useEffect(() => {
    if (fetcher.data?.success) {
      onClose();
    }
  }, [fetcher.data?.success, onClose]);

  return (
    <Modal open={true} onOpenChange={onClose}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>{title}</ModalTitle>
          <ModalDescription>{description}</ModalDescription>
        </ModalHeader>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <fetcher.Form method="post" action={path.to.recordDelete(id)}>
            <Button
              isLoading={fetcher.state !== "idle"}
              isDisabled={fetcher.state !== "idle"}
              type="submit"
              variant="destructive"
            >
              Delete
            </Button>
          </fetcher.Form>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
