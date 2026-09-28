import { Hidden, ValidatedForm } from "@carbon/form";
import {
  cn,
  hasOpenDialog,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  useShortcutKeys
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { AnimatePresence, motion } from "framer-motion";
import type { ComponentProps, ReactNode } from "react";
import { forwardRef, useCallback, useMemo, useRef, useState } from "react";
import { FaPause, FaPlay } from "react-icons/fa6";
import {
  LuEllipsisVertical,
  LuHammer,
  LuHardHat,
  LuPanelRightClose,
  LuPanelRightOpen,
  LuTimer,
  LuX
} from "react-icons/lu";
import { useFetcher } from "react-router";
import type { productionEventType } from "~/services/models";
import { productionEventValidator } from "~/services/models";
import type {
  Job,
  OperationWithDetails,
  ProductionEvent
} from "~/services/types";
import { START_STOP_SHORTCUT } from "~/shortcuts";
import { path } from "~/utils/path";

// The operation's action panel. One mounted instance, laid out by CSS: a
// full-height dock column from lg (collapsible to an icon rail), a pinned
// bottom action bar below it — never rendered twice, since it owns the
// start/stop form and the modal triggers.
export function Controls({
  children,
  className,
  collapsed = false,
  onCollapsedChange
}: {
  children: ReactNode;
  className?: string;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}) {
  const { t } = useLingui();
  return (
    <aside
      data-collapsed={collapsed}
      className={cn(
        "group/dock flex min-h-0 min-w-0 items-center gap-2 border-t bg-background/95 px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur supports-[backdrop-filter]:bg-background/60",
        "lg:w-[var(--controls-width)] lg:flex-col lg:items-stretch lg:overflow-y-auto lg:overflow-x-hidden lg:border-t-0 lg:border-l lg:p-2 lg:transition-[width] lg:duration-200 lg:data-[collapsed=true]:w-[76px]",
        className
      )}
    >
      {children}
      {onCollapsedChange && (
        <button
          type="button"
          onClick={() => onCollapsedChange(!collapsed)}
          aria-label={collapsed ? t`Expand panel` : t`Collapse panel`}
          aria-expanded={!collapsed}
          className="mt-auto hidden h-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:flex"
        >
          {collapsed ? (
            <LuPanelRightOpen className="size-4" />
          ) : (
            <LuPanelRightClose className="size-4" />
          )}
        </button>
      )}
    </aside>
  );
}

export function Times({
  children,
  className
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <TooltipProvider>
      <div
        className={cn(
          "min-w-0 border-t bg-background/95 px-4 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-background/60 lg:px-6",
          className
        )}
      >
        {children}
      </div>
    </TooltipProvider>
  );
}

export const ButtonWithTooltip = forwardRef<
  HTMLButtonElement,
  ComponentProps<"button"> & { tooltip: string }
>(({ tooltip, children, ...props }, ref) => {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button ref={ref} {...props}>
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{tooltip}</TooltipContent>
    </Tooltip>
  );
});
ButtonWithTooltip.displayName = "ButtonWithTooltip";

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
        "size-12 shrink-0 text-lg lg:size-[8dvh] lg:group-data-[collapsed=true]/dock:size-12 flex flex-row items-center gap-2 justify-center bg-accent rounded-full shadow-lg hover:cursor-pointer hover:shadow-xl hover:accent hover:scale-105 transition-all disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-30 text-accent-foreground group-hover:text-accent-foreground/80",
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
  className
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
    operation.setupDuration
  ]);

  return (
    <ToggleGroup
      value={value}
      type="single"
      onValueChange={onChange}
      disabled={!!value && count <= 1}
      className={cn(
        "grid w-full lg:group-data-[collapsed=true]/dock:grid-cols-1",
        count <= 1 && "grid-cols-1",
        count === 2 && "grid-cols-2 lg:py-2",
        count === 3 && "grid-cols-3 lg:py-2",
        className
      )}
    >
      {operation.setupDuration > 0 && (
        <ToggleGroupItem
          className="flex flex-col items-center relative justify-center text-center h-12 lg:h-14 w-full"
          value="Setup"
          size="lg"
          aria-label="Toggle setup"
        >
          <LuTimer className="size-6 pt-1" />
          <span className="text-xxs lg:group-data-[collapsed=true]/dock:sr-only">
            <Trans>Setup</Trans>
          </span>
          {active.setup && (
            <span className="absolute -top-1 -right-1 h-3 w-3 bg-emerald-500 rounded-full" />
          )}
        </ToggleGroupItem>
      )}
      {operation.laborDuration > 0 && (
        <ToggleGroupItem
          className="flex flex-col items-center relative justify-center text-center h-12 lg:h-14 w-full"
          value="Labor"
          size="lg"
          aria-label="Toggle labor"
        >
          <LuHardHat className="size-6 pt-1" />
          <span className="text-xxs lg:group-data-[collapsed=true]/dock:sr-only">
            <Trans>Labor</Trans>
          </span>
          {active.labor && (
            <span className="absolute -top-1 -right-1 h-3 w-3 bg-emerald-500 rounded-full" />
          )}
        </ToggleGroupItem>
      )}
      {operation.machineDuration > 0 && (
        <ToggleGroupItem
          className="flex flex-col items-center relative justify-center text-center h-12 lg:h-14 w-full"
          value="Machine"
          size="lg"
          aria-label="Toggle machine"
        >
          <LuHammer className="size-6 pt-1" />
          <span className="text-xxs lg:group-data-[collapsed=true]/dock:sr-only">
            <Trans>Machine</Trans>
          </span>
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
  batchId,
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
  // When set, the start/stop event is tagged as part of this batch — sliced per
  // member at batch completion, and cost posting is deferred until then.
  batchId?: string;
}) {
  const fetcher = useFetcher<ProductionEvent>();

  // Space = Start/Pause, the most-pressed button in MES. Inert in inputs
  // (hook default) and under any open dialog. AssemblyView owns its own Space
  // handling on a separate route (assembly.$operationId) — the two never
  // co-mount. Ref-click so a disabled button stays a native no-op.
  const startStopRef = useRef<HTMLButtonElement>(null);
  useShortcutKeys({
    shortcut: START_STOP_SHORTCUT,
    action: (event) => {
      event.preventDefault();
      startStopRef.current?.click();
    },
    guard: () => !hasOpenDialog(),
    disabled: fetcher.state !== "idle"
  });

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
    fetcher.formData
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
    machineProductionEvent
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
        action: isActive ? "End" : "Start",
        type: eventType,
        workCenterId: operation.workCenterId ?? undefined
      }}
      fetcher={fetcher}
    >
      <Hidden name="id" value={id} />
      {isTrackedActivity && (
        <Hidden name="trackedEntityId" value={trackedEntityId} />
      )}
      {batchId && <Hidden name="jobOperationBatchId" value={batchId} />}
      <Hidden name="jobOperationId" value={operation.id} />

      <Hidden name="action" value={isActive ? "End" : "Start"} />
      <Hidden name="type" value={eventType} />
      <Hidden name="workCenterId" value={operation.workCenterId ?? undefined} />
      {isActive ? (
        <PauseButton
          ref={startStopRef}
          disabled={fetcher.state !== "idle"}
          type="submit"
        />
      ) : (
        <PlayButton
          ref={startStopRef}
          disabled={fetcher.state !== "idle"}
          type="submit"
        />
      )}
    </ValidatedForm>
  );
}

