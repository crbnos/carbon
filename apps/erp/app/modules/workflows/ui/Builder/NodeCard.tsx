import { Badge, cn } from "@carbon/react";
import { Handle, Position, useUpdateNodeInternals } from "@xyflow/react";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

export type PortTone = "default" | "success" | "failure";

export type NodePort = { id: string; label: string; tone?: PortTone };

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

const PORT_LABEL_TONE: Record<PortTone, string> = {
  default: "text-muted-foreground",
  success: "text-emerald-600 dark:text-emerald-400",
  failure: "text-red-600 dark:text-red-400"
};

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
  ports: NodePort[];
  hasTarget?: boolean;
  issueCount?: number;
  isSelected?: boolean;
  isExpanded?: boolean;
  width?: number;
  hidePortStrip?: boolean;
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
  hidePortStrip = false,
  summary,
  actions,
  children
}: NodeCardProps) {
  const hasIssues = issueCount > 0;
  const bodyRef = useBodyDragFilter();

  const updateNodeInternals = useUpdateNodeInternals();
  const portKey = ports.map((p) => p.id).join("|");

  // React Flow caches handle bounds; expanding, collapsing, or adding a path
  // moves them, so it must be told to re-measure.
  useEffect(() => {
    updateNodeInternals(nodeId);
  }, [nodeId, portKey, isExpanded, updateNodeInternals]);

  return (
    <div
      className={cn(
        "rounded-lg border bg-card shadow-sm transition-shadow",
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

      {ports.length === 1 && (
        <Handle
          type="source"
          position={Position.Right}
          id={ports[0].id}
          className={handleClass(ports[0].tone)}
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

      {isExpanded && children && (
        <div ref={bodyRef} className="border-t px-2.5 py-2">
          {children}
        </div>
      )}

      {ports.length > 1 && !hidePortStrip && (
        <div className={cn("flex flex-col", isExpanded && "border-t")}>
          {ports.map((port) => (
            // `relative` anchors the handle to this row's right edge, so the row
            // must stay tall enough that stacked handles never touch.
            <div
              key={port.id}
              className="relative flex h-9 items-center justify-end px-3"
            >
              {isExpanded && (
                <span
                  className={cn(
                    "text-[10px] font-medium uppercase tracking-wide",
                    PORT_LABEL_TONE[port.tone ?? "default"]
                  )}
                >
                  {port.label}
                </span>
              )}
              <Handle
                type="source"
                position={Position.Right}
                id={port.id}
                className={handleClass(port.tone)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
