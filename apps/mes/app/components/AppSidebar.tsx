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
  NavRailItem,
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
  LuArrowLeft,
  LuArrowUpRight,
  LuCalendarDays,
  LuChevronsUpDown,
  LuCirclePlay,
  LuClipboardCheck,
  LuClipboardList,
  LuHeadphones,
  LuHistory,
  LuMapPin,
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
import {
  UserNav,
  useLocationSwitch,
  useSwitchCompany,
  useUserNav
} from "./UserNav";

export function AppSidebar({
  activeEvents,
  activeMaintenanceCount,
  openServiceJobCount,
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
  openServiceJobCount: number;
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
  const { optimisticLocation } = useLocationSwitch(location);

  const queues = (
    <QueueLinks
      counts={{
        active: activeEvents,
        maintenance: activeMaintenanceCount,
        service: openServiceJobCount
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
          header={
            <CompanyLink
              company={company}
              locationName={
                locations.find((l) => l.id === optimisticLocation)?.name
              }
            />
          }
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
          consoleMode={consoleMode}
          pinnedInUser={pinnedInUser}
          location={location}
          locations={locations}
          // An operator pinned in at a console station cannot switch company.
          canSwitch={!(consoleMode && pinnedInUser)}
        />
      }
      footer={
        <>
          <BackToErpLink />
          {timeCard}
          <UserNav
            consoleEnabled={consoleEnabled}
            consoleMode={consoleMode}
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
  consoleMode,
  pinnedInUser,
  location,
  locations,
  canSwitch
}: {
  company: Company;
  companies: Company[];
  consoleMode: boolean;
  pinnedInUser: PinnedInUser | null;
  location: string;
  locations: Location[];
  canSwitch: boolean;
}) {
  const { t } = useLingui();
  const mode = useMode();
  const switchCompany = useSwitchCompany();
  // Location follows the phone sheet and the account menu: only another
  // operator pinned in at the station blocks it, not the station user.
  const { updateLocation, optimisticLocation, isOperatorPinnedIn } = useUserNav(
    {
      consoleMode,
      location,
      pinnedInUser
    }
  );
  const locationName = locations.find((l) => l.id === optimisticLocation)?.name;

  const canSwitchCompany = canSwitch && companies.length > 1;
  const canSwitchLocation = !isOperatorPinnedIn && locations.length > 1;

  // Nothing to switch to: the row is the link back to the ERP, as it was.
  if (!canSwitchCompany && !canSwitchLocation) {
    return <CompanyLink company={company} locationName={locationName} />;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <NavRailSwitcher
          label={company.name ?? ""}
          sublabel={locationName}
          logoLight={company.logoLightIcon}
          logoDark={company.logoDarkIcon}
          trailing={<LuChevronsUpDown />}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="min-w-[240px] max-w-[360px]"
      >
        {canSwitchCompany ? (
          <>
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
                    <HStack className="min-w-0">
                      <Avatar
                        size="xs"
                        name={c.name ?? undefined}
                        src={companyLogo ?? undefined}
                      />
                      <span className="truncate">{c.name}</span>
                    </HStack>
                  </DropdownMenuRadioItem>
                );
              })}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
          </>
        ) : null}
        {canSwitchLocation ? (
          <>
            <DropdownMenuLabel>{t`Locations`}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={optimisticLocation}>
              {locations.map((loc) => (
                <DropdownMenuRadioItem
                  key={loc.id}
                  value={loc.id}
                  onSelect={() => {
                    if (loc.id !== optimisticLocation) updateLocation(loc.id);
                  }}
                >
                  <HStack className="min-w-0">
                    <LuMapPin className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{loc.name}</span>
                  </HStack>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
          </>
        ) : null}
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
function CompanyLink({
  company,
  locationName
}: {
  company: Company;
  locationName?: string;
}) {
  return (
    <NavRailSwitcher
      asChild
      label={company.name ?? ""}
      sublabel={locationName}
      logoLight={company.logoLightIcon}
      logoDark={company.logoDarkIcon}
      trailing={<LuArrowUpRight className="md:hidden" />}
    >
      <Link to={ERP_URL} />
    </NavRailSwitcher>
  );
}

/**
 * A labelled way back to the ERP, in the same tab. Desktop and tablet only:
 * on phones the company row at the top of the More sheet leads there.
 */
function BackToErpLink() {
  const { t } = useLingui();

  return (
    <NavRailLink
      to={ERP_URL}
      icon={<LuArrowLeft />}
      label={t`Back to ERP`}
      external
    />
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
    { key: "picking", icon: LuPackageCheck, to: path.to.picking },
    { key: "service", icon: LuHeadphones, to: path.to.service },
    { key: "inspections", icon: LuClipboardCheck, to: path.to.inspections }
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
      picking: t`Picking`,
      service: t`Service`,
      inspections: t`Inspections`
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
    // NavRailItem directly (not NavRailLink) so the name can say the link
    // opens a new tab while the visible label stays "Displays".
    <NavRailItem
      asChild
      icon={<LuMonitorPlay />}
      label={t`Displays`}
      aria-label={t`Displays (opens in new tab)`}
      trailing={
        <LuArrowUpRight className="hidden size-4 text-muted-foreground max-md:block" />
      }
    >
      <Link to={path.to.displays} target="_blank" rel="noreferrer" />
    </NavRailItem>
  );
}
