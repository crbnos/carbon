// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn, PrefetchLink } from "@carbon/react";
import type { ReactNode } from "react";
import { createContext, useContext } from "react";
import { LuCheck } from "react-icons/lu";

/**
 * Where a module sidebar renders: the desktop side panel, the compact section
 * switcher sheet, or ("title") just the current section's name for the compact
 * app bar. The sidebar component and its data are the same in all three, so
 * the sheet lists exactly the desktop items and the title names the item the
 * sheet ticks.
 */
export type SidebarPresentation = "panel" | "sheet" | "title";

const SidebarPresentationContext = createContext<SidebarPresentation>("panel");

export const SidebarPresentationProvider = SidebarPresentationContext.Provider;

export function useSidebarPresentation() {
  return useContext(SidebarPresentationContext);
}

/** A 48pt section-switcher row: icon, label, ✓ on the current section. */
export function SheetNavRow({
  to,
  icon,
  label,
  isActive,
  inset = false
}: {
  to: string;
  icon?: ReactNode;
  label: ReactNode;
  isActive: boolean;
  inset?: boolean;
}) {
  return (
    <PrefetchLink
      to={to}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "flex min-h-12 items-center gap-3 rounded-lg px-3 text-[15px] text-foreground active:bg-accent",
        inset && "pl-11 text-sm text-muted-foreground",
        isActive && "font-medium"
      )}
    >
      {icon ? (
        <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground [&>svg]:size-5">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {isActive ? <LuCheck className="size-5 shrink-0 text-primary" /> : null}
    </PrefetchLink>
  );
}

/** Group overline in the switcher sheet. */
export function SheetNavGroup({
  title,
  children
}: {
  title?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col pb-2">
      {title ? (
        <div className="px-3 pt-3 pb-1 text-xs font-medium uppercase tracking-[0.04em] text-muted-foreground">
          {title}
        </div>
      ) : null}
      {children}
    </div>
  );
}
