import { Badge, cn } from "@carbon/react";
import { Handle, Position, useUpdateNodeInternals } from "@xyflow/react";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import type { BuilderPort } from "./ports";

export type PortTone = "default" | "success" | "failure";

const HANDLE_BASE =
  "!size-3.5 !min-w-0 !min-h-0 !rounded-full !border-2 !border-card !transition-shadow";

const HANDLE_TONE: Record<PortTone, string> = {
  default: "!bg-primary hover:!shadow-[0_0_0_5px_hsl(var(--primary)/0.22)]",
  success:
    "!bg-emerald-500 hover:!shadow-[0_0_0_5px_rgb(16_185_129/0.3)] dark:!bg-emerald-400",
  failure:
    "!bg-red-500 hover:!shadow-[0_0_0_5px_rgb(239_68_68/0.3)] dark:!bg-red-400"
};

export function handleClass(tone: PortTone = "default"): string {
  return `${HANDLE_BASE} ${HANDLE_TONE[tone]}`;
}

export const HANDLE_CLASS = handleClass();

// Type scale for the config form, so no form restates its own sizes. Controls are all
// `text-sm`: the variable editor cannot shrink below its chip's line box.
const BODY_TYPE = [
  "text-xs",
  "[&_label]:text-[11px]",
  "[&_input]:text-sm",
  "[&_textarea]:text-sm",
  "[&_button]:text-sm",
  "[&_[role=combobox]]:text-sm"
].join(" ");

const INTERACTIVE =
  "input,textarea,select,button,a,[role=button],[role=combobox],[contenteditable=true]";

// Body drags, controls don't. Toggles `nodrag` in the capture phase, which beats
// React Flow's listener; stopPropagation here would wedge every Radix dropdown open.
function useBodyDragFilter() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      el.classList.toggle("nodrag", !!target?.closest(INTERACTIVE));
    };
    el.addEventListener("pointerdown", onPointerDown, true);
    return () => el.removeEventListener("pointerdown", onPointerDown, true);
  }, []);
  return ref;
}

type NodeCardProps = {
  nodeId: string;
  title: ReactNode;
  description?: string;
  icon: ReactNode;
  ports: BuilderPort[];
  hasTarget?: boolean;
  issueCount?: number;
  isSelected?: boolean;
  isExpanded?: boolean;
  width?: number;
  summary?: string;
  actions?: ReactNode;
  children?: ReactNode;
};

export function NodeCard({
  nodeId,
  title,
  description,
  icon,
  ports,
  hasTarget = true,
  issueCount = 0,
  isSelected = false,
  isExpanded = true,
  width = 440,
  summary,
  actions,
  children
}: NodeCardProps) {
  const hasIssues = issueCount > 0;
  const bodyRef = useBodyDragFilter();

  // An `inline` port is drawn by the form, so the card only owns it when the form
  // isn't showing — otherwise both would render the same handle id.
  const formVisible = isExpanded && !!children;
  const cardPorts = ports.filter(
    (port) => port.anchor === "card" || !formVisible
  );

  const updateNodeInternals = useUpdateNodeInternals();
  const portKey = cardPorts.map((p) => p.id).join("|");

  // React Flow caches handle bounds; expanding, collapsing, or adding a path
  // moves them, so it must be told to re-measure.
  useEffect(() => {
    updateNodeInternals(nodeId);
  }, [nodeId, portKey, isExpanded, updateNodeInternals]);

  return (
    <div
      className={cn(
        "relative rounded-lg border bg-card shadow-sm transition-shadow",
        isSelected && "border-primary ring-2 ring-primary/20",
        hasIssues && "border-destructive ring-2 ring-destructive/20"
      )}
      style={{ width: isExpanded ? width : 260 }}
    >
      {hasTarget && (
        <Handle
          type="target"
          position={Position.Left}
          id="in"
          className={HANDLE_CLASS}
        />
      )}

      {cardPorts.length === 1 && (
        <Handle
          type="source"
          position={Position.Right}
          id={cardPorts[0].id}
          title={cardPorts[0].label}
          aria-label={cardPorts[0].label}
          className={handleClass(cardPorts[0].tone)}
        />
      )}

      <div className="flex items-start gap-2 p-2.5">
        <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          {title}
          {!isExpanded
            ? summary && (
                <div className="truncate text-[10.5px] text-muted-foreground">
                  {summary}
                </div>
              )
            : description && (
                <div className="text-[10.5px] leading-snug text-muted-foreground">
                  {description}
                </div>
              )}
          {hasIssues && (
            <Badge variant="destructive" className="mt-1">
              {issueCount === 1 ? "1 problem" : `${issueCount} problems`}
            </Badge>
          )}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>

      {/* `overflow-hidden`: the card has a fixed width, so anything that cannot shrink
          must be clipped rather than drawn over the canvas. */}
      {isExpanded && children && (
        <div
          ref={bodyRef}
          className={cn("overflow-hidden border-t px-2.5 py-2", BODY_TYPE)}
        >
          {children}
        </div>
      )}

      {cardPorts.length > 1 && (
        // Handles straddle the card's midline instead of trailing the body, so a
        // tall form never pushes them to the bottom.
        <div className="pointer-events-none absolute inset-y-0 right-0 flex flex-col justify-center gap-6">
          {cardPorts.map((port) => (
            // Zero-width row: the Handle's own `right: -4px` lands it on the border.
            <div key={port.id} className="pointer-events-auto relative">
              <Handle
                type="source"
                position={Position.Right}
                id={port.id}
                title={port.label}
                aria-label={port.label}
                className={handleClass(port.tone)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
