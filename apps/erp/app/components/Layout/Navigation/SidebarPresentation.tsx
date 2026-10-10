// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  cn,
  dockMenuRowClassName,
  PrefetchLink,
  SheetSectionLabel,
  sheetRowClassName
} from "@carbon/react";
import type { ReactNode } from "react";
import { createContext, useContext } from "react";
import { SheetRowContent } from "../Mobile/SheetRow";

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

/**
 * How a sheet presentation draws its rows: the title switcher's 48pt rows
 * with a ✓, or the dock menu's rows, where the current section is lit.
 */
type SheetNavStyle = "switcher" | "menu";

const SheetNavStyleContext = createContext<SheetNavStyle>("switcher");

export const SheetNavStyleProvider = SheetNavStyleContext.Provider;

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
  const style = useContext(SheetNavStyleContext);
  if (style === "menu") {
    return (
      <PrefetchLink
        to={to}
        aria-current={isActive ? "page" : undefined}
        className={cn(dockMenuRowClassName, inset && "pl-12 text-sm")}
      >
        {icon ? (
          <span className="flex size-5 items-center justify-center [&>svg]:size-[18px]">
            {icon}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </PrefetchLink>
    );
  }
  return (
    <PrefetchLink
      to={to}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        sheetRowClassName,
        inset && "pl-11 text-sm text-muted-foreground",
        isActive && "font-medium"
      )}
    >
      <SheetRowContent
        icon={icon}
        label={label}
        trailing={isActive ? "check" : null}
      />
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
  const style = useContext(SheetNavStyleContext);
  if (style === "menu") {
    return (
      <div className="flex flex-col border-t border-border p-1.5 first:border-t-0">
        {title ? (
          <div className="px-3 pt-1.5 pb-1 text-xs text-muted-foreground">
            {title}
          </div>
        ) : null}
        {children}
      </div>
    );
  }
  return (
    <div className="flex flex-col pb-2">
      {title ? <SheetSectionLabel>{title}</SheetSectionLabel> : null}
      {children}
    </div>
  );
}
