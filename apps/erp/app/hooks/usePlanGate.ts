// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { LICENCE_ENFORCED } from "@carbon/ee/license";
import {
  type GateSpec,
  planMeetsRequirement,
  resolveRequirement
} from "@carbon/ee/plan";
import { useFeatures, usePlan } from "@carbon/react";
import { useFlags } from "~/hooks/useFlags";

export function usePlanGate(spec: GateSpec) {
  const currentPlan = usePlan();
  const features = useFeatures();
  const { isCloud, isCommunity, isEnterprise } = useFlags();

  const requirement = resolveRequirement(spec);
  const missesPlan = !planMeetsRequirement(currentPlan, requirement);
  // Enterprise follows the server's licence answer per feature. A plan
  // spec reads the licence plan, and like the server allows everything
  // while licences are not enforced.
  const isGated =
    isCommunity ||
    (isCloud && missesPlan) ||
    (isEnterprise &&
      (spec.feature
        ? features[spec.feature] !== true
        : LICENCE_ENFORCED && missesPlan));

  return { isGated, plan: currentPlan, allowedPlans: requirement };
}
