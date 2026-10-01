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
import { type ReactNode, Suspense } from "react";
import { LuRocket } from "react-icons/lu";
import { Await } from "react-router";
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

export type ImplementationHubData = {
  implementationHub: { tier: Tier; status: HubStatus } | null;
  implementationCheckStates: CheckStateRow[];
  implementationSignals: Signals | null;
};

const isFinished = (status: HubStatus) =>
  status === "complete" || status === "archived";

// Shared reader: the enrolled hub (a row only exists once the company is
// enrolled), or null. Both nav entries below key off this.
function useImplementationPromise() {
  return useRouteData<{ implementation?: Promise<ImplementationHubData> }>(
    path.to.authenticatedRoot
  )?.implementation;
}

// Rendered through Await so it streams in the server HTML. The last value is
// the fallback, so a revalidation doesn't blank what is on screen.
export function ImplementationData({
  children
}: {
  children: (data: ImplementationHubData) => ReactNode;
}) {
  const promise = useImplementationPromise();
  const last = useResolved(promise, null);
  if (!promise) return null;
  const fallback = <>{last ? children(last) : null}</>;
  return (
    <Suspense fallback={fallback}>
      {/* Without errorElement a rejected stream reaches the route error boundary. */}
      <Await resolve={promise} errorElement={fallback}>
        {children}
      </Await>
    </Suspense>
  );
}

function useHub() {
  return useResolved(useImplementationPromise(), null)?.implementationHub;
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
    tag: remaining > 0 ? remaining : undefined
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
