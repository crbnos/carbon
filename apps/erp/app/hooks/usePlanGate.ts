import {
  type GateSpec,
  planMeetsRequirement,
  resolveRequirement
} from "@carbon/ee/plan";
import { usePlan } from "@carbon/react";
import { useFlags } from "~/hooks/useFlags";

export function usePlanGate(spec: GateSpec) {
  const currentPlan = usePlan();
  const { isCloud, isCommunity, isLocalDev } = useFlags();

  const requirement = resolveRequirement(spec);
  const isGated =
    "feature" in spec && spec.feature === "API_KEYS" && isLocalDev
      ? false
      : isCommunity ||
        (isCloud && !planMeetsRequirement(currentPlan, requirement));

  return { isGated, plan: currentPlan, allowedPlans: requirement };
}
