// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  type CheckStateRow,
  gatesDone,
  type HubStatus,
  labelForTier,
  type Signals,
  SPINE,
  spineForTier,
  stateMap,
  type Tier
} from "@carbon/onboarding";
import { useRouteData } from "@carbon/react";
import type { I18n } from "@lingui/core";
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { LuRocket } from "react-icons/lu";
import type { Authenticated, NavItem } from "~/types";
import { path } from "~/utils/path";
import { useResolved } from "./useResolved";

const NO_SIGNALS = {
  hasItems: false,
  hasMakeMethod: false,
  hasJob: false,
  hasSalesOrder: false,
  hasTrackedEntity: false
};

type ImplementationProgress = {
  checkStates: CheckStateRow[];
  signals: Signals | null;
};

export type ImplementationHubData = {
  implementationHub: { tier: Tier; status: HubStatus } | null;
  implementationCheckStates: CheckStateRow[];
  implementationSignals: Signals | null;
  // False until the streamed progress lands. Until then the counts are not
  // known: show the item and the card, leave the numbers out.
  ready: boolean;
};

const isFinished = (status: HubStatus) =>
  status === "complete" || status === "archived";

// Shared reader. The hub row (null until the company enrols) is awaited by the
// layout loader; progress is streamed and fills in after.
function useImplementation(): ImplementationHubData | undefined {
  const data = useRouteData<{
    implementationHub?: ImplementationHubData["implementationHub"];
    implementationProgress?: Promise<ImplementationProgress>;
  }>(path.to.authenticatedRoot);
  const progress = useResolved(data?.implementationProgress, null);
  if (!data) return undefined;
  return {
    implementationHub: data.implementationHub ?? null,
    implementationCheckStates: progress?.checkStates ?? [],
    implementationSignals: progress?.signals ?? null,
    ready: progress !== null
  };
}

// Whether the item and the card exist is known at first paint, so neither
// arrives late and pushes the page around.
export function ImplementationData({
  children
}: {
  children: (data: ImplementationHubData) => ReactNode;
}) {
  const data = useImplementation();
  return data ? <>{children(data)}</> : null;
}

function useHub() {
  return useImplementation()?.implementationHub;
}

// The pinned "Get Started" primary-nav entry with a remaining-gates badge. Shown
// while a hub is still in progress; gone once it's finished (see reopen entry).
export function getImplementationNavItem(
  data: ImplementationHubData,
  i18n: I18n
): Authenticated<NavItem> | null {
  const hub = data.implementationHub;
  if (!hub || isFinished(hub.status)) return null;

  const spine = spineForTier(SPINE, hub.tier);
  const done = gatesDone(
    spine,
    stateMap(data.implementationCheckStates),
    data.implementationSignals ?? NO_SIGNALS
  );
  const remaining = spine.length - done;

  return {
    name: i18n._(labelForTier(hub.tier)),
    to: path.to.getStarted,
    icon: LuRocket,
    tag: data.ready && remaining > 0 ? remaining : undefined
  };
}

// The quiet "reopen" entry for a finished hub — once onboarding is wrapped up the
// pinned item is gone, so this keeps the hub reachable (Settings → Company).
// Null for unenrolled or still-in-progress hubs.
export function useImplementationReopenItem(): Authenticated<NavItem> | null {
  const { i18n } = useLingui();
  const hub = useHub();
  if (!hub || !isFinished(hub.status)) return null;

  return {
    name: i18n._(labelForTier(hub.tier)),
    to: path.to.getStarted,
    icon: LuRocket
  };
}