export const PauseButton = forwardRef<
  HTMLButtonElement,
  ComponentProps<"button">
>(({ className, ...props }, ref) => {
  const { t } = useLingui();
  return (
    <ButtonWithTooltip
      ref={ref}
      {...props}
      tooltip={t`Pause`}
      className={cn(
        "group size-14 text-2xl lg:size-24 lg:text-4xl lg:tall:size-32 lg:group-data-[collapsed=true]/dock:!size-14 lg:group-data-[collapsed=true]/dock:!text-2xl shrink-0 flex flex-row items-center gap-2 justify-center bg-red-500 rounded-full shadow-lg hover:cursor-pointer hover:drop-shadow-xl hover:bg-red-600 hover:scale-105 transition-all text-accent disabled:bg-muted disabled:text-muted-foreground/80 border-b-4 border-red-700 active:border-b-0 active:translate-y-1 disabled:bg-gray-500 disabled:hover:bg-gray-600 disabled:border-gray-700 disabled:text-white",
        className
      )}
    >
      <FaPause className="group-hover:scale-110" />
    </ButtonWithTooltip>
  );
});
PauseButton.displayName = "PauseButton";

export const PlayButton = forwardRef<
  HTMLButtonElement,
  ComponentProps<"button">
>(({ className, ...props }, ref) => {
  const { t } = useLingui();
  return (
    <ButtonWithTooltip
      ref={ref}
      {...props}
      tooltip={t`Start`}
      className={cn(
        "group size-14 text-2xl lg:size-24 lg:text-4xl lg:tall:size-32 lg:group-data-[collapsed=true]/dock:!size-14 lg:group-data-[collapsed=true]/dock:!text-2xl shrink-0 flex flex-row items-center gap-2 justify-center bg-emerald-500 rounded-full shadow-lg hover:cursor-pointer hover:drop-shadow-xl hover:bg-emerald-600 hover:scale-105 transition-all text-accent disabled:bg-muted disabled:text-muted-foreground/80 border-b-4 border-emerald-700 active:border-b-0 active:translate-y-1 disabled:bg-gray-500 disabled:hover:bg-gray-600 disabled:border-gray-700 disabled:text-white",
        className
      )}
    >
      <FaPlay className="group-hover:scale-110" />
    </ButtonWithTooltip>
  );
});
PlayButton.displayName = "PlayButton";

