import { Badge, cn } from "@carbon/react";
import { Handle, Position } from "@xyflow/react";
import type { ReactNode } from "react";

export type NodePort = { id: string; label: string };

const HANDLE_CLASS =
  "!size-3 !border-2 !border-card !bg-primary transition-transform " +
  "hover:!scale-[1.35] hover:!shadow-[0_0_0_4px_hsl(var(--primary)/0.18)]";

type NodeCardProps = {
  title: ReactNode;
  description?: string;
  icon: ReactNode;
  ports: NodePort[];
  hasTarget?: boolean;
  issueCount?: number;
  isSelected?: boolean;
  isExpanded?: boolean;
  summary?: string;
  actions?: ReactNode;
  children?: ReactNode;
};

export function NodeCard({
  title,
  description,
  icon,
  ports,
  hasTarget = true,
  issueCount = 0,
  isSelected = false,
  isExpanded = true,
  summary,
  actions,
  children
}: NodeCardProps) {
  const hasIssues = issueCount > 0;

  return (
    <div
      className={cn(
        "rounded-lg border bg-card shadow-sm transition-shadow",
        isExpanded ? "w-[440px]" : "w-[260px]",
        isSelected && "border-primary ring-2 ring-primary/20",
        hasIssues && "border-destructive ring-2 ring-destructive/20"
      )}
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
          className={HANDLE_CLASS}
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
        <div className="nodrag border-t px-2.5 py-2">{children}</div>
      )}

      {ports.length > 1 && (
        <div
          className={cn(
            "flex flex-col",
            isExpanded ? "border-t py-1.5" : "pb-1"
          )}
        >
          {ports.map((port) => (
            <div
              key={port.id}
              className="relative flex items-center justify-end px-2.5 py-1"
            >
              {isExpanded && (
                <span className="text-[9.5px] text-muted-foreground">
                  {port.label}
                </span>
              )}
              <Handle
                type="source"
                position={Position.Right}
                id={port.id}
                className={HANDLE_CLASS}
                style={{ top: "50%", right: -6 }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
