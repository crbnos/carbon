import type { ExceptionSeverity, FactoryException } from "@carbon/utils";
import type { HTMLAttributes, ReactNode } from "react";
import {
  LuCircleAlert,
  LuCircleHelp,
  LuInfo,
  LuOctagonAlert,
  LuTriangleAlert
} from "react-icons/lu";

import type { BadgeProps } from "./Badge";
import { Badge } from "./Badge";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "./Card";
import { cn } from "./utils/cn";

export type { ExceptionSeverity } from "@carbon/utils";

export interface ExceptionCardProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  exception: FactoryException;
  action?: ReactNode;
}

const severityConfig: Record<
  ExceptionSeverity,
  {
    label: string;
    variant: BadgeProps["variant"];
    icon: typeof LuInfo;
  }
> = {
  critical: { label: "Critical", variant: "red", icon: LuOctagonAlert },
  high: { label: "High", variant: "orange", icon: LuTriangleAlert },
  medium: { label: "Medium", variant: "yellow", icon: LuCircleAlert },
  low: { label: "Low", variant: "blue", icon: LuInfo },
  unknown: {
    label: "Unknown severity",
    variant: "gray",
    icon: LuCircleHelp
  }
};

function displayValue(value: unknown, description?: string) {
  if (description) return description;
  if (value === null || value === undefined) return "Not supplied";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  return "Structured value available";
}

export function ExceptionCard({
  exception,
  action,
  className,
  ...props
}: ExceptionCardProps) {
  const config = severityConfig[exception.severity] ?? severityConfig.unknown;
  const SeverityIcon = config.icon;

  return (
    <Card
      className={cn("overflow-hidden", className)}
      role="region"
      aria-label={`Exception: ${exception.summary}`}
      {...props}
    >
      <CardHeader className="border-border border-b">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="break-words">{exception.summary}</CardTitle>
            <p className="mt-1 break-all font-mono text-muted-foreground text-xs">
              {exception.id}
            </p>
          </div>
          <Badge
            variant={config.variant}
            className="gap-1"
            aria-label={`Exception severity: ${config.label}`}
          >
            <SeverityIcon aria-hidden="true" className="size-3 shrink-0" />
            <span>{config.label}</span>
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="gap-4 rounded-none border-0">
        <section aria-label="Fact">
          <p className="mb-1 font-medium text-muted-foreground text-xs uppercase tracking-wider">
            Facts
          </p>
          <ul className="space-y-2 text-foreground text-sm">
            {exception.facts.map((fact) => (
              <li key={fact.label}>
                <span className="font-medium">{fact.label}: </span>
                {displayValue(fact.value, fact.description)}
              </li>
            ))}
          </ul>
        </section>

        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-muted-foreground text-xs">Subject</dt>
            <dd className="mt-1 break-all font-mono text-sm">
              {exception.subject.type} · {exception.subject.id}
            </dd>
          </div>
          {exception.impact ? (
            <div className="min-w-0">
              <dt className="text-muted-foreground text-xs">Impact</dt>
              <dd className="mt-1 break-words text-sm">
                {exception.impact.summary}
              </dd>
            </div>
          ) : null}
          {exception.owner ? (
            <div className="min-w-0">
              <dt className="text-muted-foreground text-xs">Owner</dt>
              <dd className="mt-1 break-words text-sm">
                {exception.owner.label}
              </dd>
            </div>
          ) : null}
          <div className="min-w-0">
            <dt className="text-muted-foreground text-xs">Lifecycle</dt>
            <dd className="mt-1 text-sm">{exception.lifecycle}</dd>
          </div>
        </dl>

        {exception.inferredCause ? (
          <section aria-label="Inference">
            <p className="mb-1 font-medium text-muted-foreground text-xs uppercase tracking-wider">
              Inference
            </p>
            <div className="break-words text-foreground text-sm text-pretty">
              <span className="font-medium">
                {exception.inferredCause.label}:{" "}
              </span>
              {exception.inferredCause.text}
            </div>
          </section>
        ) : null}

        {exception.recommendations?.length ? (
          <section aria-label="Recommendation">
            <p className="mb-1 font-medium text-muted-foreground text-xs uppercase tracking-wider">
              Recommendations
            </p>
            <ul className="space-y-2 break-words text-foreground text-sm text-pretty">
              {exception.recommendations.map((recommendation) => (
                <li key={recommendation.id}>{recommendation.text}</li>
              ))}
            </ul>
          </section>
        ) : null}
      </CardContent>
      {action ? <CardFooter>{action}</CardFooter> : null}
    </Card>
  );
}
