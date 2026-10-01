// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  type GateSpec,
  planMeetsRequirement,
  resolveRequirement
} from "@carbon/ee/plan";
import { usePlan } from "@carbon/react";
import { useFlags } from "~/hooks/useFlags";

export function usePlanGate(spec: GateSpec) {
  const currentPlan = usePlan();
  const { isCloud, isCommunity } = useFlags();

  const requirement = resolveRequirement(spec);
  const isGated =
    isCommunity || (isCloud && !planMeetsRequirement(currentPlan, requirement));

  return { isGated, plan: currentPlan, allowedPlans: requirement };
}
