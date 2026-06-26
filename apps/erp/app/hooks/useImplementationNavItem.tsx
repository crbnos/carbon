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

// The pinned "Get Started" / "Implementation" primary-nav entry with a
// remaining-gates badge. Null unless the company has an active hub. Computed
// from stored gate state only (detection runs inside the hub route).
export function useImplementationNavItem(): Authenticated<NavItem> | null {
  const data = useRouteData<AppLayoutData>(path.to.authenticatedRoot);
  const hub = data?.implementationHub;
  // Visible to anyone in an enrolled company — a hub row only exists once Carbon
  // enrolls them (Cloud auto-seed or the manual enroll button).
  if (!hub) return null;
  if (hub.status === "complete" || hub.status === "archived") return null;

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

// The quiet "reopen" entry for a finished hub. Once onboarding is wrapped up the
// prominent pinned item above is gone; this lives in the bottom (Settings) nav
// group so the hub is still reachable without re-hijacking the app. Null unless
// the company was enrolled (a hub row only exists once Carbon enrolls it) and
// that hub is completed/archived — never shown to unenrolled existing customers.
export function useImplementationReopenItem(): Authenticated<NavItem> | null {
  const data = useRouteData<AppLayoutData>(path.to.authenticatedRoot);
  const hub = data?.implementationHub;
  if (!hub) return null;
  if (hub.status !== "complete" && hub.status !== "archived") return null;

  return {
    name: labelForTier(hub.tier),
    to: path.to.getStarted,
    icon: LuRocket
  };
}
