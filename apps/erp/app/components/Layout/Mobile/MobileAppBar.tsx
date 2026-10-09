// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Button, cn } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { LuChevronDown, LuChevronLeft } from "react-icons/lu";
import { Link, useLocation } from "react-router";
import { SidebarPresentationProvider } from "../Navigation/SidebarPresentation";
import { AppBarActionsTarget } from "./ChromeSlots";
import { SectionSwitcherSheet } from "./SectionSwitcherSheet";
import { useAppBar } from "./useAppBar";

function scrollMainToTop() {
  document.querySelector("main")?.scrollTo({ top: 0, behavior: "smooth" });
}

/**
 * The compact app bar: ‹ Back on pushed screens, the title (a section
 * switcher ▾ on root screens with a module sidebar) and up to two page
 * actions from <AppBarActions>. Hidden at md and above.
 */
export function MobileAppBar() {
  const { t } = useLingui();
  const { title, subtitle, backTo, kind, trailing, moduleTitle, Sidebar } =
    useAppBar();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const location = useLocation();

  // Picking a section navigates; any navigation closes the switcher.
  // biome-ignore lint/correctness/useExhaustiveDependencies: close on navigation only
  useEffect(() => {
    setSwitcherOpen(false);
  }, [location.pathname, location.search]);
  const canSwitch = kind === "root" && Boolean(Sidebar);

  // On a section root the title names the section the switcher ticks (the
  // sidebar's own active rule); it falls back to the breadcrumb when the
  // sidebar has no active item (e.g. the module landing).
  const sectionTitle =
    canSwitch && Sidebar ? (
      <SidebarPresentationProvider value="title">
        <Sidebar />
      </SidebarPresentationProvider>
    ) : null;
  const titleText = (
    <span className="min-w-0 max-w-full truncate text-[17px] font-semibold leading-tight">
      {sectionTitle ? (
        <>
          <span className="peer empty:hidden">{sectionTitle}</span>
          <span className="peer-[:not(:empty)]:hidden">{title}</span>
        </>
      ) : (
        title
      )}
    </span>
  );

  return (
    <header className="md:hidden sticky top-0 z-20 flex h-[calc(52px+env(safe-area-inset-top))] shrink-0 items-center gap-1 border-b border-border bg-card/92 px-1 pt-safe backdrop-blur">
      {kind === "pushed" && backTo ? (
        <Button
          asChild
          isIcon
          variant="ghost"
          size="lg"
          aria-label={t`Back`}
          className="shrink-0"
        >
          <Link to={backTo}>
            <LuChevronLeft className="size-6" />
          </Link>
        </Button>
      ) : (
        <span className="w-2 shrink-0" />
      )}

      {canSwitch ? (
        <button
          type="button"
          onClick={() => setSwitcherOpen(true)}
          aria-haspopup="dialog"
          className="flex min-h-11 min-w-0 flex-col items-start justify-center rounded-lg px-1 text-left text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <span className="flex min-w-0 max-w-full items-center gap-1">
            {titleText}
            <LuChevronDown className="size-5 shrink-0 text-muted-foreground" />
          </span>
          {/* A root screen with two siblings under one sidebar label
              (Material Planning) names itself here. */}
          {subtitle ? (
            <span className="min-w-0 max-w-full truncate text-xs text-muted-foreground">
              {subtitle}
            </span>
          ) : null}
        </button>
      ) : (
        <button
          type="button"
          onClick={scrollMainToTop}
          className={cn(
            "flex min-h-11 min-w-0 flex-col items-start justify-center px-1 text-left text-foreground outline-none"
          )}
        >
          {titleText}
          {subtitle ? (
            <span className="min-w-0 max-w-full truncate text-xs text-muted-foreground">
              {subtitle}
            </span>
          ) : null}
        </button>
      )}

      <div className="flex-1" />
      <AppBarActionsTarget
        className={cn(
          "flex shrink-0 items-center",
          kind === "selection" && "hidden"
        )}
      />
      {trailing}

      {canSwitch && Sidebar ? (
        <SectionSwitcherSheet
          open={switcherOpen}
          onOpenChange={setSwitcherOpen}
          title={moduleTitle}
          Sidebar={Sidebar}
        />
      ) : null}
    </header>
  );
}