export type FABItem = {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "success" | "destructive";
};

export function FloatingActionMenu({ items }: { items: FABItem[] }) {
  const [isOpen, setIsOpen] = useState(false);

  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);

  return (
    <div className="relative flex flex-col items-center">
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            className="flex flex-row lg:flex-col items-center gap-2 mb-2"
            initial="closed"
            animate="open"
            exit="closed"
            variants={{
              open: { transition: { staggerChildren: 0.06 } },
              closed: {
                transition: { staggerChildren: 0.03, staggerDirection: -1 }
              }
            }}
          >
            {items.map((item) => (
              <motion.div
                key={item.label}
                variants={{
                  open: { opacity: 1, scale: 1, filter: "blur(0px)" },
                  closed: { opacity: 0, scale: 0.25, filter: "blur(4px)" }
                }}
                transition={{ type: "spring", duration: 0.3, bounce: 0 }}
              >
                <IconButtonWithTooltip
                  icon={item.icon}
                  tooltip={item.label}
                  disabled={item.disabled}
                  variant={item.variant}
                  onClick={() => {
                    item.onClick();
                    setIsOpen(false);
                  }}
                />
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      <button
        type="button"
        onClick={toggle}
        className={cn(
          "size-16 text-xl lg:text-lg lg:size-[8dvh] flex items-center justify-center rounded-full shadow-lg transition-[transform,background-color] duration-200 active:scale-[0.96]",
          isOpen
            ? "bg-muted-foreground text-background"
            : "bg-accent text-accent-foreground hover:bg-accent/80"
        )}
      >
        <AnimatePresence mode="wait" initial={false}>
          {isOpen ? (
            <motion.span
              key="close"
              initial={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
              animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
              exit={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
              transition={{ type: "spring", duration: 0.3, bounce: 0 }}
              className="flex items-center justify-center"
            >
              <LuX className="size-5" />
            </motion.span>
          ) : (
            <motion.span
              key="menu"
              initial={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
              animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
              exit={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
              transition={{ type: "spring", duration: 0.3, bounce: 0 }}
              className="flex items-center justify-center"
            >
              <LuEllipsisVertical className="size-5" />
            </motion.span>
          )}
        </AnimatePresence>
      </button>
    </div>
  );
}
