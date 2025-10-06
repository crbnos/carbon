import {
  cn,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import type { ComponentProps, ReactNode } from "react";
import { useMemo } from "react";
import type { productionEventType } from "~/services/models";
import { productionEventValidator } from "~/services/models";
import type {
  Job,
  OperationWithDetails,
  ProductionEvent,
} from "~/services/types";
import { path } from "~/utils/path";

import { Hidden, ValidatedForm } from "@carbon/form";
import { getLocalTimeZone } from "@internationalized/date";
import { FaPause, FaPlay } from "react-icons/fa6";
import { LuHammer, LuHardHat, LuTimer } from "react-icons/lu";

export function Controls({
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

export function Times({
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

export function ButtonWithTooltip({
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

export function IconButtonWithTooltip({
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

export function WorkTypeToggle({
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
export function StartStopButton({
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

export function PauseButton({ className, ...props }: ComponentProps<"button">) {
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

export function PlayButton({ className, ...props }: ComponentProps<"button">) {
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
