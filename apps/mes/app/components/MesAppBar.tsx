// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  cn,
  Heading,
  SidebarTrigger,
  useSidebar,
  useViewport
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { LuChevronDown, LuChevronLeft } from "react-icons/lu";
import { Link } from "react-router";

type MesAppBarProps = {
  kind: "root" | "pushed";
  title: ReactNode;
  /** Pushed pages: the parent page name, under the title. */
  subtitle?: ReactNode;
  /** Pushed pages: where Back goes. */
  back?: { to: string };
  /** Phones: at most 2 icon actions, each 44×44. */
  actions?: ReactNode;
  /** The default md+ header's title when it differs from the phone one. */
  desktopTitle?: ReactNode;
  /**
   * The md+ header. Omit it for today's queue header (trigger + h4 title).
   * Pass `null` when the page renders its own md+ header, or none.
   */
  desktop?: ReactNode;
  /** Extra classes for the default md+ header. */
  desktopClassName?: string;
};

/**
 * The MES page header. Below md: one 52px bar with Back (pushed pages), a
 * 17px title and up to 2 actions; on root pages the title ▾ opens the queue
 * list, like the ERP's section switcher. From md: the header each page had
 * before.
 */
export function MesAppBar({
  kind,
  title,
  subtitle,
  back,
  actions,
  desktopTitle,
  desktop,
  desktopClassName
}: MesAppBarProps) {
  const { t } = useLingui();
  const { isPhone } = useViewport();
  const { openMobile, setOpenMobile } = useSidebar();

  const desktopHeader =
    desktop === undefined ? (
      <header
        className={cn(
          "sticky top-0 z-10 flex h-[var(--header-height)] shrink-0 items-center gap-2 border-b bg-card max-md:hidden",
          desktopClassName
        )}
      >
        <div className="flex items-center gap-2 px-2">
          <SidebarTrigger />
          <Heading size="h4">{desktopTitle ?? title}</Heading>
        </div>
      </header>
    ) : (
      desktop
    );

  // One header mounts at a time, so page actions (timers, menus) mount once.
  if (!isPhone) return <>{desktopHeader}</>;

  return (
    <>
      <header className="md:hidden sticky top-0 z-20 flex h-[calc(52px+env(safe-area-inset-top))] shrink-0 items-center gap-1 border-b border-border bg-card px-1 pt-safe">
        {kind === "pushed" && back ? (
          <Button
            asChild
            isIcon
            variant="ghost"
            size="lg"
            aria-label={t`Back`}
            className="shrink-0"
          >
            <Link to={back.to}>
              <LuChevronLeft className="size-6" />
            </Link>
          </Button>
        ) : (
          <span className="w-2 shrink-0" />
        )}
        {kind === "root" ? (
          <div className="flex min-w-0 flex-1 items-center">
            <button
              type="button"
              onClick={() => setOpenMobile(true)}
              aria-haspopup="dialog"
              aria-expanded={openMobile}
              className="flex min-h-11 min-w-0 items-center gap-1 rounded-lg px-1 text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <span className="min-w-0 truncate text-[17px] font-semibold leading-tight">
                {title}
              </span>
              <LuChevronDown className="size-5 shrink-0 text-muted-foreground" />
            </button>
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 flex-col justify-center">
            <span className="truncate text-[17px] font-semibold leading-tight text-foreground">
              {title}
            </span>
            {subtitle ? (
              <span className="truncate text-xs text-muted-foreground">
                {subtitle}
              </span>
            ) : null}
          </div>
        )}
        {actions ? (
          <div className="flex shrink-0 items-center self-stretch">
            {actions}
          </div>
        ) : null}
      </header>
    </>
  );
}
