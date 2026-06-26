// Card-shell + list primitives. The hub's surfaces are all "titled card wrapping
// a divided list"; this replaces ~15 copy-pasted `rounded-2xl border bg-card …`
// blocks. Compose: <Section title aside><SectionList>{rows}</SectionList></Section>.

import { cn } from "@carbon/react";
import type { ReactNode } from "react";

export function Section({
  title,
  number,
  subtitle,
  aside,
  children,
  className
}: {
  title?: ReactNode;
  number?: number | string;
  subtitle?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const hasHeader = title != null || aside != null;
  return (
    <section
      className={cn(
        "rounded-2xl border bg-card shadow-button-base overflow-hidden",
        className
      )}
    >
      {hasHeader ? (
        <div className="px-5 py-3 border-b flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            {number != null ? (
              <span className="shrink-0 size-6 rounded-lg border bg-background flex items-center justify-center text-xs font-semibold tabular-nums">
                {number}
              </span>
            ) : null}
            <div className="min-w-0">
              {title != null ? (
                <div className="text-sm font-semibold">{title}</div>
              ) : null}
              {subtitle != null ? (
                <div className="text-xs text-muted-foreground">{subtitle}</div>
              ) : null}
            </div>
          </div>
          {aside != null ? <div className="shrink-0">{aside}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
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

// The other card idiom: a padded card with an inline heading (no header bar, no
// divided list). Used for prose/summary blocks (Scope sections, support, etc.).
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
  return (
    <section
      className={cn(
        "rounded-2xl border bg-card shadow-button-base p-5",
        className
      )}
    >
      {title != null || aside != null ? (
        <div className="flex items-start justify-between gap-3 mb-3">
          {title != null ? (
            <h2 className="text-sm font-semibold">{title}</h2>
          ) : null}
          {aside != null ? <div className="shrink-0">{aside}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
