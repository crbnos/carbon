import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  cn,
  Heading,
  HStack,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModelViewer,
  Progress,
  ScrollArea,
  Separator,
  SidebarTrigger,
  Skeleton,
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
import { useMode, useUser } from "~/hooks";
import type { productionEventType } from "~/services/models";
import {
  finishValidator,
  issueValidator,
  nonScrapQuantityValidator,
  productionEventValidator,
  scrapQuantityValidator,
} from "~/services/models";
import type {
  Job,
  JobMaterial,
  OperationWithDetails,
  ProductionEvent,
  ProductionQuantity,
  StorageItem,
} from "~/services/types";
import { path } from "~/utils/path";

import { useCarbon } from "@carbon/auth";
import {
  Combobox,
  Hidden,
  Number,
  NumberControlled,
  Select,
  TextArea,
  ValidatedForm,
} from "@carbon/form";
import {
  convertDateStringToIsoString,
  convertKbToString,
  formatDate,
  formatDurationMilliseconds,
  formatRelativeTime,
} from "@carbon/utils";
import {
  getLocalTimeZone,
  now,
  parseAbsolute,
  toZoned,
} from "@internationalized/date";
import type {
  PostgrestResponse,
  PostgrestSingleResponse,
  RealtimeChannel,
} from "@supabase/supabase-js";
import { flushSync } from "react-dom";
import { FaTasks } from "react-icons/fa";
import { FaCheck, FaPause, FaPlay, FaPlus, FaTrash } from "react-icons/fa6";
import {
  LuAlertTriangle,
  LuChevronLeft,
  LuClipboardCheck,
  LuGitBranchPlus,
  LuHammer,
  LuHardHat,
  LuTimer,
} from "react-icons/lu";
import { MethodIcon, MethodItemTypeIcon } from "~/components/Icons";
import { getFileType } from "~/services/operations.service";
import { useItems } from "~/stores";
import ItemThumbnail from "./ItemThumbnail";
import ScrapReason from "./ScrapReason";

type JobOperationProps = {
  events: ProductionEvent[];
  files: Promise<StorageItem[]>;
  materials: Promise<PostgrestResponse<JobMaterial>>;
  operation: OperationWithDetails;
  job: Job;
  thumbnailPath: string | null;
  workCenter: Promise<PostgrestSingleResponse<{ name: string }>>;
};

