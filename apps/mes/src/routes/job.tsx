import {
  Button,
  Heading,
  IconButton,
  Modal,
  ModalContent,
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
} from "@carbon/react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useRef, useState, type ComponentProps, type ReactNode } from "react";
import {
  FaCheck,
  FaOilCan,
  FaPause,
  FaPlay,
  FaRedoAlt,
  FaTrash,
  FaTruckLoading,
} from "react-icons/fa";
import { LuChevronLeft, LuExpand } from "react-icons/lu";
import { useNavigate, useParams } from "react-router-dom";
import { path } from "~/config";
import { useRouteData } from "~/hooks/useRouteData";
import type { Job as JobType } from "~/types";
import { defaultJobLayout } from "./jobs";

export async function loader({ request }: LoaderFunctionArgs) {
  return null;
}

export function Job() {
  const navigate = useNavigate();
  const { operationId } = useParams();
  const routeData = useRouteData<{ jobs: JobType[] }>(path.to.jobs);
  const job = routeData?.jobs.find((job) => job.id === operationId);

  const [fullScreen, setFullScreen] = useState(false);

  if (!job) {
    return null;
  }

  return (
    <OptionallyFullscreen
      isFullScreen={fullScreen}
      onClose={() => setFullScreen(false)}
    >
      <Tabs defaultValue="details">
        <div className="flex items-center justify-between px-4 py-2 h-[52px] bg-background">
          <div className="flex items-start flex-grow gap-1">
            {!fullScreen && (
              <IconButton
                aria-label="Back"
                icon={<LuChevronLeft />}
                variant="ghost"
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
              <TabsTrigger disabled value="instructions">
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
        <TabsContent value="instructions"></TabsContent>
        <TabsContent value="notes"></TabsContent>

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
          <ModalContent className="min-w-full h-screen">
            {children}
          </ModalContent>
        </Modal>
      )}
    </>
  );
}

function Controls({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider>
      <div className="flex items-center gap-4 absolute p-4 bottom-4 left-1/2 transform -translate-x-1/2">
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
