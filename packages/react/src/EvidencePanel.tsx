import {
  type EvidenceFreshness,
  type EvidenceRecord,
  enforceEvidenceFreshness
} from "@carbon/utils";
import type { HTMLAttributes } from "react";
import {
  LuCircleCheck,
  LuCircleHelp,
  LuClock,
  LuOctagonAlert
} from "react-icons/lu";

import type { BadgeProps } from "./Badge";
import { Badge } from "./Badge";
import { Card, CardContent, CardHeader, CardTitle } from "./Card";
import { cn } from "./utils/cn";

export type { EvidenceFreshness, EvidenceRecord } from "@carbon/utils";

export interface EvidencePanelProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  records: EvidenceRecord[];
  title?: string;
  emptyMessage?: string;
}

const freshnessConfig: Record<
  EvidenceFreshness,
  {
    label: string;
    variant: BadgeProps["variant"];
    icon: typeof LuClock;
  }
> = {
  fresh: { label: "Fresh", variant: "green", icon: LuCircleCheck },
  aging: { label: "Aging", variant: "yellow", icon: LuClock },
  stale: { label: "Stale", variant: "red", icon: LuOctagonAlert },
  unknown: {
    label: "Unknown freshness",
    variant: "gray",
    icon: LuCircleHelp
  }
};

function EvidenceFreshnessBadge({ record }: { record: EvidenceRecord }) {
  const freshness = enforceEvidenceFreshness(record).freshness;
  const config = freshnessConfig[freshness] ?? freshnessConfig.unknown;
  const Icon = config.icon;

  return (
    <Badge
      variant={config.variant}
      className="gap-1"
      role="status"
      aria-label={`Evidence freshness: ${config.label}`}
    >
      <Icon aria-hidden="true" className="size-3 shrink-0" />
      <span>{config.label}</span>
    </Badge>
  );
}

function renderFact(record: EvidenceRecord) {
  if (record.fact.description) return record.fact.description;
  if (record.fact.value === undefined) return "Not supplied";
  if (
    typeof record.fact.value === "string" ||
    typeof record.fact.value === "number" ||
    typeof record.fact.value === "boolean"
  ) {
    return `${record.fact.value}${record.fact.unit ? ` ${record.fact.unit}` : ""}`;
  }
  return "Structured value available";
}

export function EvidencePanel({
  records,
  title = "Supporting evidence",
  emptyMessage = "No evidence available.",
  className,
  ...props
}: EvidencePanelProps) {
  return (
    <Card
      className={cn("overflow-hidden", className)}
      role="region"
      aria-label={title}
      {...props}
    >
      <CardHeader className="border-border border-b">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="rounded-none border-0 p-0">
        {records.length === 0 ? (
          <p className="p-6 text-muted-foreground text-sm">{emptyMessage}</p>
        ) : (
          <ul className="w-full divide-y divide-border">
            {records.map((record) => (
              <li key={record.id} className="min-w-0 p-4 md:p-6">
                <article
                  className="flex flex-col gap-4"
                  aria-label={`Evidence from ${record.source.system}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <p className="min-w-0 break-words font-medium text-foreground text-sm text-pretty">
                      <span className="font-semibold">
                        {record.fact.label}:{" "}
                      </span>
                      {renderFact(record)}
                    </p>
                    <EvidenceFreshnessBadge record={record} />
                  </div>

                  <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                    <div className="min-w-0">
                      <dt className="text-muted-foreground text-xs">
                        Source system
                      </dt>
                      <dd className="mt-1 break-words">
                        {record.source.system}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-muted-foreground text-xs">
                        Business object
                      </dt>
                      <dd className="mt-1 break-words">
                        {record.subject?.type ??
                          record.source.objectType ??
                          "Unknown object"}{" "}
                        ·{" "}
                        <span className="break-all font-mono tabular-nums">
                          {record.subject?.id ??
                            record.source.recordId ??
                            "Unknown record"}
                        </span>
                      </dd>
                    </div>
                    {record.observedAt || record.retrievedAt ? (
                      <div className="min-w-0">
                        <dt className="text-muted-foreground text-xs">
                          Observed / retrieved
                        </dt>
                        <dd className="mt-1 break-words tabular-nums">
                          {record.observedAt ?? record.retrievedAt}
                        </dd>
                      </div>
                    ) : null}
                    {(record.version ?? record.provenance?.version) ? (
                      <div className="min-w-0">
                        <dt className="text-muted-foreground text-xs">
                          Version
                        </dt>
                        <dd className="mt-1 break-words">
                          {record.version ?? record.provenance?.version}
                        </dd>
                      </div>
                    ) : null}
                    {record.provenance ? (
                      <div className="min-w-0">
                        <dt className="text-muted-foreground text-xs">
                          Provenance
                        </dt>
                        <dd className="mt-1 break-words">
                          {record.provenance.sourceField ??
                            record.provenance.retrievalMechanism ??
                            record.provenance.rule ??
                            record.provenance.model ??
                            record.provenance.tool ??
                            "Structured provenance available"}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                </article>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
