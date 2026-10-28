// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Derived Plan state shared by every view that lists board tasks: which tasks
// the hub shows, and the overdue cascade over them.

import { getLocalTimeZone, today } from "@internationalized/date";
import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import { DEPENDENCIES } from "../../content/dependencies";
import {
  gateDueDates,
  type OverdueCascade,
  overdueCascade,
  planTasks,
  resolveTimeline
} from "../../logic";
import type { BoardTask, StepDef } from "../../types";
import {
  useCheckMap,
  useCounts,
  useExclusions,
  useFieldMap,
  useTier
} from "./HubProvider";

// The Plan's tasks for this hub (logic/readiness.ts `planTasks`): the tier's
// phases, the modules in scope, and the operational tasks that are ready. Count
// progress from this list only, so a hidden task counts nowhere.
export function usePlanTasks(): BoardTask[] {
  const tier = useTier();
  const exclusions = useExclusions();
  const counts = useCounts();
  const map = useCheckMap();
  return useMemo(
    () => planTasks(tier, exclusions.modules, counts, map),
    [tier, exclusions.modules, counts, map]
  );
}

export interface PlanCascade extends OverdueCascade {
  // Each gate's date (step key → YYYY-MM-DD); empty when the hub has no dates.
  gateDates: Map<string, string>;
  // The viewer's today, YYYY-MM-DD.
  today: string;
}

// The overdue cascade for these tier-filtered steps, against the viewer's
// local today.
export function useOverdueCascade(steps: StepDef[]): PlanCascade {
  const { i18n } = useLingui();
  const map = useCheckMap();
  const fields = useFieldMap();
  const tasks = usePlanTasks();
  const day = today(getLocalTimeZone()).toString();
  const gateDates = gateDueDates(resolveTimeline(steps, fields, i18n));
  return {
    gateDates,
    today: day,
    ...overdueCascade(tasks, map, gateDates, day, DEPENDENCIES)
  };
}
