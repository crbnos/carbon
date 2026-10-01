// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

"use client";

import type { Company } from "@carbon/auth";
import {
  NavRail,
  NavRailBrand,
  NavRailGroup,
  NavRailLink,
  useMode,
  useShortcutKeyMap
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { Suspense, useMemo } from "react";
import { BsFillHexagonFill } from "react-icons/bs";
import {
  LuActivity,
  LuCalendarDays,
  LuCirclePlay,
  LuClipboardList,
  LuHistory,
  LuMonitorPlay,
  LuPackageCheck,
  LuWrench
} from "react-icons/lu";
import { Await, useLocation, useNavigate } from "react-router";
import type { Location } from "~/services/types";
import { MES_NAV_SHORTCUTS } from "~/shortcuts";
import type { PinnedInUser } from "~/types";
import { ERP_URL, path } from "~/utils/path";
import { AdjustInventory } from "./AdjustInventory";
import { EndShift } from "./EndShift";
import Suggestion from "./Suggestion";
import { TimeCardButton } from "./TimeCardButton";
import { UserNav } from "./UserNav";

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
  timeCardEnabled
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
}) {
  const { t } = useLingui();

  return (
    <NavRail
      header={<CompanyLink company={company} />}
      footer={
        <>
          {timeCardEnabled && (
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
          )}
          <UserNav
            company={company}
            companies={companies}
            consoleEnabled={consoleEnabled}
            consoleMode={consoleMode}
            location={location}
            locations={locations}
            pinnedInUser={pinnedInUser}
          />
        </>
      }
    >
      <NavRailGroup label={t`Operations`}>
        <QueueLinks
          counts={{
            active: activeEvents,
            maintenance: activeMaintenanceCount
          }}
        />
      </NavRailGroup>
      <NavRailGroup label={t`Inventory Adjustments`}>
        <AdjustInventory add={true} />
        <AdjustInventory add={false} />
      </NavRailGroup>
      <NavRailGroup label={t`Tools`}>
        <EndShift />
        <Suggestion />
        <DisplaysLink />
      </NavRailGroup>
    </NavRail>
  );
}

/** Leads back to the ERP. */
function CompanyLink({ company }: { company: Company }) {
  const mode = useMode();
  const logo = mode === "dark" ? company.logoDarkIcon : company.logoLightIcon;

  return (
    <NavRailBrand
      href={ERP_URL}
      label={company.name ?? ""}
      logo={
        logo ? (
          <img src={logo} alt="" className="size-6 rounded object-contain" />
        ) : (
          <BsFillHexagonFill />
        )
      }
    />
  );
}

type QueueKey = keyof typeof MES_NAV_SHORTCUTS;

/** The task queues, in rail order; each one's ⌥-digit comes from its key. */
const QUEUES: { key: QueueKey; icon: typeof LuActivity; to: string }[] = [
  { key: "operations", icon: LuCalendarDays, to: path.to.operations },
  { key: "assigned", icon: LuClipboardList, to: path.to.assigned },
  { key: "active", icon: LuActivity, to: path.to.active },
  { key: "recent", icon: LuHistory, to: path.to.recent },
  { key: "jobs", icon: LuCirclePlay, to: path.to.jobs },
  { key: "maintenance", icon: LuWrench, to: path.to.maintenance },
  { key: "picking", icon: LuPackageCheck, to: path.to.picking }
];

// `path.to.operations` carries a `?saved=1` query; activity matches on paths.
const pathOf = (to: string) => to.split("?")[0];

function QueueLinks({ counts }: { counts: Partial<Record<QueueKey, number>> }) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const titles: Record<QueueKey, string> = {
    operations: t`Schedule`,
    assigned: t`Assigned`,
    active: t`Active`,
    recent: t`Recent`,
    jobs: t`Jobs`,
    maintenance: t`Maintenance`,
    picking: t`Picking`
  };

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
          isActive={pathname.startsWith(pathOf(queue.to))}
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
    />
  );
}
