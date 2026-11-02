// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { usePlanGate } from "~/hooks/usePlanGate";
import { useSettings } from "~/hooks/useSettings";

/**
 * True when the government contracting fields apply to this company: the
 * Government Contracting switch on Settings → Projects (DCAA) is on. The plan
 * feature does not decide it: a company on a plan with the feature that does
 * not contract with the government sees none of it. Screens use it to hide
 * cost objective, allowability, CLIN and ACRN, funding actions and the
 * government reports from a company that never uses them. This is display
 * only — the server gates stay.
 */
export function useGovernmentContracting(): boolean {
  const settings = useSettings();
  return settings.timekeepingControls === "DCAA";
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
