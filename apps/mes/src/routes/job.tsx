import type { JSONContent } from "@carbon/react";
import {
  Avatar,
  Button,
  Editor,
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
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
  ResizableHandle,
  ResizablePanel,
  Separator,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
  useMount,
} from "@carbon/react";
import type { ComponentProps, ReactNode } from "react";
import { useRef, useState } from "react";
import {
  FaCheck,
  FaOilCan,
  FaPaperPlane,
  FaPause,
  FaPlay,
  FaRedoAlt,
  FaTrash,
  FaTruckLoading,
} from "react-icons/fa";
import {
  LuChevronDown,
  LuChevronLeft,
  LuChevronUp,
  LuExpand,
} from "react-icons/lu";
import {
  useLoaderData,
  useNavigate,
  useOutletContext,
  useParams,
} from "react-router-dom";
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

          {!fullScreen && <Separator />}

          <TabsContent value="details"></TabsContent>
          <TabsContent value="model"></TabsContent>
          <TabsContent value="instructions" className="flex flex-grow bg-card">
            <Editor
              initialValue={workInstructions as JSONContent}
              onChange={onWorkInstructionChange}
            />
          </TabsContent>
          <TabsContent value="notes">
            <Notes job={job} notes={notes} />
          </TabsContent>

          <Controls>
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
          </Controls>
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
    <div className="flex flex-col flex-auto h-[calc(100vh-130px)] p-6">
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
                  isFromUser={note.createdBy === user?.id}
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

          <Button
            className="bg-indigo-600 hover:bg-indigo-500 rounded-2xl"
            size="lg"
            rightIcon={<FaPaperPlane />}
          >
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}

type MessageProps = {
  note: Note;
  isFromUser: boolean;
};

function Message({ note, isFromUser }: MessageProps) {
  const { content, createdByAvatar, createdByName } = note;
  return (
    <div
      className={cn(
        "p-3 rounded-lg",
        isFromUser ? "col-start-6 col-end-13" : "col-start-1 col-end-8"
      )}
    >
      <div
        className={cn(
          "flex items-center justify-start",
          isFromUser && "flex-row-reverse"
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
            isFromUser ? "mr-3 bg-indigo-100" : "ml-3 bg-background"
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
          "flex items-center gap-4 absolute p-4 bottom-0 left-1/2 transform -translate-x-1/2",
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
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          {...props}
          className="group w-16 h-16 flex flex-row items-center gap-2 justify-center bg-emerald-500 rounded-full shadow-lg hover:cursor-pointer hover:drop-shadow-xl hover:bg-emerald-600 hover:scale-105 transition-all"
        >
          <FaPlay className="text-accent group-hover:scale-125" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="flex space-x-4 w-full justify-center">
        <Button
          leftIcon={<FaTruckLoading />}
          size="lg"
          variant="secondary"
          onClick={() => {
            onStart("setup");
            closeButtonRef.current?.click();
          }}
        >
          Setup
        </Button>
        <Button
          leftIcon={<FaPlay />}
          size="lg"
          variant="primary"
          onClick={() => {
            onStart("run");
            closeButtonRef.current?.click();
          }}
        >
          Run
        </Button>
        <PopoverClose ref={closeButtonRef} className="sr-only" tabIndex={-1} />
      </PopoverContent>
    </Popover>
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
