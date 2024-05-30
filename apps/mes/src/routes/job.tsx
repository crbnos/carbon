import type { JSONContent } from "@carbon/react";
import {
  Avatar,
  Button,
  Editor,
  HStack,
  Heading,
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
  ResizableHandle,
  ResizablePanel,
  ScrollArea,
  Separator,
  Table,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tbody,
  Td,
  Th,
  Thead,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  Tr,
  cn,
  useMount,
} from "@carbon/react";
import {
  convertDateStringToIsoString,
  formatDurationMilliseconds,
  formatRelativeTime,
} from "@carbon/utils";
import type { ComponentProps, ReactNode } from "react";
import { useRef, useState } from "react";
import {
  FaCheck,
  FaOilCan,
  FaPaperPlane,
  FaPause,
  FaPlay,
  FaRedoAlt,
  FaTasks,
  FaTrash,
} from "react-icons/fa";
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
import {
  useLoaderData,
  useNavigate,
  useOutletContext,
  useParams,
} from "react-router-dom";
import {
  getDeadlineIcon,
  getDeadlineText,
  getStatusIcon,
  getStatusText,
} from "~/components/Jobs/JobCard";
import { path } from "~/config";
import { useRouteData } from "~/hooks/useRouteData";
import { notes, workInstructions } from "~/lib/data";
import type { Job as JobType, OutletContext } from "~/types";
import { defaultJobLayout } from "./jobs";

export async function loader() {
  return {
    notes,
    workInstructions,
  };
}

