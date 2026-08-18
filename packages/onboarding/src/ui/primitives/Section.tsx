// Card-shell + list primitives. The hub's surfaces are all "titled card wrapping
// a divided list", composed the design-system way from `CardHeader` + `CardContent`
// with their default styling — no custom borders/padding overrides, so they read
// as standard cards. Compose: <Section title aside><SectionList>{rows}</SectionList></Section>.

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn
} from "@carbon/react";
import type { ReactNode } from "react";

export function Section({
  id,
  title,
  number,
  subtitle,
  aside,
  children,
  className
}: {
  id?: string;
  title?: ReactNode;
  number?: number | string;
  subtitle?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const hasHeader = title != null || aside != null;
  return (
    <Card id={id} className={cn("overflow-hidden", className)}>
      {hasHeader ? (
        <CardHeader>
          <div className="flex items-start gap-3 min-w-0">
            {number != null ? (
              <span className="shrink-0 size-6 rounded-lg border bg-background flex items-center justify-center text-xs font-semibold tabular-nums">
                {number}
              </span>
            ) : null}
            <div className="min-w-0">
              {title != null ? (
                <CardTitle className="text-sm font-semibold">{title}</CardTitle>
              ) : null}
              {subtitle != null ? (
                <CardDescription>{subtitle}</CardDescription>
              ) : null}
            </div>
          </div>
          {aside != null ? <div className="shrink-0">{aside}</div> : null}
        </CardHeader>
      ) : null}
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function SectionList({
  children,
  className
}: {
  children: ReactNode;
  className?: string;
}) {
  return <ul className={cn("divide-y", className)}>{children}</ul>;
}

// The other card idiom: a padded card for prose/summary blocks (Scope sections,
// support, etc.). Same design-system composition as `Section` — a titled `Panel`
// puts its heading in a `CardHeader` over the `CardContent` body; an untitled one
// is just the `CardContent` surface.
export function Panel({
  title,
  aside,
  children,
  className
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const hasHeader = title != null || aside != null;
  return (
    <Card className="overflow-hidden">
      {hasHeader ? (
        <CardHeader>
          {title != null ? (
            <CardTitle className="text-sm font-semibold">{title}</CardTitle>
          ) : null}
          {aside != null ? <div className="shrink-0">{aside}</div> : null}
        </CardHeader>
      ) : null}
      <CardContent className={className}>{children}</CardContent>
    </Card>
  );
}
