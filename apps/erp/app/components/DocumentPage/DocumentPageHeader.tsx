// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Copy,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Heading,
  IconButton,
  useViewport
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { Children, useEffect, useRef, useState } from "react";
import { LuEllipsisVertical, LuPanelRight } from "react-icons/lu";
import { PhoneActionBar } from "../Layout/Mobile/ChromeSlots";
import { RecordPhoneChrome } from "../Layout/RecordHeader";
import { useDocumentPage } from "./DocumentPage";

type DocumentPageHeaderProps = {
  /** The readable id — shown, copyable. */
  title: string;
  status?: ReactNode;
  /** ⋯ menu contents: secondary and destructive actions. */
  menuItems?: ReactNode;
  /** Outputs, then the lifecycle step — the next step is the one primary. */
  actions?: ReactNode;
  /** Short facts under the title, joined with a middot. */
  meta?: ReactNode;
};

/**
 * The flat header of a `DocumentPage`: identity left, actions right, a line
 * of facts underneath. It is pinned, and draws its bottom rule only once the
 * content has scrolled under it. Phones: the ⋯ menu and Copy ID move to the
 * app bar and the actions to the bottom bar, as on every record page.
 */
export function DocumentPageHeader({
  title,
  status,
  menuItems,
  actions,
  meta
}: DocumentPageHeaderProps) {
  const { t } = useLingui();
  const { isPhone } = useViewport();
  const { hasSidebar, isSidebarOpen, toggleSidebar } = useDocumentPage();
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [isStuck, setIsStuck] = useState(false);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(([entry]) =>
      setIsStuck(!entry.isIntersecting)
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  const metaItems = Children.toArray(meta);
  const metaLine =
    metaItems.length > 0 ? (
      <div className="text-sm text-muted-foreground flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {metaItems.map((item, index) => (
          // The separator leads its item, so a wrap never strands it
          // at the end of a line.
          <span key={index} className="inline-flex items-center gap-1">
            {index > 0 && (
              <span aria-hidden className="mr-0.5">
                ·
              </span>
            )}
            {item}
          </span>
        ))}
      </div>
    ) : null;

  const sidebarToggle = hasSidebar ? (
    <IconButton
      aria-label={
        isSidebarOpen
          ? t`Hide documents and activity`
          : t`Show documents and activity`
      }
      icon={<LuPanelRight />}
      variant="ghost"
      aria-expanded={isSidebarOpen}
      onClick={toggleSidebar}
    />
  ) : null;

  if (isPhone) {
    return (
      <>
        <RecordPhoneChrome menu={menuItems} copyValue={title} />
        {status || metaLine || sidebarToggle ? (
          <header className="flex flex-col gap-1.5 border-b border-border bg-card px-4 py-3">
            <div className="flex min-h-11 items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                {status}
              </div>
              {sidebarToggle}
            </div>
            {metaLine}
          </header>
        ) : null}
        {actions ? (
          <PhoneActionBar className="[&>*]:min-w-0 [&>*]:flex-1">
            {actions}
          </PhoneActionBar>
        ) : null}
      </>
    );
  }

  return (
    <>
      <div ref={sentinelRef} className="h-px" aria-hidden />
      <header
        className={cn(
          "sticky top-0 z-10 bg-card border-b transition-colors",
          isStuck ? "border-border" : "border-transparent"
        )}
      >
        <div className="flex flex-col gap-1 w-full max-w-5xl mx-auto px-4 md:px-8 pt-5 pb-4">
          <div className="flex items-center justify-between gap-x-4 gap-y-2 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <Heading
                as="h1"
                size="h2"
                className="min-w-0 whitespace-nowrap truncate"
              >
                {title}
              </Heading>
              <Copy text={title} />
              {menuItems && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton
                      aria-label={t`More options`}
                      icon={<LuEllipsisVertical />}
                      variant="secondary"
                      size="sm"
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {menuItems}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {status && (
                <div className="flex items-center gap-1 shrink-0">{status}</div>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {actions}
              {sidebarToggle}
            </div>
          </div>
          {metaLine}
        </div>
      </header>
    </>
  );
}
