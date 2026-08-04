import { cn } from "@carbon/react";
import { Handle, Position, useUpdateNodeInternals } from "@xyflow/react";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import { HANDLE_CLASS } from "./handles";
import { OutputHandle } from "./OutputHandle";
import type { BuilderPort } from "./ports";

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
  /** Already filtered by the caller — a card shows only the problems worth acting on. */
  issues?: string[];
  isSelected?: boolean;
  /** How this card relates to a connection currently being dragged. */
  connectionState?: "idle" | "source" | "compatible" | "incompatible";
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
  issues = [],
  isSelected = false,
  connectionState = "idle",
  isExpanded = true,
  width = 440,
  summary,
  actions,
  children
}: NodeCardProps) {
  // Two checks can word the same complaint; one line per distinct message.
  const messages = Array.from(new Set(issues));
  const hasIssues = messages.length > 0;
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

  // One width in both states: a card that narrowed on collapse would drag every
  // edge attached to it sideways, and the canvas would appear to reflow itself.
  return (
    <div
      className={cn(
        "relative rounded-lg border bg-card shadow-sm transition-[box-shadow,opacity]",
        isSelected && "border-primary ring-2 ring-primary/20",
        connectionState === "compatible" &&
          "border-primary ring-2 ring-primary/40",
        connectionState === "incompatible" && "opacity-40",
        // Last, so a broken step keeps the more urgent signal mid-drag. One border
        // and no ring — the footer already spells the problem out.
        hasIssues && "border-destructive"
      )}
      style={{ width }}
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
        // A lone handle needs no label — there is nothing to tell it apart from.
        <OutputHandle nodeId={nodeId} port={cardPorts[0]} showLabel={false} />
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
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>

      {/* Never clip: the condition form draws its own handles, and they straddle the
          card's right border. Every control inside is `min-w-0` instead. */}
      {isExpanded && children && (
        <div ref={bodyRef} className={cn("border-t px-2.5 py-2", BODY_TYPE)}>
          {children}
        </div>
      )}

      {/* Below the form, so the last thing read is what to fix. Shown collapsed
          too — a red border with no reason is worse than no border. */}
      {hasIssues && (
        <div className="rounded-b-lg border-t border-destructive/40 bg-destructive/5 px-2.5 py-1.5">
          {messages.map((message) => (
            <p
              key={message}
              className="flex items-start gap-1 text-[10.5px] leading-snug text-destructive"
            >
              <LuTriangleAlert className="mt-[1px] size-3 shrink-0" />
              <span>{message}</span>
            </p>
          ))}
        </div>
      )}

      {cardPorts.length > 1 && (
        // Handles straddle the card's midline instead of trailing the body, so a
        // tall form never pushes them to the bottom. Collapsed, the gap closes and
        // every handle stacks on the midline, reading as a single dot — that is
        // what lets a many-path card (condition) collapse at all.
        <div
          className={cn(
            "pointer-events-none absolute inset-y-0 right-0 flex flex-col justify-center",
            isExpanded ? "gap-12" : "gap-0"
          )}
        >
          {cardPorts.map((port, index) => (
            // Zero-width row: the Handle's own `right: -4px` lands it on the border.
            // Descending z-index so the stack collapses onto the FIRST port, not the
            // last — otherwise a collapsed action card hands its clicks to "Failure".
            <div
              key={port.id}
              className="pointer-events-auto relative"
              style={{ zIndex: cardPorts.length - index }}
            >
              {/* Stacked labels would smear into each other; `title`/`aria-label`
                  on the handle still name every port. */}
              <OutputHandle
                nodeId={nodeId}
                port={port}
                showLabel={isExpanded}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
