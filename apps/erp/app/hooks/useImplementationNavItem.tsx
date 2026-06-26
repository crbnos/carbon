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
import { LuRocket } from "react-icons/lu";
import type { Authenticated, NavItem } from "~/types";
import { path } from "~/utils/path";

const NO_SIGNALS = {
  hasItems: false,
  hasMakeMethod: false,
  hasJob: false,
  hasSalesOrder: false,
  hasTrackedEntity: false
};

type AppLayoutData = {
  implementationHub: { tier: Tier; status: HubStatus } | null;
  implementationCheckStates: CheckStateRow[];
  implementationSignals: Signals | null;
};

const isFinished = (status: HubStatus) =>
  status === "complete" || status === "archived";

// Shared reader: the enrolled hub (a row only exists once Carbon enrolls a
// company), or null. Both nav entries below key off this.
function useHub() {
  return (
    useRouteData<AppLayoutData>(path.to.authenticatedRoot)?.implementationHub ??
    null
  );
}

// The pinned "Get Started" primary-nav entry with a remaining-gates badge. Shown
// while a hub is still in progress; gone once it's finished (see reopen entry).
export function useImplementationNavItem(): Authenticated<NavItem> | null {
  const data = useRouteData<AppLayoutData>(path.to.authenticatedRoot);
  const hub = data?.implementationHub;
  if (!hub || isFinished(hub.status)) return null;

  const spine = spineForTier(SPINE, hub.tier);
  const done = gatesDone(
    spine,
    stateMap(data?.implementationCheckStates ?? []),
    data?.implementationSignals ?? NO_SIGNALS
  );
  const remaining = spine.length - done;

  return {
    name: labelForTier(hub.tier),
    to: path.to.getStarted,
    icon: LuRocket,
    tag: remaining > 0 ? remaining : undefined
  };
}

// The quiet "reopen" entry for a finished hub — once onboarding is wrapped up the
// pinned item is gone, so this keeps the hub reachable (Settings → Company).
// Null for unenrolled or still-in-progress hubs.
export function useImplementationReopenItem(): Authenticated<NavItem> | null {
  const hub = useHub();
  if (!hub || !isFinished(hub.status)) return null;

  return {
    name: labelForTier(hub.tier),
    to: path.to.getStarted,
    icon: LuRocket
  };
}