export function Job() {
  const navigate = useNavigate();
  const { operationId } = useParams();

  const { notes, workInstructions } = useLoaderData() as Awaited<
    ReturnType<typeof loader>
  >;

  const routeData = useRouteData<{ jobs: JobType[] }>(path.to.jobs);
  const job = routeData?.jobs.find((job) => job.id === operationId);

  const [fullScreen, setFullScreen] = useState(false);
  const [activeTab, setActiveTab] = useState("details");

  const isOverdue =
    job?.deadlineType !== "NO_DEADLINE" && job?.dueDate
      ? new Date(job?.dueDate) < new Date()
      : false;

  const onWorkInstructionChange = (value: JSONContent) => {
    console.log(value);
  };

  if (!job) {
    return null;
  }

  return (
    <>
      <OptionallyFullscreen
        isFullScreen={fullScreen}
        onClose={() => setFullScreen(false)}
      >
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="w-full h-full bg-card"
        >
          <div className="flex items-center justify-between px-4 py-2 h-[52px] bg-background">
            <div className="flex items-start flex-grow gap-1">
              {!fullScreen && (
                <IconButton
                  aria-label="Back"
                  icon={<LuChevronLeft />}
                  variant="secondary"
                  onClick={() => navigate(path.to.jobs)}
                />
              )}
              <Heading size="h2">{job.readableId}</Heading>
            </div>
            <div className="flex flex-shrink-0 items-center justify-end gap-2">
              <TabsList className="ml-auto">
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger disabled value="model">
                  Model
                </TabsTrigger>
                <TabsTrigger disabled={!workInstructions} value="instructions">
                  Instructions
                </TabsTrigger>
                <TabsTrigger value="notes">Notes</TabsTrigger>
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
                {job.description && (
                  <HStack className="justify-start space-x-2">
                    <LuClipboardCheck className="text-muted-foreground" />
                    <span className="text-sm truncate">{job.description}</span>
                  </HStack>
                )}
                {job.status && (
                  <HStack className="justify-start space-x-2">
                    {getStatusIcon(job.status)}
                    <span className="text-sm truncate">
                      {getStatusText(job.status)}
                    </span>
                  </HStack>
                )}
                {job.duration && (
                  <HStack className="justify-start space-x-2">
                    <LuTimer className="text-muted-foreground" />
                    <span className="text-sm truncate">
                      {formatDurationMilliseconds(job.duration)}
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
                  <Heading size="h2">{job.part}</Heading>
                  <p className="text-muted-foreground line-clamp-1">
                    3/8" x 2" x 1/4" Bracket
                  </p>
                </div>
                <div className="flex flex-col flex-shrink items-end">
                  <Heading size="h2">15</Heading>
                  <p className="text-muted-foreground line-clamp-1">Pieces</p>
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
                      <Heading size="h2">0</Heading>
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
                      <Heading size="h2">0</Heading>
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
                      <Heading size="h2">0</Heading>
                    </div>
                  </div>
                </div>
              </div>
              <Separator />
              <div className="flex items-start p-4">
                <div className="flex flex-col w-full space-y-2">
                  <HStack>
                    <LuTimer className="h-4 w-4 mr-1" />
                    <Progress
                      leftLabel={formatDurationMilliseconds(6.5 * 60 * 1000)}
                      rightLabel={formatDurationMilliseconds(5 * 60 * 1000)}
                      value={120}
                    />
                  </HStack>
                  <HStack>
                    <LuHardHat className="h-4 w-4 mr-1" />
                    <Progress
                      leftLabel={
                        job.progress
                          ? formatDurationMilliseconds(job.progress)
                          : ""
                      }
                      rightLabel={
                        job.duration
                          ? formatDurationMilliseconds(job.duration)
                          : ""
                      }
                      value={
                        job.progress && job.duration
                          ? (job.progress / job.duration) * 100
                          : 0
                      }
                    />
                  </HStack>
                  <HStack>
                    <LuHammer className="h-4 w-4 mr-1" />
                    <Progress
                      leftLabel={
                        job.progress
                          ? formatDurationMilliseconds(job.progress)
                          : ""
                      }
                      rightLabel={
                        job.duration
                          ? formatDurationMilliseconds(job.duration)
                          : ""
                      }
                      value={
                        job.progress && job.duration
                          ? (job.progress / job.duration) * 100
                          : 0
                      }
                    />
                  </HStack>
                  <HStack>
                    <FaTasks className="h-4 w-4 mr-1" />
                    <Progress
                      indicatorClassName={
                        job.status === "PAUSED" ? "bg-yellow-500" : ""
                      }
                      leftLabel={"0/15"}
                      rightLabel={"0%"}
                      value={0}
                    />
                  </HStack>
                </div>
              </div>
              <Separator />
              {job.customerId && (
                <>
                  <div className="flex items-start justify-between p-4">
                    <div className="flex flex-col flex-grow">
                      <Heading size="h3">Tesla</Heading>
                      <p className="text-muted-foreground line-clamp-1">
                        SO129034
                      </p>
                    </div>
                    <div className="flex flex-col flex-shrink items-end">
                      {job.deadlineType && (
                        <HStack className="justify-start space-x-2">
                          {getDeadlineIcon(job.deadlineType, isOverdue)}
                          <Tooltip>
                            <TooltipTrigger>
                              <span
                                className={cn(
                                  "text-sm truncate",
                                  isOverdue ? "text-red-500" : ""
                                )}
                              >
                                {["ASAP", "NO_DEADLINE"].includes(
                                  job.deadlineType
                                )
                                  ? getDeadlineText(job.deadlineType)
                                  : job.dueDate
                                  ? `Due ${formatRelativeTime(
                                      convertDateStringToIsoString(job.dueDate)
                                    )}`
                                  : "–"}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">
                              {getDeadlineText(job.deadlineType)}
                            </TooltipContent>
                          </Tooltip>
                        </HStack>
                      )}
                    </div>
                  </div>
                  <Separator />
                </>
              )}
              <div className="flex flex-col items-start justify-between">
                <div className="p-4">
                  <Heading size="h3">Files</Heading>
                </div>
                <Table>
                  <Thead>
                    <Tr>
                      <Th>Name</Th>
                      <Th>Size</Th>

                      <Th></Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    <Tr>
                      <Td
                        colSpan={24}
                        className="py-8 text-muted-foreground text-center"
                      >
                        No files
                      </Td>
                    </Tr>
                  </Tbody>
                </Table>
              </div>
            </ScrollArea>
          </TabsContent>
          <TabsContent value="model"></TabsContent>
          <TabsContent value="instructions" className="flex flex-grow bg-card">
            <ScrollArea className="h-[calc(100vh-104px)] pb-36">
              <Editor
                initialValue={workInstructions as JSONContent}
                onChange={onWorkInstructionChange}
              />
            </ScrollArea>
          </TabsContent>
          <TabsContent value="notes">
            <Notes job={job} notes={notes} />
          </TabsContent>

          {activeTab !== "notes" && (
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
    </>
  );
}

function OptionallyFullscreen({
  children,
  isFullScreen,
  onClose,
}: {
  children: ReactNode;
  isFullScreen: boolean;
  onClose: () => void;
}) {
  return (
    <>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={defaultJobLayout[2]} className="relative">
        {children}
      </ResizablePanel>
      {isFullScreen && (
        <Modal
          open={isFullScreen}
          onOpenChange={(open) => {
            if (!open) onClose();
          }}
        >
          <ModalContent className="min-w-full h-screen py-2">
            {children}
          </ModalContent>
        </Modal>
      )}
    </>
  );
}

type Note = {
  id: string;
  content: string;
  createdAt: string;
  createdBy: string;
  createdByName: string;
  createdByAvatar?: string;
};

function Notes({ notes }: { job: JobType; notes: Note[] }) {
  const listRef = useRef<HTMLDivElement>(null);
  const scrollToLastMessage = () => {
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth",
    });
  };
  useMount(() => {
    scrollToLastMessage();
  });
  const { user } = useOutletContext<OutletContext>();

  return (
    <div className="flex flex-col flex-auto h-[calc(100vh-108px)] p-6">
      <div className="flex flex-col flex-auto flex-shrink-0 rounded-2xl bg-muted h-full p-4">
        <div
          ref={listRef}
          className="flex flex-col h-full overflow-x-auto mb-4"
        >
          <div className="flex flex-col h-full">
            <div className="grid grid-cols-12 gap-y-2">
              {notes.map((note) => (
                <Message
                  key={note.id}
                  note={note}
                  isFromViewer={note.createdBy === user?.id}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-row items-center h-16 rounded-xl bg-background w-full px-2 space-x-2">
          {/* <div>
              <button className="flex items-center justify-center text-gray-400 hover:text-gray-600">
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                  ></path>
                </svg>
              </button>
            </div> */}
          <div className="flex-grow relative">
            <input
              type="text"
              className="flex w-full border rounded-xl focus:outline-none focus:border-ring pl-4 h-11"
            />
            {/* <button className="absolute flex items-center justify-center h-full w-12 right-0 top-0 text-gray-400 hover:text-gray-600">
                  <svg
                    className="w-6 h-6"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    ></path>
                  </svg>
                </button> */}
          </div>

          <Button className="rounded-xl" size="lg" rightIcon={<FaPaperPlane />}>
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}

type MessageProps = {
  note: Note;
  isFromViewer: boolean;
};

function Message({ note, isFromViewer }: MessageProps) {
  const { content, createdByAvatar, createdByName } = note;
  return (
    <div
      className={cn(
        "p-3 rounded-lg",
        isFromViewer ? "col-start-6 col-end-13" : "col-start-1 col-end-8"
      )}
    >
      <div
        className={cn(
          "flex items-center justify-start",
          isFromViewer && "flex-row-reverse"
        )}
      >
        <Avatar
          className="flex flex-shrink-0"
          size="md"
          name={createdByName}
          src={createdByAvatar}
        />
        <div
          className={cn(
            "relative text-sm py-2 px-4 shadow rounded-xl",
            isFromViewer ? "mr-3 bg-indigo-100" : "ml-3 bg-background"
          )}
        >
          <div>{content}</div>
        </div>
      </div>
    </div>
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
          "absolute p-4 bottom-0 left-1/2 transform -translate-x-1/2",
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

function ScrapModal({ job }: { job: JobType }) {
  <Modal open={false}>
    <ModalContent>
      <ModalHeader>
        <ModalTitle>{`Scrap ${job.part}`}</ModalTitle>
        <ModalDescription>Select a scrap quantity and reason</ModalDescription>
      </ModalHeader>
      <ModalBody>
        <div className="grid grid-cols-2 gap-4">
          <NumberField
            defaultValue={1}
            // value={1}
            // onChange={onPurchaseUnitChange}
            minValue={1}
            maxValue={job.quantity}
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
