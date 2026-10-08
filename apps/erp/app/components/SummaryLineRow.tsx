// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn } from "@carbon/react";
import type { ReactNode } from "react";
import { Link } from "react-router";

type SummaryLineRowProps = {
  /** Line 1, leading: the part or line identity. */
  title: ReactNode;
  /** Line 1, trailing: the line total. */
  value: ReactNode;
  /** Line 2: the name or description. */
  description?: ReactNode;
  /** Line 3: quantity × unit price. */
  meta?: ReactNode;
  /** After the value, e.g. an expand chevron. */
  trailing?: ReactNode;
} & ({ to: string } | { onClick: () => void; expanded: boolean });

const rowClassName =
  "flex w-full min-w-0 flex-col gap-0.5 py-3 text-left active:bg-accent";

/** Phones: the divided list that holds a summary card's SummaryLineRows. */
export function SummaryLineList({
  className,
  children
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn("flex w-full flex-col divide-y divide-border", className)}
    >
      {children}
    </div>
  );
}

/**
 * Phones: one document line in a summary card. A link opens the line's page;
 * a button expands the line in place.
 */
export function SummaryLineRow(props: SummaryLineRowProps) {
  const content = (
    <>
      <span className="flex w-full min-w-0 items-baseline justify-between gap-3">
        <span className="min-w-0 truncate font-medium text-foreground">
          {props.title}
        </span>
        <span className="flex shrink-0 items-center gap-1 tabular-nums">
          {props.value}
          {props.trailing}
        </span>
      </span>
      {props.description ? (
        <span className="w-full min-w-0 truncate text-sm text-muted-foreground">
          {props.description}
        </span>
      ) : null}
      {props.meta ? (
        <span className="text-sm text-muted-foreground tabular-nums">
          {props.meta}
        </span>
      ) : null}
    </>
  );

  return "to" in props ? (
    <Link to={props.to} className={rowClassName}>
      {content}
    </Link>
  ) : (
    <button
      type="button"
      aria-expanded={props.expanded}
      onClick={props.onClick}
      className={rowClassName}
    >
      {content}
    </button>
  );
}
