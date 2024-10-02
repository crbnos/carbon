import {
  AutodeskViewer,
  Badge,
  Button,
  cn,
  generateHTML,
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
  Progress,
  ScrollArea,
  Separator,
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
  VStack,
  type JSONContent,
} from "@carbon/react";
import { Await, Link, useFetcher } from "@remix-run/react";
import type { ComponentProps, ReactNode } from "react";
import { Suspense, useCallback, useMemo, useState } from "react";
import {
  DeadlineIcon,
  DocumentIcon,
  DocumentPreview,
  Hyperlink,
  OptionallyFullscreen,
  StatusIcon,
} from "~/components";
import { useUser } from "~/hooks";
import type {
  Job,
  JobMaterial,
  Operation,
  OperationWithDetails,
  ProductionEvent,
  productionEventType,
  ProductionQuantity,
  StorageItem,
} from "~/services/jobs.service";
import {
  getDocumentType,
  productionEventValidator,
  scrapQuantityValidator,
} from "~/services/jobs.service";
import { path } from "~/utils/path";

import { useCarbon } from "@carbon/auth";
import { Hidden, Number, TextArea, ValidatedForm } from "@carbon/form";
import {
  convertDateStringToIsoString,
  convertKbToString,
  formatDurationMilliseconds,
  formatRelativeTime,
} from "@carbon/utils";
import {
  getLocalTimeZone,
  now,
  parseAbsolute,
  toZoned,
} from "@internationalized/date";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { FaRedoAlt, FaTasks } from "react-icons/fa";
import {
  FaCheck,
  FaFlagCheckered,
  FaPause,
  FaPlay,
  FaTrash,
} from "react-icons/fa6";
import {
  LuChevronLeft,
  LuClipboardCheck,
  LuExpand,
  LuHammer,
  LuHardHat,
  LuTimer,
} from "react-icons/lu";
import { MethodIcon, MethodItemTypeIcon } from "~/components/Icons";

type JobOperationProps = {
  backPath: string;
  events: ProductionEvent[];
  files: Promise<StorageItem[]>;
  materials: Promise<PostgrestResponse<JobMaterial>>;
  operation: OperationWithDetails;
  job: Job;
};

