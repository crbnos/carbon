// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { NavSheet } from "@carbon/react";
import type { ComponentType, ReactNode } from "react";
import { SidebarPresentationProvider } from "../Navigation/SidebarPresentation";

/**
 * The title ▾ sheet on root screens: renders the module's own sidebar
 * component in its sheet presentation, so it lists exactly the desktop
 * sections. Picking a row navigates and closes the sheet.
 */
export function SectionSwitcherSheet({
  open,
  onOpenChange,
  title,
  Sidebar
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  Sidebar: ComponentType;
}) {
  return (
    <NavSheet
      open={open}
      onOpenChange={onOpenChange}
      header={
        <h2 className="truncate text-[17px] font-semibold text-foreground">
          {title}
        </h2>
      }
    >
      <div className="px-2 pb-4">
        <SidebarPresentationProvider value="sheet">
          <Sidebar />
        </SidebarPresentationProvider>
      </div>
    </NavSheet>
  );
}
