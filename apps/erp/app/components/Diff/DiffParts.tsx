// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  cn,
  HStack,
  VStack
} from "@carbon/react";
import type { ReactNode } from "react";
import { LuChevronRight } from "react-icons/lu";
import type { DiffStatus } from "~/modules/shared/diff";
import { DiffBadge } from "./diff-ui";

// -----------------------------------------------------------------------------
// The generic pieces of a git-style, tree-shaped redline: the red/green value
// pills, the "label: old → new" and "label: value" lines, and the collapsible
// tree node. The change notice diff viewer and the project plan diff viewer both
// build on them; each passes its own field labels.
// -----------------------------------------------------------------------------

// A field's display label: the caller's label, else the key title-cased
// ("unitCost" → "Unit Cost").
export function humanizeField(
  field: string,
  labels: Record<string, string>
): string {
  return (
    labels[field] ??
    field.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())
  );
}

export function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  // JSON columns (workInstruction, etc.) — don't dump raw structure.
  if (field === "workInstruction" || typeof value === "object") return "Set";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

// The audit-log red/green pill (mirrors AuditLogDrawer's ChangePill).
export function Pill({
  variant,
  children,
  title
}: {
  variant: "old" | "new";
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-block max-w-[14rem] truncate rounded px-2 py-0.5 align-bottom text-xs",
        variant === "old"
          ? "bg-red-500/10 text-red-500"
          : "bg-green-500/10 text-green-500"
      )}
    >
      {children}
    </span>
  );
}

// A tree-child region: indented under its parent node with a hierarchy guide line.
export function TreeChildren({ children }: { children: ReactNode }) {
  return (
    <div className="w-full border-l border-border/60 pl-3 ml-1">
      <VStack spacing={1} className="w-full">
        {children}
      </VStack>
    </div>
  );
}

// One "label: [old] → [new]" line for a modified field.
export function FieldRow({
  field,
  before,
  after,
  labels
}: {
  field: string;
  before: unknown;
  after: unknown;
  labels: Record<string, string>;
}) {
  const beforeText = formatValue(field, before);
  const afterText = formatValue(field, after);
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs">
      <span className="min-w-[6rem] shrink-0 text-muted-foreground">
        {humanizeField(field, labels)}
      </span>
      <Pill variant="old" title={beforeText}>
        {beforeText}
      </Pill>
      <span className="shrink-0 text-muted-foreground">→</span>
      <Pill variant="new" title={afterText}>
        {afterText}
      </Pill>
    </div>
  );
}

// One "label: [value]" line for an added (green) or removed (red) property.
export function ValueRow({
  field,
  value,
  variant,
  labels
}: {
  field: string;
  value: unknown;
  variant: "old" | "new";
  labels: Record<string, string>;
}) {
  const text = formatValue(field, value);
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs">
      <span className="min-w-[6rem] shrink-0 text-muted-foreground">
        {humanizeField(field, labels)}
      </span>
      <Pill variant={variant} title={text}>
        {text}
      </Pill>
    </div>
  );
}

// The status color for a node title: green (added) / red + strikethrough
// (removed); no color for modified or an unchanged-with-changed-children node.
export function statusColor(status: DiffStatus): string | null {
  return status === "added"
    ? "bg-green-500/10 text-green-500"
    : status === "removed"
      ? "bg-red-500/10 text-red-500 line-through"
      : null;
}

// A collapsible tree node: a title line (colored by status, with the Added /
// Modified / Removed badge) over its body, which lives in a collapsible region so
// the user can fold away parts of a large diff. `collapsible` is false for a leaf
// node with no body — then it renders a plain title line (aligned with a chevron
// spacer) and no toggle. Defaults to open so nothing is hidden by default.
export function TreeNode({
  label,
  status,
  collapsible,
  children
}: {
  label: ReactNode;
  status: DiffStatus;
  collapsible: boolean;
  children?: ReactNode;
}) {
  const colored = statusColor(status);
  const title = (
    <span
      className={cn(
        "inline-block max-w-full truncate align-bottom text-sm",
        colored && `px-2 py-0.5 rounded ${colored}`
      )}
      title={typeof label === "string" ? label : undefined}
    >
      {label}
    </span>
  );

  if (!collapsible) {
    return (
      <HStack className="justify-between w-full">
        <HStack spacing={1} className="min-w-0">
          <span className="size-3 shrink-0" aria-hidden />
          {title}
        </HStack>
        <DiffBadge status={status} />
      </HStack>
    );
  }

  return (
    <Collapsible defaultOpen className="w-full">
      <HStack className="justify-between w-full">
        <CollapsibleTrigger className="group flex min-w-0 items-center gap-1 text-left">
          <LuChevronRight className="size-3 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
          {title}
        </CollapsibleTrigger>
        <DiffBadge status={status} />
      </HStack>
      <CollapsibleContent>
        <TreeChildren>{children}</TreeChildren>
      </CollapsibleContent>
    </Collapsible>
  );
}