export const JobOperation = ({
  events,
  files,
  job,
  materials,
  operation: originalOperation,
  thumbnailPath,
  workCenter,
}: JobOperationProps) => {
  const navigate = useNavigate();

  const { downloadFile, getFilePath } = useFiles(job);

  const {
    active,
    activeTab,
    completeModal,
    eventType,
    finishModal,
    hasActiveEvents,
    isOverdue,
    issueModal,
    laborProductionEvent,
    machineProductionEvent,
    operation,
    progress,
    reworkModal,
    scrapModal,
    selectedMaterial,
    setActiveTab,
    setEventType,
    setSelectedMaterial,
    setupProductionEvent,
  } = useOperation(originalOperation, events);

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

  return (
    <>
      <Tabs
        key={operation.id}
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
                onClick={() => navigate(-1)}
                className="pl-2"
              >
                Back
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
                  value="instructions"
                >
                  Instructions
                </TabsTrigger>
              </TabsList>
            </div>
          </HStack>
        </header>

        <div className="hidden md:flex items-center justify-between px-4 py-2 h-[var(--header-height)] bg-background gap-4 max-w-[100vw] overflow-x-hidden scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent">
          <Heading size="h4">{operation.jobReadableId}</Heading>

          <HStack className="justify-end items-center gap-2">
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
            <div className="flex items-start justify-between p-4">
              <HStack>
                {thumbnailPath && (
                  <ItemThumbnail thumbnailPath={thumbnailPath} size="xl" />
                )}
                <div className="flex flex-col flex-grow">
                  <Heading size="h3">{operation.itemReadableId}</Heading>
                  <p className="text-muted-foreground line-clamp-1">
                    {operation.itemDescription}
                  </p>
                </div>
              </HStack>
              <div className="flex flex-col flex-shrink items-end">
                <Heading size="h2">{operation.operationQuantity}</Heading>
                <p className="text-muted-foreground line-clamp-1">
                  {operation.itemUnitOfMeasure}
                </p>
              </div>
            </div>
            <Separator />
            <div className="flex items-start p-4">
              <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-3 w-full">
                <div className="rounded-xl border bg-card text-card-foreground shadow">
                  <div className="p-6 flex flex-row items-center justify-between space-y-0 pb-2">
                    <h3 className="tracking-tight text-sm font-medium">
                      Completed
                    </h3>
                    <FaCheck className="h-3 w-3 text-muted-foreground" />
                  </div>
                  <div className="p-6 pt-0">
                    <Heading size="h1">{operation.quantityComplete}</Heading>
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
            <Separator />

            <div className="flex flex-col items-start justify-between w-full">
              <div className="flex flex-col gap-4 p-4 w-full">
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
                <Suspense key={operationId} fallback={<TableSkeleton />}>
                  <Await resolve={materials}>
                    {(resolvedMaterials) => (
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
                          {resolvedMaterials?.data?.length === 0 ? (
                            <Tr>
                              <Td
                                colSpan={24}
                                className="py-8 text-muted-foreground text-center"
                              >
                                No materials
                              </Td>
                            </Tr>
                          ) : (
                            resolvedMaterials?.data?.map((material) => (
                              <Tr
                                key={material.id}
                                className={cn(
                                  material.jobOperationId !== operationId &&
                                    "opacity-50 hover:opacity-100"
                                )}
                              >
                                <Td>
                                  <HStack spacing={2}>
                                    <MethodItemTypeIcon
                                      type={material.itemType}
                                      className="size-4"
                                    />
                                    <VStack spacing={0}>
                                      <span className="font-semibold">
                                        {material.itemReadableId}
                                      </span>
                                      <span className="text-muted-foreground text-xs">
                                        {material.description}
                                      </span>
                                    </VStack>
                                  </HStack>
                                </Td>
                                <Td className="lg:table-cell hidden">
                                  <Badge variant="secondary">
                                    <MethodIcon
                                      type={material.methodType}
                                      className="mr-2"
                                    />
                                    {material.methodType}
                                  </Badge>
                                </Td>

                                <Td>{material.estimatedQuantity}</Td>
                                <Td>
                                  {material.methodType === "Make" ? (
                                    <MethodIcon type="Make" />
                                  ) : (
                                    material.quantityIssued
                                  )}
                                </Td>
                                <Td className="text-right">
                                  {material.methodType !== "Make" && (
                                    <IconButton
                                      aria-label="Issue Material"
                                      variant="ghost"
                                      icon={<LuGitBranchPlus />}
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
                            ))
                          )}
                        </Tbody>
                      </Table>
                    )}
                  </Await>
                </Suspense>
              </div>
            </div>
            <Separator />
            <div className="flex flex-col items-start justify-between w-full">
              <div className="flex flex-col gap-4 p-4 w-full">
                <Heading size="h3">Files</Heading>
                <Suspense key={operationId} fallback={<TableSkeleton />}>
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
                          {resolvedFiles.length === 0 ? (
                            <Tr>
                              <Td
                                colSpan={24}
                                className="py-8 text-muted-foreground text-center"
                              >
                                No files
                              </Td>
                            </Tr>
                          ) : (
                            resolvedFiles.map((file) => {
                              const type = getFileType(file.name);
                              return (
                                <Tr key={file.id}>
                                  <Td>
                                    <HStack>
                                      <FileIcon type={type} />
                                      <span
                                        className="font-medium"
                                        onClick={() => downloadFile(file)}
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
                                  <Td>{/* Add actions here if needed */}</Td>
                                </Tr>
                              );
                            })
                          )}
                        </Tbody>
                      </Table>
                    )}
                  </Await>
                </Suspense>
              </div>
            </div>
          </ScrollArea>
        </TabsContent>
        <TabsContent value="model">
          <div className="w-full h-[calc(100dvh-var(--header-height)*2)] p-0">
            <ModelViewer
              file={null}
              key={operation.itemModelPath ?? job.modelPath}
              url={`/file/preview/private/${
                operation.itemModelPath ?? job.modelPath
              }`}
              mode={mode}
              className="rounded-none"
            />
          </div>
        </TabsContent>
        <TabsContent value="instructions" className="flex flex-grow">
          <ScrollArea className="w-full h-[calc(100dvh-var(--header-height)*2-var(--controls-height)-2rem)] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent p-4">
            <div
              className="prose dark:prose-invert"
              dangerouslySetInnerHTML={{
                __html: generateHTML(
                  (operation.workInstruction ?? {}) as JSONContent
                ),
              }}
            />
          </ScrollArea>
        </TabsContent>
        {activeTab !== "instructions" && (
          <Controls>
            <div className="flex flex-col items-center gap-2 p-4">
              <VStack spacing={2}>
                <VStack spacing={1}>
                  <span className="text-muted-foreground text-xs">
                    Work Center
                  </span>
                  <Suspense fallback={<Heading size="h4">...</Heading>}>
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
                hasActiveEvents={hasActiveEvents}
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
                  icon={
                    <FaTrash className="text-accent-foreground group-hover:text-accent-foreground/80" />
                  }
                  tooltip="Log Scrap"
                  onClick={scrapModal.onOpen}
                />

                <IconButtonWithTooltip
                  icon={
                    <FaPlus className="text-accent-foreground group-hover:text-accent-foreground/80" />
                  }
                  tooltip="Log Completed"
                  onClick={completeModal.onOpen}
                />
                <IconButtonWithTooltip
                  icon={
                    <FaCheck className="text-accent-foreground group-hover:text-accent-foreground/80" />
                  }
                  tooltip="Close Out"
                  onClick={finishModal.onOpen}
                />
              </div>
            </div>
          </Controls>
        )}
        <Times>
          <div className="flex items-start p-4">
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
                    value={(progress.machine / operation.machineDuration) * 100}
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
                    (operation.quantityComplete / operation.operationQuantity) *
                    100
                  }
                />
              </HStack>
            </div>
          </div>
        </Times>
      </Tabs>
      {reworkModal.isOpen && (
        <QuantityModal
          type="rework"
          operation={operation}
          setupProductionEvent={setupProductionEvent}
          laborProductionEvent={laborProductionEvent}
          machineProductionEvent={machineProductionEvent}
          onClose={reworkModal.onClose}
        />
      )}
      {scrapModal.isOpen && (
        <QuantityModal
          type="scrap"
          operation={operation}
          setupProductionEvent={setupProductionEvent}
          laborProductionEvent={laborProductionEvent}
          machineProductionEvent={machineProductionEvent}
          onClose={scrapModal.onClose}
        />
      )}
      {completeModal.isOpen && (
        <QuantityModal
          type="complete"
          operation={operation}
          setupProductionEvent={setupProductionEvent}
          laborProductionEvent={laborProductionEvent}
          machineProductionEvent={machineProductionEvent}
          onClose={completeModal.onClose}
        />
      )}
      {/* @ts-ignore */}
      {finishModal.isOpen && (
        <QuantityModal
          type="finish"
          operation={operation}
          setupProductionEvent={setupProductionEvent}
          laborProductionEvent={laborProductionEvent}
          machineProductionEvent={machineProductionEvent}
          onClose={finishModal.onClose}
        />
      )}
      {issueModal.isOpen && (
        <IssueModal
          operationId={operation.id}
          material={selectedMaterial ?? undefined}
          onClose={() => {
            setSelectedMaterial(null);
            issueModal.onClose();
          }}
        />
      )}
    </>
  );
};

