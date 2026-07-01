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
