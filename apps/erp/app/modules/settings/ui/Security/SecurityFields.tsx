// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Copy, cn } from "@carbon/react";
import type { ReactNode } from "react";

export function StatusDot({
  tone,
  children
}: {
  tone: "green" | "amber" | "gray";
  children: ReactNode;
}) {
  const toneClass = {
    green: "bg-emerald-500 shadow-[0_0_0_3px_rgb(16_185_129_/_0.15)]",
    amber: "bg-amber-500 shadow-[0_0_0_3px_rgb(245_158_11_/_0.15)]",
    gray: "bg-muted-foreground/40"
  }[tone];

  return (
    <span className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
      <span className={cn("size-2 rounded-full", toneClass)} />
      {children}
    </span>
  );
}

export function CopyableField({
  label,
  value
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col gap-1.5 w-full">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <div className="flex items-center gap-1 h-10 w-full rounded-md border border-input bg-muted/40 pl-3 pr-1">
        <span className="flex-1 truncate font-mono text-sm text-muted-foreground">
          {value}
        </span>
        <Copy text={value} />
      </div>
    </div>
  );
}
