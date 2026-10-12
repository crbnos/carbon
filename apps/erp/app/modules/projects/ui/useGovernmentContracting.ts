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
