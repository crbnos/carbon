// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

"use client";

import type { Company } from "@carbon/auth";
import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  HStack,
  NavRail,
  NavRailGroup,
  NavRailLink,
  NavRailSwitcher,
  useMode,
  useShortcutKeyMap,
  useSidebar
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { Suspense, useMemo } from "react";
import {
  LuActivity,
  LuArrowUpRight,
  LuCalendarDays,
  LuChevronsUpDown,
  LuCirclePlay,
  LuClipboardList,
  LuHistory,
  LuMonitorPlay,
  LuPackageCheck,
  LuWrench
} from "react-icons/lu";
import { Await, Link, useLocation, useNavigate } from "react-router";
import type { Location } from "~/services/types";
import { MES_NAV_SHORTCUTS } from "~/shortcuts";
import type { PinnedInUser } from "~/types";
import { ERP_URL, path } from "~/utils/path";
import { AdjustInventory } from "./AdjustInventory";
import { EndShift } from "./EndShift";
import { MoreSheet } from "./MoreSheet";
import Suggestion from "./Suggestion";
import { TimeCardButton } from "./TimeCardButton";
import { UserNav, useSwitchCompany } from "./UserNav";

export function AppSidebar({
  activeEvents,
  activeMaintenanceCount,
  company,
  companies,
  consoleEnabled,
  consoleMode,
  location,
  locations,
  openClockEntry,
  pinnedInUser,
  timeCardEnabled,
  moreOpen,
  onMoreOpenChange
}: {
  activeEvents: number;
  activeMaintenanceCount: number;
  company: Company;
  companies: Company[];
  consoleEnabled?: boolean;
  consoleMode: boolean;
  location: string;
  locations: Location[];
  pinnedInUser: PinnedInUser | null;
  timeCardEnabled?: boolean;
  openClockEntry?: Promise<{
    data: { id: string; clockIn: string; [key: string]: unknown } | null;
  }> | null;
  /** Phones: the More tab's sheet. */
  moreOpen: boolean;
  onMoreOpenChange: (open: boolean) => void;
}) {
  const { t } = useLingui();
  const { isMobile } = useSidebar();

  const queues = (
    <QueueLinks
      counts={{
        active: activeEvents,
        maintenance: activeMaintenanceCount
      }}
    />
  );
  const timeCard = timeCardEnabled && (
    <Suspense fallback={<TimeCardButton openClockEntry={null} />}>
      <Await resolve={openClockEntry}>
        {(resolved) => (
          <TimeCardButton
            openClockEntry={
              resolved?.data
                ? {
                    id: resolved.data.id,
                    clockIn: resolved.data.clockIn
                  }
                : null
            }
          />
        )}
      </Await>
    </Suspense>
  );
  const tools = (
    <>
      <NavRailGroup label={t`Inventory Adjustments`}>
        <AdjustInventory add={true} />
        <AdjustInventory add={false} />
      </NavRailGroup>
      <NavRailGroup label={t`Tools`}>
        <EndShift />
        <Suggestion />
        <DisplaysLink />
      </NavRailGroup>
    </>
  );

  // Phones: the app bar title opens the queues; More holds the rest.
  if (isMobile) {
    return (
      <>
        <NavRail>{queues}</NavRail>
        <MoreSheet
          open={moreOpen}
          onOpenChange={onMoreOpenChange}
          header={<CompanyLink company={company} />}
          company={company}
          companies={companies}
          consoleEnabled={consoleEnabled}
          consoleMode={consoleMode}
          location={location}
          locations={locations}
          pinnedInUser={pinnedInUser}
        >
          {timeCard}
          {tools}
        </MoreSheet>
      </>
    );
  }

  return (
    <NavRail
      header={
        <CompanySwitcher
          company={company}
          companies={companies}
          // An operator pinned in at a console station cannot switch company.
          canSwitch={!(consoleMode && pinnedInUser)}
        />
      }
      footer={
        <>
          {timeCard}
          <UserNav
            consoleEnabled={consoleEnabled}
            consoleMode={consoleMode}
            location={location}
            locations={locations}
            pinnedInUser={pinnedInUser}
          />
        </>
      }
    >
      <NavRailGroup label={t`Operations`}>{queues}</NavRailGroup>
      {tools}
    </NavRail>
  );
}

/**
 * The rail's header: the company's logo and name, which switch company and
 * lead back to the ERP.
 */