export const JobOperation = ({
  backPath,
  events,
  files,
  job,
  materials,
  operation,
}: JobOperationProps) => {
  const {
    active,
    activeTab,
    eventType,
    fullscreen,
    laborProductionEvent,
    machineProductionEvent,
    isOverdue,
    progress,
    scrapModal,
    setupProductionEvent,
    downloadDocument,
    getDocumentPath,
    setActiveTab,
    setEventType,
  } = useOperation(operation, events, job);

  return (
    <OptionallyFullscreen
      isFullScreen={fullscreen.isOpen}
      onClose={fullscreen.onClose}
    >
      <Tabs
        key={operation.id}
        value={activeTab}
        onValueChange={setActiveTab}
        className="w-full h-full bg-card"
      >
        <div className="flex items-center justify-between px-4 py-2 h-[52px] bg-background">
          <div className="flex items-start flex-grow gap-1">
            {!fullscreen.isOpen && (
              <Link to={backPath}>
                <IconButton
                  aria-label="Back"
                  icon={<LuChevronLeft />}
                  variant="secondary"
                />
              </Link>
            )}
            <Heading size="h2">{operation.jobReadableId}</Heading>
          </div>
          <div className="hidden md:flex flex-shrink-0 items-center justify-end gap-2">
            <Navigation
              job={job}
              operation={operation}
              fullscreen={fullscreen}
            />
          </div>
        </div>

        {!fullscreen.isOpen && (
          <>
            <Separator />
            <div className="flex items-center justify-start px-4 py-2 h-[52px] bg-background gap-4 w-full overflow-y-auto">
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
                  <StatusIcon status={operation.operationStatus} />
                  <span className="text-sm truncate">
                    {operation.operationStatus}
                  </span>
                </HStack>
              )}
              {operation.duration && (
                <HStack className="justify-start space-x-2">
                  <LuTimer className="text-muted-foreground" />
                  <span className="text-sm truncate">
                    {formatDurationMilliseconds(operation.duration)}
                  </span>
                </HStack>
              )}
            </div>
            <Separator />
          </>
        )}
        <div className="flex md:hidden items-center justify-start px-4 py-2 h-[52px] bg-background gap-4">
          <Navigation job={job} operation={operation} fullscreen={fullscreen} />
        </div>
        <Separator className="flex md:hidden" />

        <TabsContent value="details">
          <ScrollArea className="h-[calc(100vh-156px)] md:h-[calc(100vh-104px)] pb-36">
            <div className="flex items-start justify-between p-4">
              <div className="flex flex-col flex-grow">
                <Heading size="h2">{operation.itemReadableId}</Heading>
                <p className="text-muted-foreground line-clamp-1">
                  {operation.itemDescription}
                </p>
              </div>
              <div className="flex flex-col flex-shrink items-end">
                <Heading size="h2">{operation.operationQuantity}</Heading>
                <p className="text-muted-foreground line-clamp-1">
                  {operation.itemUnitOfMeasure}
                </p>
              </div>
            </div>
            <Separator />
            <div className="flex items-start p-4">
              <div className="grid gap-4 md:grid-cols-1 lg:grid-cols-3 w-full">
                <div className="rounded-xl border bg-card text-card-foreground shadow">
                  <div className="p-6 flex flex-row items-center justify-between space-y-0 pb-2">
                    <h3 className="tracking-tight text-sm font-medium">
                      Scrapped
                    </h3>
                    <FaTrash className="h-3 w-3 text-muted-foreground" />
                  </div>
                  <div className="p-6 pt-0">
                    <Heading size="h2">{operation.quantityScrapped}</Heading>
                  </div>
                </div>
                <div className="rounded-xl border bg-card text-card-foreground shadow">
                  <div className="p-6 flex flex-row items-center justify-between space-y-0 pb-2">
                    <h3 className="tracking-tight text-sm font-medium">
                      Completed
                    </h3>
                    <FaCheck className="h-3 w-3 text-muted-foreground" />
                  </div>
                  <div className="p-6 pt-0">
                    <Heading size="h2">{operation.quantityComplete}</Heading>
                  </div>
                </div>

                <div className="rounded-xl border bg-card text-card-foreground shadow">
                  <div className="p-6 flex flex-row items-center justify-between space-y-0 pb-2">
                    <h3 className="tracking-tight text-sm font-medium">
                      Reworked
                    </h3>
                    <FaRedoAlt className="h-3 w-3 text-muted-foreground" />
                  </div>
                  <div className="p-6 pt-0">
                    <Heading size="h2">{operation.quantityReworked}</Heading>
                  </div>
                </div>
              </div>
            </div>
            <Separator />
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
                      operation.operationStatus === "Paused"
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
            <Separator />

            <div className="flex items-start justify-between p-4">
              <div className="flex flex-col flex-shrink items-end">
                {operation.jobDeadlineType && (
                  <HStack className="justify-start space-x-2">
                    <DeadlineIcon
                      deadlineType={operation.jobDeadlineType}
                      overdue={isOverdue}
                    />
                    <Tooltip>
                      <TooltipTrigger>
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
                                convertDateStringToIsoString(
                                  operation.jobDueDate
                                )
                              )}`
                            : "–"}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        {operation.jobDeadlineType}
                      </TooltipContent>
                    </Tooltip>
                  </HStack>
                )}
              </div>
            </div>
            <Separator />

            <div className="flex flex-col items-start justify-between w-full">
              <div className="flex flex-col gap-4 p-4 w-full">
                <Heading size="h3">Materials</Heading>
                <Suspense fallback={<TableSkeleton />}>
                  <Await resolve={materials}>
                    {(resolvedMaterials) => (
                      <Table className="w-full">
                        <Thead>
                          <Tr>
                            <Th>Part</Th>
                            <Th>Qty Per</Th>
                            <Th>Estimated Qty</Th>
                            <Th className="lg:block hidden"></Th>
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
                              <Tr key={material.id}>
                                <Td className="flex items-center gap-2">
                                  <MethodItemTypeIcon
                                    type={material.itemType}
                                  />
                                  <span className="font-semibold">
                                    {material.itemReadableId}
                                  </span>
                                  <span className="md:flex hidden">
                                    {material.description}
                                  </span>
                                </Td>

                                <Td>{material.quantity}</Td>
                                <Td>{material.estimatedQuantity}</Td>

                                <Td className="lg:block hidden">
                                  <Badge variant="secondary">
                                    <MethodIcon
                                      type={material.methodType}
                                      className="mr-2"
                                    />
                                    {material.methodType}
                                  </Badge>
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
                <Suspense fallback={<TableSkeleton />}>
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
                              const type = getDocumentType(file.name);
                              return (
                                <Tr key={file.id}>
                                  <Td>
                                    <HStack>
                                      <DocumentIcon type={type} />
                                      <Hyperlink
                                        onClick={() => downloadDocument(file)}
                                      >
                                        {["PDF", "Image"].includes(type) ? (
                                          <DocumentPreview
                                            bucket="private"
                                            pathToFile={getDocumentPath(file)}
                                            // @ts-ignore
                                            type={getDocumentType(file.name)}
                                          >
                                            {file.name}
                                          </DocumentPreview>
                                        ) : (
                                          file.name
                                        )}
                                      </Hyperlink>
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
          <div className="h-[calc(100vh-156px)] md:h-[calc(100vh-104px)] p-4">
            <AutodeskViewer
              urn={operation.itemAutodeskUrn ?? job.autodeskUrn}
              showDefaultToolbar
            />
          </div>
        </TabsContent>
        <TabsContent value="instructions" className="flex flex-grow bg-card">
          <ScrollArea className="h-[calc(100vh-156px)] md:h-[calc(100vh-104px)] w-full p-4 pb-36">
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

        {activeTab !== "model" && (
          <Controls>
            <div className="flex flex-col items-center gap-4">
              <div className="flex items-center gap-4 justify-center">
                <IconButtonWithTooltip
                  icon={
                    <FaRedoAlt className="text-accent-foreground group-hover:text-accent-foreground/80" />
                  }
                  tooltip="Rework"
                />
                <IconButtonWithTooltip
                  icon={
                    <FaTrash className="text-accent-foreground group-hover:text-accent-foreground/80" />
                  }
                  tooltip="Scrap"
                  onClick={scrapModal.onOpen}
                />
                <StartStopButton
                  eventType={eventType as (typeof productionEventType)[number]}
                  operation={operation}
                  setupProductionEvent={setupProductionEvent}
                  laborProductionEvent={laborProductionEvent}
                  machineProductionEvent={machineProductionEvent}
                />

                <IconButtonWithTooltip
                  icon={
                    <FaCheck className="text-accent-foreground group-hover:text-accent-foreground/80" />
                  }
                  tooltip="Complete"
                />
                <IconButtonWithTooltip
                  icon={
                    <FaFlagCheckered className="text-accent-foreground group-hover:text-accent-foreground/80" />
                  }
                  tooltip="Finish"
                />
              </div>
              <WorkTypeToggle
                active={active}
                operation={operation}
                value={eventType}
                onChange={setEventType}
              />
            </div>
          </Controls>
        )}
      </Tabs>
      {scrapModal.isOpen && (
        <ScrapModal
          operation={operation}
          setupProductionEvent={setupProductionEvent}
          laborProductionEvent={laborProductionEvent}
          machineProductionEvent={machineProductionEvent}
          onClose={scrapModal.onClose}
        />
      )}
    </OptionallyFullscreen>
  );
};

function useActiveEvents(events: ProductionEvent[]): {
  active: { setup: boolean; labor: boolean; machine: boolean };
  setupProductionEvent: ProductionEvent | undefined;
  laborProductionEvent: ProductionEvent | undefined;
  machineProductionEvent: ProductionEvent | undefined;
  progress: { setup: number; labor: number; machine: number };
} {
  const user = useUser();

  const getProgress = useCallback(() => {
    const timeNow = now(getLocalTimeZone());
    return events.reduce(
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
  }, [events]);
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
      machineProductionEvent: events.find(
        (e) => e.type === "Machine" && e.endTime === null
      ),
    };
  }, [events, user.id]);

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
    ...activeEvents,
    progress,
  };
}

function useOperation(
  operation: OperationWithDetails,
  events: ProductionEvent[],
  job: Job
) {
  const user = useUser();
  const { carbon } = useCarbon();
  const fullscreen = useDisclosure();
  const scrapModal = useDisclosure();
  const [activeTab, setActiveTab] = useState("details");
  const [eventType, setEventType] = useState(() => {
    if (operation.laborDuration > 0) {
      return "Labor";
    }
    if (operation.machineDuration > 0) {
      return "Machine";
    }
    return "Setup";
  });

  const {
    active,
    setupProductionEvent,
    laborProductionEvent,
    machineProductionEvent,
    progress,
  } = useActiveEvents(events);

  const getDocumentPath = useCallback(
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

  const downloadDocument = useCallback(
    async (file: StorageItem) => {
      const type = getDocumentType(file.name);
      if (type === "PDF") {
        const url = path.to.file.previewFile(
          `private/${getDocumentPath(file)}`
        );
        window.open(url, "_blank");
      } else {
        const result = await carbon?.storage
          .from("private")
          .download(getDocumentPath(file));

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
    [carbon?.storage, getDocumentPath]
  );

  return {
    active,
    activeTab,
    eventType,
    fullscreen,
    laborProductionEvent,
    machineProductionEvent,
    progress,
    scrapModal,
    setupProductionEvent,
    isOverdue: operation.jobDueDate
      ? new Date(operation.jobDueDate) < new Date()
      : false,

    downloadDocument,
    getDocumentPath,
    setActiveTab,
    setEventType,
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
    <TooltipProvider>
      <div
        className={cn(
          "absolute p-4 bottom-0 left-1/2 transform -translate-x-1/2 w-full",
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
      className="w-16 h-16 flex flex-row items-center gap-2 justify-center bg-accent rounded-full shadow-lg hover:cursor-pointer hover:shadow-xl hover:accent hover:scale-105 transition-all disabled:cursor-not-allowed disabled:opacity-50"
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
}: {
  active: { setup: boolean; labor: boolean; machine: boolean };
  operation: OperationWithDetails;
  value: string;
  onChange: (type: string) => void;
}) {
  const nonZeroDurations = [
    operation.setupDuration,
    operation.laborDuration,
    operation.machineDuration,
  ].filter((duration) => duration > 0);

  if (nonZeroDurations.length <= 1) {
    return null;
  }

  return (
    <ToggleGroup value={value} type="single" onValueChange={onChange}>
      {operation.setupDuration > 0 && (
        <ToggleGroupItem
          className="w-[110px] relative"
          value="Setup"
          size="lg"
          aria-label="Toggle setup"
        >
          <LuTimer className="h-4 w-4 mr-2 flex-shrink-0" />
          Setup
          {active.setup && (
            <span className="absolute -top-1 -right-1 h-3 w-3 bg-red-500 rounded-full" />
          )}
        </ToggleGroupItem>
      )}
      {operation.laborDuration > 0 && (
        <ToggleGroupItem
          className="w-[110px] relative"
          value="Labor"
          size="lg"
          aria-label="Toggle labor"
        >
          <LuHardHat className="h-4 w-4 mr-2 flex-shrink-0" />
          Labor
          {active.labor && (
            <span className="absolute -top-1 -right-1 h-3 w-3 bg-red-500 rounded-full" />
          )}
        </ToggleGroupItem>
      )}
      {operation.machineDuration > 0 && (
        <ToggleGroupItem
          className="w-[110px] relative"
          value="Machine"
          size="lg"
          aria-label="Toggle machine"
        >
          <LuHammer className="h-4 w-4 mr-2 flex-shrink-0" />
          Machine
          {active.machine && (
            <span className="absolute -top-1 -right-1 h-3 w-3 bg-red-500 rounded-full" />
          )}
        </ToggleGroupItem>
      )}
    </ToggleGroup>
  );
}

const startStopFormId = "start-stop-form";
function StartStopButton({
  className,
  operation,
  eventType,
  setupProductionEvent,
  laborProductionEvent,
  machineProductionEvent,
  ...props
}: ComponentProps<"button"> & {
  eventType: (typeof productionEventType)[number];
  operation: OperationWithDetails;
  setupProductionEvent: ProductionEvent | undefined;
  laborProductionEvent: ProductionEvent | undefined;
  machineProductionEvent: ProductionEvent | undefined;
}) {
  const fetcher = useFetcher<ProductionEvent>();
  const isActive = useMemo(() => {
    if (eventType === "Setup") {
      return (
        (fetcher.formData?.get("id") &&
          fetcher.formData.get("type") === "Setup") ||
        !!setupProductionEvent
      );
    }
    if (eventType === "Labor") {
      return (
        (fetcher.formData?.get("id") &&
          fetcher.formData.get("type") === "Labor") ||
        !!laborProductionEvent
      );
    }
    return (
      (fetcher.formData?.get("id") &&
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
      className="group w-20 h-20 flex flex-row items-center gap-2 justify-center bg-red-500 rounded-full shadow-lg hover:cursor-pointer hover:drop-shadow-xl hover:bg-red-600 hover:scale-105 transition-all disabled:opacity-75 text-2xl"
    >
      <FaPause className="text-accent group-hover:scale-125" />
    </ButtonWithTooltip>
  );
}

function PlayButton({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      {...props}
      className="group w-20 h-20 flex flex-row items-center gap-2 justify-center bg-emerald-500 rounded-full shadow-lg hover:cursor-pointer hover:drop-shadow-xl hover:bg-emerald-600 hover:scale-105 transition-all disabled:opacity-75 text-xl"
    >
      <FaPlay className="text-accent group-hover:scale-125" />
    </button>
  );
}

function ScrapModal({
  operation,
  setupProductionEvent,
  laborProductionEvent,
  machineProductionEvent,
  onClose,
}: {
  operation: Operation;
  setupProductionEvent: ProductionEvent | undefined;
  laborProductionEvent: ProductionEvent | undefined;
  machineProductionEvent: ProductionEvent | undefined;
  onClose: () => void;
}) {
  const fetcher = useFetcher<ProductionQuantity>();
  const [scrapReason, setScrapReason] = useState("");
  return (
    <Modal open>
      <ModalContent>
        <ValidatedForm
          action={path.to.scrap}
          method="post"
          validator={scrapQuantityValidator}
          defaultValues={{
            jobOperationId: operation.id,
            quantity: 1,
            scrapReason: "",
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
            <ModalTitle>{`Scrap ${operation.itemReadableId}`}</ModalTitle>
            <ModalDescription>
              Select a scrap quantity and reason
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Hidden name="jobOperationId" />
            <Hidden name="setupProductionEventId" />
            <Hidden name="laborProductionEventId" />
            <Hidden name="machineProductionEventId" />
            <VStack spacing={2}>
              <Number
                name="quantity"
                label="Quantity"
                minValue={1}
                maxValue={operation.operationQuantity}
              />
              <TextArea
                label="Scrap Reason"
                name="scrapReason"
                value={scrapReason}
                onChange={(e) => setScrapReason(e.target.value)}
              />
              <div className="col-span-2 flex gap-2 mt-2">
                <Badge
                  variant="secondary"
                  className="cursor-pointer"
                  onClick={() => setScrapReason("Defective")}
                >
                  Defective
                </Badge>
                <Badge
                  variant="secondary"
                  className="cursor-pointer"
                  onClick={() => setScrapReason("Damaged")}
                >
                  Damaged
                </Badge>
                <Badge
                  variant="secondary"
                  className="cursor-pointer"
                  onClick={() => setScrapReason("Quality Control")}
                >
                  Quality Control
                </Badge>
              </div>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>

            <Button variant="destructive" type="submit">
              Scrap
            </Button>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}

function Navigation({
  job,
  operation,
  fullscreen,
}: {
  job: Job;
  operation: OperationWithDetails;
  fullscreen: ReturnType<typeof useDisclosure>;
}) {
  return (
    <>
      <TabsList className="md:ml-auto">
        <TabsTrigger value="details">Details</TabsTrigger>
        <TabsTrigger
          disabled={!job.autodeskUrn && !operation.itemAutodeskUrn}
          value="model"
        >
          Model
        </TabsTrigger>
        <TabsTrigger
          disabled={
            !operation.workInstruction ||
            Object.keys(operation.workInstruction).length === 0
          }
          value="instructions"
        >
          Instructions
        </TabsTrigger>
      </TabsList>
      {!fullscreen.isOpen && (
        <IconButton
          aria-label="Expand"
          className="hidden md:flex"
          icon={<LuExpand />}
          variant="secondary"
          onClick={fullscreen.onOpen}
        />
      )}
    </>
  );
}