function useOperation(
  operation: OperationWithDetails,
  events: ProductionEvent[]
) {
  const { carbon, accessToken } = useCarbon();
  const user = useUser();
  const revalidator = useRevalidator();
  const channelRef = useRef<RealtimeChannel | null>(null);

  const scrapModal = useDisclosure();
  const reworkModal = useDisclosure();
  const completeModal = useDisclosure();
  const finishModal = useDisclosure();
  const issueModal = useDisclosure();

  const [selectedMaterial, setSelectedMaterial] = useState<JobMaterial | null>(
    null
  );

  const [activeTab, setActiveTab] = useState("details");
  const [eventType, setEventType] = useState(() => {
    if (operation.setupDuration > 0) {
      return "Setup";
    }
    if (operation.laborDuration > 0) {
      return "Labor";
    }
    return "Machine";
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

  useInterval(() => {
    setProgress(getProgress());
  }, 1000);

  return {
    active,
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
  const { carbon } = useCarbon();

  const getFilePath = useCallback(
    (file: StorageItem) => {
      const companyId = user.company.id;
      const { bucket } = file;
      const folder =
        bucket === "job" ? job.id : job.salesOrderLineId ?? job.quoteLineId;
      const path = `${companyId}/${bucket}/${folder}/${file.name}`;
      return path;
    },
    [job.id, job.quoteLineId, job.salesOrderLineId, user.company.id]
  );

  const downloadFile = useCallback(
    async (file: StorageItem) => {
      const type = getFileType(file.name);
      if (type === "PDF") {
        const url = path.to.file.previewFile(`private/${getFilePath(file)}`);
        window.open(url, "_blank");
      } else {
        const result = await carbon?.storage
          .from("private")
          .download(getFilePath(file));

        if (!result || result.error) {
          toast.error(result?.error?.message || "Error downloading file");
          return;
        }

        const a = document.createElement("a");
        document.body.appendChild(a);
        const url = window.URL.createObjectURL(result.data);
        a.href = url;
        a.download = file.name;
        a.click();

        setTimeout(() => {
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);
        }, 0);
      }
    },
    [carbon?.storage, getFilePath]
  );

  return {
    downloadFile,
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
          <Tr key={index}>
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
  ...props
}: ComponentProps<"button"> & { icon: ReactNode; tooltip: string }) {
  return (
    <ButtonWithTooltip
      {...props}
      tooltip={tooltip}
      className="size-16 text-xl md:text-lg md:size-[8dvh]  flex flex-row items-center gap-2 justify-center bg-accent rounded-full shadow-lg hover:cursor-pointer hover:shadow-xl hover:accent hover:scale-105 transition-all disabled:cursor-not-allowed disabled:bg-muted"
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
  hasActiveEvents,
  ...props
}: ComponentProps<"button"> & {
  eventType: (typeof productionEventType)[number];
  job: Job;
  operation: OperationWithDetails;
  setupProductionEvent: ProductionEvent | undefined;
  laborProductionEvent: ProductionEvent | undefined;
  machineProductionEvent: ProductionEvent | undefined;
  hasActiveEvents: boolean;
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
      <Hidden name="jobOperationId" value={operation.id} />
      <Hidden name="timezone" />
      <Hidden
        name="hasActiveEvents"
        value={hasActiveEvents ? "true" : "false"}
      />
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
  operation,
  setupProductionEvent,
  laborProductionEvent,
  machineProductionEvent,
  onClose,
  type,
}: {
  operation: OperationWithDetails;
  setupProductionEvent: ProductionEvent | undefined;
  laborProductionEvent: ProductionEvent | undefined;
  machineProductionEvent: ProductionEvent | undefined;
  onClose: () => void;
  type: "scrap" | "rework" | "complete" | "finish";
}) {
  const fetcher = useFetcher<ProductionQuantity>();
  const [quantity, setQuantity] = useState(type === "finish" ? 0 : 1);

  const titleMap = {
    scrap: `Log Scrap for ${operation.itemReadableId}`,
    rework: `Log Rework for ${operation.itemReadableId}`,
    complete: `Log Completed for ${operation.itemReadableId}`,
    finish: `Close Out ${operation.itemReadableId}`,
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
            <Hidden name="jobOperationId" />
            <Hidden name="setupProductionEventId" />
            <Hidden name="laborProductionEventId" />
            <Hidden name="machineProductionEventId" />
            <VStack spacing={2}>
              {type === "finish" && !isOperationComplete && (
                <Alert variant="destructive">
                  <LuAlertTriangle className="h-4 w-4" />
                  <AlertTitle>Insufficient quantity</AlertTitle>
                  <AlertDescription>
                    The completed quantity for this operation is less than the
                    required quantity of {operation.operationQuantity}.
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
    return items.map((item) => ({
      label: item.readableId,
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
            materialId: material?.id,
            jobOperationId: operationId,
            itemId: material?.itemId,
            quantity: 1,
            adjustmentType: "Positive Adjmt.",
          }}
        >
          <ModalBody>
            <Hidden name="jobOperationId" />
            <Hidden name="materialId" />
            {!material?.id && (
              <Hidden name="adjustmentType" value="Set Quantity" />
            )}
            <VStack spacing={4}>
              <Combobox name="itemId" label="Item" options={itemOptions} />
              {material?.id && (
                <Select
                  name="adjustmentType"
                  label="Adjustment Type"
                  options={[
                    { label: "Set Quantity", value: "Set Quantity" },
                    {
                      label: "Positive Adjustment",
                      value: "Positive Adjmt.",
                    },
                    {
                      label: "Negative Adjustment",
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
