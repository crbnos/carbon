import { msg } from "@lingui/core/macro";
import { isModuleExcluded } from "../logic/visibility";
import type { BoardTask, Mod } from "../types";
import { SETUP_GROUPS } from "./setup";

// Set Up the Basics' checklist is one task per Setup Map module group (Settings,
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

// Stable key for a Setup Map group, shared by the Basics task (its `key`) and
// the Setup Map section's DOM anchor so the Plan → Setup Map deep link lines up.
export const setupGroupKey = (n: number): string =>
  CONFIGURE_GROUP_KEYS[n] ?? `setup-group-${n}`;

const SETUP_GROUP_TASKS: BoardTask[] = SETUP_GROUPS.map((group) => ({
  key: setupGroupKey(group.n),
  label: group.title,
  stepKey: "gate:basics",
  owner: "you",
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

// Starter Project Plan tasks, grouped under the seven spine phases. Each task's
// status lives in implementationCheckState (kind "task", itemKey = taskKey(key));
// the Plan page derives its checklist from the same rows. A task with
// `setupKeys` instead derives its status from those Setup Map rows' "configured"
// flags (see logic/board.ts taskStatus) — it has no manual tick of its own.
// Several tasks are completed programmatically by their flow (the intake wizard,
// the First Win, the freeze-plan form) writing the same task check state.
export const BOARD_TASKS: BoardTask[] = [
  // 1 · Tell Us How You Run
  {
    key: "intake-answers",
    label: msg`Answer the questions — about ten minutes`,
    stepKey: "gate:intake",
    owner: "you"
  },
  {
    key: "intake-first-win",
    label: msg`See your first part in Carbon`,
    stepKey: "gate:intake",
    owner: "you"
  },
  {
    key: "intake-commit",
    label: msg`Confirm your go-live date and owner`,
    stepKey: "gate:intake",
    owner: "you"
  },
  // 2 · Set Up the Basics
  {
    key: "decisions",
    label: msg`Make the five decisions that are expensive to change later`,
    stepKey: "gate:basics",
    owner: "you",
    hint: msg`Part numbering, costing, where the books live, lot and serial policy, purchase approvals.`
  },
  ...SETUP_GROUP_TASKS,
  {
    key: "integrations",
    label: msg`Build any net-new integrations or customizations`,
    stepKey: "gate:basics",
    owner: "carbon",
    // Paid-tier only — self-serve uses standard cloud Carbon, no custom build
    // (mirrors the gated prod:configure-netnew spine step).
    tiers: ["guided", "enterprise"]
  },
  {
    key: "hosting",
    label: msg`Stand up hosting (cloud or self-hosted)`,
    stepKey: "gate:basics",
    owner: "carbon",
    // Paid-tier only — self-serve is managed cloud, nothing to stand up
    // (mirrors the gated prod:configure-hosting spine step).
    tiers: ["guided", "enterprise"]
  },
  // 3 · Load Your Data
  {
    key: "load-customers",
    label: msg`Customers and their contacts`,
    stepKey: "gate:load-data",
    owner: "you"
  },
  {
    key: "load-suppliers",
    label: msg`Suppliers and their contacts`,
    stepKey: "gate:load-data",
    owner: "you"
  },
  {
    key: "load-items",
    label: msg`Items — active in the last year first`,
    stepKey: "gate:load-data",
    owner: "you"
  },
  {
    key: "load-boms",
    label: msg`BOMs and routings — what you ship this quarter first`,
    stepKey: "gate:load-data",
    owner: "you"
  },
  {
    key: "load-spot-check",
    label: msg`Spot-check five records of each and mark them loaded`,
    stepKey: "gate:load-data",
    owner: "you"
  },
  // 4 · Prove It Works
  {
    key: "pilot-pick",
    label: msg`Pick one real, recently completed order`,
    stepKey: "gate:pilot",
    owner: "you",
    hint: msg`The one you make all the time — explicitly not the weird one.`
  },
  {
    key: "pilot-run",
    label: msg`Run it end to end and watch the trace fill in`,
    stepKey: "gate:pilot",
    owner: "you"
  },
  {
    key: "pilot-lap-two",
    label: msg`Lap two: now your gnarliest one`,
    stepKey: "gate:pilot",
    owner: "you",
    hint: msg`Recommended for standard and complex factories; skippable for simple ones.`
  },
  // 5 · Ready Your Team
  {
    key: "crew-champions",
    label: msg`Name a champion for each area`,
    stepKey: "gate:crew",
    owner: "you"
  },
  {
    key: "crew-signoff",
    label: msg`Champions do real tasks in their area and sign off`,
    stepKey: "gate:crew",
    owner: "you"
  },
  {
    key: "crew-floor-pilot",
    label: msg`Three jobs through the pilot floor station`,
    stepKey: "gate:crew",
    owner: "you"
  },
  {
    key: "training-materials",
    label: msg`Run live role-by-role training sessions`,
    stepKey: "gate:crew",
    owner: "carbon",
    // Paid-tier only — self-serve trains through the in-app courses and champions.
    tiers: ["guided", "enterprise"]
  },
  // 6 · Make the Switch
  {
    key: "switch-tminus",
    label: msg`Work the T-minus plan: open orders in, stock counted`,
    stepKey: "gate:switch",
    owner: "you"
  },
  {
    key: "freeze-plan",
    label: msg`Sign the old-system freeze plan`,
    stepKey: "gate:switch",
    owner: "you"
  },
  {
    key: "cutover",
    label: msg`Switch day: work the checklist and make the call`,
    stepKey: "gate:switch",
    owner: "shared"
  },
  // 7 · Live on Carbon
  {
    key: "live-streak",
    label: msg`Ten straight business days of real usage`,
    stepKey: "gate:live",
    owner: "you"
  },
  {
    key: "hypercare",
    label: msg`Hypercare: intense support for the first weeks`,
    stepKey: "gate:live",
    owner: "shared",
    // Paid-tier only — self-serve has no Carbon team for post-launch hypercare.
    tiers: ["guided", "enterprise"]
  }
];
