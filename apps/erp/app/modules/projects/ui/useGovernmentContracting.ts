// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { usePlanGate } from "~/hooks/usePlanGate";
import { useSettings } from "~/hooks/useSettings";

/**
 * True when the government contracting fields apply to this company: DCAA
 * timekeeping is on, or the company has the GOVERNMENT_CONTRACTING feature.
 * Screens use it to hide cost objective, allowability, FLSA status, CLIN and
 * ACRN, funding actions, leave, business component and research role from a
 * company that never uses them. This is display only — the server gates stay.
 */
export function useGovernmentContracting(): boolean {
  const settings = useSettings();
  const { isGated } = usePlanGate({ feature: "GOVERNMENT_CONTRACTING" });
  return settings.timekeepingControls === "DCAA" || !isGated;
}

/**
 * The element page's Government contracting group. Its fields show only when
 * DCAA timekeeping is on AND the company has the GOVERNMENT_CONTRACTING
 * feature (`fields`). With DCAA on and the feature gated, only earned value's
 * one-row upgrade entry shows (`upgrade`): the licensing rule keeps a gated
 * feature visible. Without DCAA, nothing shows (`hidden`). Display only — the
 * element update route and the ee earned value function keep their gates.
 */
export function useGovernmentContractingFields():
  | "fields"
  | "upgrade"
  | "hidden" {
  const settings = useSettings();
  const { isGated } = usePlanGate({ feature: "GOVERNMENT_CONTRACTING" });
  if (settings.timekeepingControls !== "DCAA") return "hidden";
  return isGated ? "upgrade" : "fields";
}
