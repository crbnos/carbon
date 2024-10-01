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
  NumberDecrementStepper,
  NumberField,
  NumberIncrementStepper,
  NumberInput,
  NumberInputGroup,
  NumberInputStepper,
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
  type JSONContent,
} from "@carbon/react";
import { Await, Link } from "@remix-run/react";
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
  StorageItem,
} from "~/services/jobs.service";
import { getDocumentType } from "~/services/jobs.service";
import { path } from "~/utils/path";

import { useCarbon } from "@carbon/auth";
import {
  convertDateStringToIsoString,
  convertKbToString,
  formatDurationMilliseconds,
  formatRelativeTime,
} from "@carbon/utils";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { FaRedoAlt, FaTasks } from "react-icons/fa";
import { FaCheck, FaOilCan, FaPause, FaPlay, FaTrash } from "react-icons/fa6";
import {
  LuChevronDown,
  LuChevronLeft,
  LuChevronUp,
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
    activeTab,
    fullScreen,
    isOverdue,
    progress,
    downloadDocument,
    getDocumentPath,

    setActiveTab,
    setFullScreen,
  } = useOperation(operation, events, job);

  return (
    <OptionallyFullscreen
      isFullScreen={fullScreen}
      onClose={() => setFullScreen(false)}
    >
      <Tabs
        key={operation.id}
        value={activeTab}
        onValueChange={setActiveTab}
        className="w-full h-full bg-card"
      >
        <div className="flex items-center justify-between px-4 py-2 h-[52px] bg-background">
          <div className="flex items-start flex-grow gap-1">
            {!fullScreen && (
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
          <div className="flex flex-shrink-0 items-center justify-end gap-2">
            <TabsList className="ml-auto">
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
            {!fullScreen && (
              <IconButton
                aria-label="Expand"
                icon={<LuExpand />}
                variant="secondary"
                onClick={() => setFullScreen(true)}
              />
            )}
          </div>
        </div>

        {!fullScreen && (
          <>
            <Separator />
            <div className="flex items-center justify-start px-4 py-2 h-[52px] bg-background gap-4">
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

        <TabsContent value="details">
          <ScrollArea className="h-[calc(100vh-104px)] pb-36">
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
                    <LuTimer className="h-4 w-4 mr-1" />
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
                    <LuHardHat className="h-4 w-4 mr-1" />
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
                    <LuHammer className="h-4 w-4 mr-1" />
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
                  <FaTasks className="h-4 w-4 mr-1" />
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
                      <TooltipContent side="bottom">
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
          <div className="h-[calc(100vh-104px)] p-4">
            <AutodeskViewer
              urn={operation.itemAutodeskUrn ?? job.autodeskUrn}
              showDefaultToolbar
            />
          </div>
        </TabsContent>
        <TabsContent value="instructions" className="flex flex-grow bg-card">
          <ScrollArea className="h-[calc(100vh-104px)] w-full p-4 pb-36">
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
                  disabled
                  icon={
                    <FaOilCan className="text-accent-foreground group-hover:text-accent-foreground/80" />
                  }
                  tooltip="Non-Conformance Report"
                />

                <IconButtonWithTooltip
                  icon={
                    <FaTrash className="text-accent-foreground group-hover:text-accent-foreground/80" />
                  }
                  tooltip="Scrap"
                />
                <PlayButton
                  onStart={(type) => {
                    alert(type);
                  }}
                />
                <IconButtonWithTooltip
                  icon={
                    <FaRedoAlt className="text-accent-foreground group-hover:text-accent-foreground/80" />
                  }
                  tooltip="Rework"
                />
                <IconButtonWithTooltip
                  icon={
                    <FaCheck className="text-accent-foreground group-hover:text-accent-foreground/80" />
                  }
                  tooltip="Complete"
                />
              </div>
              <WorkTypeToggle />
            </div>
          </Controls>
        )}
      </Tabs>
    </OptionallyFullscreen>
  );
};

function useOperation(
  operation: OperationWithDetails,
  events: ProductionEvent[],
  job: Job
) {
  const { carbon } = useCarbon();
  const [fullScreen, setFullScreen] = useState(false);
  const [activeTab, setActiveTab] = useState("details");
  const user = useUser();

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

  const myActiveEvents = useMemo(
    () =>
      events.filter((e) => e.endTime === null && e.employeeId === user.id) ??
      [],
    [events, user.id]
  );

  const active = useMemo(
    () => ({
      setup: myActiveEvents.some((e) => e.type === "Setup"),
      labor: myActiveEvents.some((e) => e.type === "Labor"),
      machine: myActiveEvents.some((e) => e.type === "Machine"),
    }),
    [myActiveEvents]
  );

  const progress = {
    setup: 0,
    labor: 0,
    machine: 0,
  };

  return {
    active,
    activeTab,
    fullScreen,
    isOverdue: operation.jobDueDate
      ? new Date(operation.jobDueDate) < new Date()
      : false,
    progress,
    downloadDocument,
    getDocumentPath,
    setActiveTab,
    setFullScreen,
  };
}

function TableSkeleton() {
  return (
    <Table>
      <thead>
        <Tr>
          <Th>
            <Skeleton className="h-4 w-full" />
          </Th>
          <Th>
            <Skeleton className="h-4 w-full" />
          </Th>
        </Tr>
      </thead>
      <tbody>
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
      </tbody>
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
      <TooltipTrigger asChild>
        <button {...props}>{children}</button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
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
      className="w-12 h-12 flex flex-row items-center gap-2 justify-center bg-accent rounded-full shadow-lg hover:cursor-pointer hover:shadow-xl hover:accent hover:scale-105 transition-all disabled:cursor-not-allowed disabled:opacity-50"
    >
      {icon}
    </ButtonWithTooltip>
  );
}

function WorkTypeToggle() {
  return (
    <ToggleGroup defaultValue="labor" type="single">
      <ToggleGroupItem
        className="w-[110px]"
        value="setup"
        aria-label="Toggle setup"
      >
        <LuTimer className="h-4 w-4 mr-2" />
        Setup
      </ToggleGroupItem>
      <ToggleGroupItem
        className="w-[110px]"
        value="labor"
        aria-label="Toggle labor"
      >
        <LuHardHat className="h-4 w-4 mr-2" />
        Labor
      </ToggleGroupItem>
      <ToggleGroupItem
        className="w-[110px]"
        value="machine"
        aria-label="Toggle machine"
      >
        <LuHammer className="h-4 w-4 mr-2" />
        Machine
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

function PauseButton({ className, ...props }: ComponentProps<"button">) {
  return (
    <ButtonWithTooltip
      {...props}
      tooltip="Pause"
      className="group w-16 h-16 flex flex-row items-center gap-2 justify-center bg-red-500 rounded-full shadow-lg hover:cursor-pointer hover:drop-shadow-xl hover:bg-red-600 hover:scale-105 transition-all"
    >
      <FaPause className="text-accent group-hover:scale-125" />
    </ButtonWithTooltip>
  );
}

function PlayButton({
  className,
  onStart,
  ...props
}: ComponentProps<"button"> & { onStart: (type: "setup" | "run") => void }) {
  return (
    <button
      {...props}
      className="group w-16 h-16 flex flex-row items-center gap-2 justify-center bg-emerald-500 rounded-full shadow-lg hover:cursor-pointer hover:drop-shadow-xl hover:bg-emerald-600 hover:scale-105 transition-all"
    >
      <FaPlay className="text-accent group-hover:scale-125" />
    </button>
  );
}

function ScrapModal({ operation }: { operation: Operation }) {
  <Modal open={false}>
    <ModalContent>
      <ModalHeader>
        <ModalTitle>{`Scrap ${operation.itemReadableId}`}</ModalTitle>
        <ModalDescription>Select a scrap quantity and reason</ModalDescription>
      </ModalHeader>
      <ModalBody>
        <div className="grid grid-cols-2 gap-4">
          <NumberField
            defaultValue={1}
            // value={1}
            // onChange={onPurchaseUnitChange}
            minValue={1}
            maxValue={operation.operationQuantity}
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
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={() => {}}>
          Cancel
        </Button>
        <Button variant="destructive" onClick={() => {}}>
          Scrap
        </Button>
      </ModalFooter>
    </ModalContent>
  </Modal>;
}
