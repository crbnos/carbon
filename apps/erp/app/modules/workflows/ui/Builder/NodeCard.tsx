import { Badge, cn } from "@carbon/react";
import { Handle, Position } from "@xyflow/react";
import type { ReactNode } from "react";

export type NodePort = { id: string; label: string };

type NodeCardProps = {
  kind: string;
  title: string;
  description?: string;
  accent: string;
  icon: ReactNode;
  ports: NodePort[];
  hasTarget?: boolean;
  issueCount?: number;
  isSelected?: boolean;
  isCollapsed?: boolean;
  summary?: string;
  children?: ReactNode;
};

export function NodeCard({
  kind,
  title,
  description,
  accent,
  icon,
  ports,
  hasTarget = true,
  issueCount = 0,
  isSelected = false,
  isCollapsed = false,
  summary,
  children
}: NodeCardProps) {
  const hasIssues = issueCount > 0;

  return (
    <div
      className={cn(
        "w-[260px] rounded-lg border bg-card shadow-sm transition-shadow",
        isSelected && "border-foreground ring-2 ring-foreground/15",
        hasIssues && "border-destructive ring-2 ring-destructive/20"
      )}
    >
      {hasTarget && <Handle type="target" position={Position.Top} id="in" />}

      <div className="flex items-start gap-2 p-2.5">
        <div
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-white"
          style={{ backgroundColor: accent }}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
            {kind}
          </div>
          <div className="truncate text-xs font-semibold text-pretty">
            {title}
          </div>
          {isCollapsed
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
      </div>

      {!isCollapsed && children && (
        <div className="border-t px-2.5 py-2">{children}</div>
      )}

      <div
        className={cn(
          "relative flex gap-1.5 px-2.5",
          isCollapsed ? "pb-0.5 pt-0" : "border-t pb-2 pt-1.5"
        )}
      >
        {ports.map((port) => (
          <div key={port.id} className="relative">
            {!isCollapsed && (
              <span className="rounded-full border bg-muted px-1.5 py-px text-[9.5px] text-muted-foreground">
                {port.label}
              </span>
            )}
            <Handle
              type="source"
              position={Position.Bottom}
              id={port.id}
              style={{ left: "50%", bottom: -6 }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