function CompanySwitcher({
  company,
  companies,
  canSwitch
}: {
  company: Company;
  companies: Company[];
  canSwitch: boolean;
}) {
  const { t } = useLingui();
  const mode = useMode();
  const switchCompany = useSwitchCompany();

  // Nothing to switch to: the row is the link back to the ERP, as it was.
  if (!canSwitch || companies.length < 2) {
    return <CompanyLink company={company} />;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <NavRailSwitcher
          label={company.name ?? ""}
          logoLight={company.logoLightIcon}
          logoDark={company.logoDarkIcon}
          trailing={<LuChevronsUpDown />}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[240px]">
        <DropdownMenuLabel>{t`Companies`}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={company.companyId!}>
          {companies.map((c) => {
            const companyLogo =
              mode === "dark" ? c.logoDarkIcon : c.logoLightIcon;
            return (
              <DropdownMenuRadioItem
                key={c.companyId}
                value={c.companyId!}
                onSelect={() => {
                  if (c.companyId !== company.companyId) {
                    switchCompany(c.companyId!);
                  }
                }}
              >
                <HStack>
                  <Avatar
                    size="xs"
                    name={c.name ?? undefined}
                    src={companyLogo ?? undefined}
                  />
                  <span>{c.name}</span>
                </HStack>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to={ERP_URL}>
            <DropdownMenuIcon icon={<LuArrowUpRight />} />
            {t`Open ERP`}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Leads back to the ERP; on phones, the More sheet's first row. */
function CompanyLink({ company }: { company: Company }) {
  return (
    <NavRailSwitcher
      asChild
      label={company.name ?? ""}
      logoLight={company.logoLightIcon}
      logoDark={company.logoDarkIcon}
      trailing={<LuArrowUpRight className="md:hidden" />}
    >
      <Link to={ERP_URL} />
    </NavRailSwitcher>
  );
}

export type QueueKey = keyof typeof MES_NAV_SHORTCUTS;

/** The task queues, in rail order; each one's ⌥-digit comes from its key. */
export const QUEUES: { key: QueueKey; icon: typeof LuActivity; to: string }[] =
  [
    { key: "operations", icon: LuCalendarDays, to: path.to.operations },
    { key: "assigned", icon: LuClipboardList, to: path.to.assigned },
    { key: "active", icon: LuActivity, to: path.to.active },
    { key: "recent", icon: LuHistory, to: path.to.recent },
    { key: "jobs", icon: LuCirclePlay, to: path.to.jobs },
    { key: "maintenance", icon: LuWrench, to: path.to.maintenance },
    { key: "picking", icon: LuPackageCheck, to: path.to.picking }
  ];

/** `path.to.operations` carries a `?saved=1` query; activity matches on paths. */
export const queuePath = (to: string) => to.split("?")[0];

/** The queue titles. The rail, the tab bar and Back labels share them. */
export function useQueueTitles(): Record<QueueKey, string> {
  const { t } = useLingui();
  return useMemo(
    () => ({
      operations: t`Schedule`,
      assigned: t`Assigned`,
      active: t`Active`,
      recent: t`Recent`,
      jobs: t`Jobs`,
      maintenance: t`Maintenance`,
      picking: t`Picking`
    }),
    [t]
  );
}

/** The queue a path belongs to. Job detail (`/x/job/:id`) belongs to Jobs. */
export function queueKeyForPath(pathname: string): QueueKey | undefined {
  const queue = QUEUES.find((q) => pathname.startsWith(queuePath(q.to)));
  if (queue) return queue.key;
  // generatePath drops a trailing slash, so add it back for the prefix test.
  return pathname.startsWith(`${path.to.jobDag("")}/`) ? "jobs" : undefined;
}

function QueueLinks({ counts }: { counts: Partial<Record<QueueKey, number>> }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const titles = useQueueTitles();

  useShortcutKeyMap(
    useMemo(
      () =>
        QUEUES.map((queue) => ({
          shortcut: MES_NAV_SHORTCUTS[queue.key],
          action: () => navigate(queue.to)
        })),
      [navigate]
    )
  );

  return (
    <>
      {QUEUES.map((queue) => (
        <NavRailLink
          key={queue.key}
          to={queue.to}
          icon={<queue.icon />}
          label={titles[queue.key]}
          isActive={pathname.startsWith(queuePath(queue.to))}
          tag={counts[queue.key] ? String(counts[queue.key]) : undefined}
        />
      ))}
    </>
  );
}

/**
 * Entry point to the wall displays. Opens in a new tab: the operator's own
 * session stays where it was, and the display gets a window that can be thrown
 * full-screen onto the screen at the machine.
 */
function DisplaysLink() {
  const { t } = useLingui();

  return (
    <NavRailLink
      to={path.to.displays}
      icon={<LuMonitorPlay />}
      label={t`Displays`}
      external
      target="_blank"
      rel="noreferrer"
      trailing={
        <LuArrowUpRight className="hidden size-4 text-muted-foreground max-md:block" />
      }
    />
  );
}
