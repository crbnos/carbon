// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn, sheetRowClassName } from "@carbon/react";
import type { ComponentProps, ReactNode } from "react";
import { forwardRef } from "react";
import { LuArrowUpRight, LuCheck, LuChevronRight } from "react-icons/lu";

/**
 * One 48pt row in a shell sheet (Modules, Profile). The trailing
 * indicator: › drills in, ↗ leaves the app, ✓ marks the current.
 */
export type SheetRowTrailing = "drill" | "external" | "check" | ReactNode;

export function SheetRowContent({
  icon,
  label,
  detail,
  trailing,
  destructive
}: {
  icon?: ReactNode;
  label: ReactNode;
  detail?: ReactNode;
  trailing?: SheetRowTrailing;
  destructive?: boolean;
}) {
  return (
    <>
      {icon ? (
        <span
          className={cn(
            "flex size-5 shrink-0 items-center justify-center [&>svg]:size-5",
            destructive ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {detail ? (
        <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
          {detail}
        </span>
      ) : null}
      {trailing === "drill" ? (
        <LuChevronRight className="size-5 shrink-0 text-muted-foreground" />
      ) : trailing === "external" ? (
        <LuArrowUpRight className="size-5 shrink-0 text-muted-foreground" />
      ) : trailing === "check" ? (
        <LuCheck className="size-5 shrink-0 text-primary" />
      ) : (
        trailing
      )}
    </>
  );
}

export const SheetRowButton = forwardRef<
  HTMLButtonElement,
  ComponentProps<"button"> & { destructive?: boolean }
>(({ className, destructive, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    className={cn(
      sheetRowClassName,
      destructive && "text-destructive",
      className
    )}
    {...props}
  />
));
SheetRowButton.displayName = "SheetRowButton";

/** A group of rows separated from the next by a hairline, like menu separators. */
export function SheetRowGroup({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col border-b border-border py-1 last:border-b-0">
      {children}
    </div>
  );
}
