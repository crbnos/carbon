import type { FactoryObject, RiskLevel } from "@carbon/utils";
import type { HTMLAttributes, ReactNode } from "react";
import { useId } from "react";

import { Heading } from "./Heading";
import { RiskIndicator } from "./RiskIndicator";
import { StatusBadge } from "./StatusBadge";
import { cn } from "./utils/cn";

export interface ObjectHeaderMetadata {
  label: string;
  value: ReactNode;
}

export interface ObjectHeaderProps
  extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  object: FactoryObject;
  metadata?: ObjectHeaderMetadata[];
  actions?: ReactNode;
  risk?: RiskLevel;
}

export function ObjectHeader({
  object,
  metadata = [],
  actions,
  risk,
  className,
  ...props
}: ObjectHeaderProps) {
  const headingId = useId();
  const displayName = object.displayName ?? object.id;

  return (
    <header
      className={cn(
        "flex w-full flex-col gap-4 rounded-lg bg-card p-4 text-card-foreground shadow-button-base md:p-6",
        className
      )}
      role="region"
      aria-labelledby={headingId}
      {...props}
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
            <span className="font-medium uppercase tracking-wider">
              {object.type}
            </span>
            <span aria-hidden="true">·</span>
            <span className="min-w-0 break-all font-mono tabular-nums">
              {object.id}
            </span>
          </div>
          <Heading id={headingId} as="h1" size="h2" className="break-words">
            {displayName}
          </Heading>
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge state={object.status ?? "unknown"} />
        {risk || object.risk ? (
          <RiskIndicator level={risk ?? object.risk} />
        ) : null}
      </div>

      {metadata.length > 0 || object.sourceRefs.length > 0 ? (
        <dl className="grid grid-cols-1 gap-x-8 gap-y-3 border-border border-t pt-4 sm:grid-cols-2 lg:grid-cols-4">
          {metadata.map((item) => (
            <div key={item.label} className="min-w-0">
              <dt className="text-muted-foreground text-xs">{item.label}</dt>
              <dd className="mt-1 break-words font-medium text-sm">
                {item.value}
              </dd>
            </div>
          ))}
          <div className="min-w-0">
            <dt className="text-muted-foreground text-xs">Source references</dt>
            <dd className="mt-1 break-words font-medium text-sm">
              {object.sourceRefs
                .map(
                  (source) =>
                    `${source.system}${source.recordId ? ` · ${source.recordId}` : ""}`
                )
                .join("; ")}
            </dd>
          </div>
        </dl>
      ) : null}
    </header>
  );
}
