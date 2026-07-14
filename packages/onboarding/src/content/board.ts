import { msg } from "@lingui/core/macro";
import { isModuleExcluded } from "../logic/visibility";
import type { BoardTask, Mod } from "../types";
import { SETUP_GROUPS } from "./setup";

// Configure's checklist is one task per Setup Map module group (Settings,
// Resources, People, ...) rather than a hand-picked bundle of rows — the two
// pages were listing different things for the same work, which read as
// disconnected. Generated from SETUP_GROUPS so the two can't drift apart in
// shape, only `key` is hand-assigned (stable across a group's `n`/title
// changing).
const CONFIGURE_GROUP_KEYS: Record<number, string> = {
  1: "setup-accounting",
  2: "setup-settings",
  3: "setup-resources",
  4: "setup-people",
  5: "setup-items",
  6: "setup-sales",
  7: "setup-purchasing",
  8: "setup-inventory",
  9: "setup-production"
};

// Stable key for a Setup Map group, shared by the Configure task (its `key`) and
// the Setup Map section's DOM anchor so the Plan → Setup Map deep link lines up.
export const setupGroupKey = (n: number): string =>
  CONFIGURE_GROUP_KEYS[n] ?? `setup-group-${n}`;

const CONFIGURE_GROUP_TASKS: BoardTask[] = SETUP_GROUPS.map((group) => ({
  key: setupGroupKey(group.n),
  label: group.title,
  stepKey: "gate:configure",
  owner: "carbon",
  setupKeys: group.rows.map((row) => row.key),
  docsUrl: group.docsUrl,
  academyUrl: group.academyUrl,
  hint: group.desc
}));

// Setup row key → its module tags, for scoping derived tasks the same way the
// Setup Map scopes its rows.
const SETUP_ROW_TAGS = new Map<string, Mod[] | undefined>(
  SETUP_GROUPS.flatMap((group) =>
    group.rows.map((row) => [row.key, row.moduleTags] as const)
  )
);

// Drop excluded-module rows from setup-derived tasks — and the whole task when
// nothing remains — mirroring the Setup Map, where an excluded module's group
// disappears. Without this the Plan would show an unfinishable task whose rows
// the customer can never see or configure.
export function boardTasksForScope(
  tasks: BoardTask[],
  excludedModules: Mod[]
): BoardTask[] {
  return tasks.flatMap((task) => {
    if (!task.setupKeys?.length) return task;
    const setupKeys = task.setupKeys.filter(
      (key) => !isModuleExcluded(SETUP_ROW_TAGS.get(key), excludedModules)
    );
    return setupKeys.length ? { ...task, setupKeys } : [];
  });
}

// Starter Project Board tasks, grouped under the six spine steps. Keys match the
// prototype's boardKeys. Each task's status lives in implementationCheckState
// (kind "task", itemKey = taskKey(key)); the Plan page derives its checklist
// from the same rows. A task with `setupKeys` instead derives its status from
// those Setup Map rows' "configured" flags (see logic/board.ts taskStatus) —
// it has no manual tick of its own.
export const BOARD_TASKS: BoardTask[] = [
  {
    key: "kickoff",
    label: msg`Agree who owns what and set a working rhythm`,
    stepKey: "gate:discovery",
    owner: "shared"
  },
  {
    key: "process-mapped",
    label: msg`Walk your current process, systems, and data`,
    stepKey: "gate:discovery",
    owner: "shared"
  },
  {
    key: "scope-signed",
    label: msg`Confirm and sign the scope`,
    stepKey: "gate:discovery",
    owner: "shared"
  },
  ...CONFIGURE_GROUP_TASKS,
  {
    key: "integrations",
    label: msg`Build any net-new integrations or customizations`,
    stepKey: "gate:configure",
    owner: "carbon",
    // Paid-tier only — self-serve uses standard cloud Carbon, no custom build
    // (mirrors the gated prod:configure-netnew spine step).
    tiers: ["guided", "enterprise"]
  },
  {
    key: "hosting",
    label: msg`Stand up hosting (cloud or self-hosted)`,
    stepKey: "gate:configure",
    owner: "carbon",
    // Paid-tier only — self-serve is managed cloud, nothing to stand up
    // (mirrors the gated prod:configure-hosting spine step).
    tiers: ["guided", "enterprise"]
  },
  {
    key: "data-loaded",
    label: msg`Pull, map, and load your data`,
    stepKey: "gate:migrate",
    owner: "carbon",
    // Paid-tier only — self-serve has no data-migration gate (see spine).
    tiers: ["guided", "enterprise"]
  },
  {
    key: "data-validated",
    label: msg`Validate a sample and approve the migrated data`,
    stepKey: "gate:migrate",
    owner: "you",
    tiers: ["guided", "enterprise"]
  },
  {
    key: "training-materials",
    label: msg`Build role-based training materials`,
    stepKey: "gate:train",
    owner: "carbon"
  },
  {
    key: "champions-trained",
    label: msg`Run hands-on sessions and sign off your team`,
    stepKey: "gate:train",
    owner: "you"
  },
  {
    key: "acceptance-passed",
    label: msg`Run the acceptance checklist to a pass`,
    stepKey: "gate:acceptance",
    owner: "shared",
    // Paid-tier only — self-serve has no formal acceptance gate (see spine).
    tiers: ["guided", "enterprise"]
  },
  {
    key: "cutover",
    label: msg`Cut over to Carbon and freeze the old system`,
    stepKey: "gate:golive",
    owner: "shared"
  },
  {
    key: "hypercare",
    label: msg`Hypercare: intense support for the first weeks`,
    stepKey: "gate:golive",
    owner: "shared",
    // Paid-tier only — self-serve has no Carbon team for post-launch hypercare.
    tiers: ["guided", "enterprise"]
  }
];
