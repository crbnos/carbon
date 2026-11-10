// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Constants } from "../constants";

/**
 * One choice per page; each level holds every action of the levels below it.
 * The `permissionLevel` enum, in its order: SQL compares levels with `>=`.
 */
export const LEVELS = Constants.public.Enums.permissionLevel;
export type Level = (typeof LEVELS)[number];

export const ACTIONS = ["view", "create", "update", "delete"] as const;
export type Action = (typeof ACTIONS)[number];

/** A level a gate can ask for: `"None"` asks for nothing. */
export type GateLevel = Exclude<Level, "None">;

/** The lowest level that holds an action. */
export const ACTION_LEVEL: Record<Action, GateLevel> = {
  view: "View",
  create: "Create",
  update: "Edit",
  delete: "Full"
};

/** The highest action a level holds: the one a gate's check reads. */
export const LEVEL_ACTION = Object.fromEntries(
  ACTIONS.map((action) => [ACTION_LEVEL[action], action])
) as Record<GateLevel, Action>;

export function levelHolds(level: Level, action: Action): boolean {
  return LEVELS.indexOf(level) >= LEVELS.indexOf(ACTION_LEVEL[action]);
}

export function levelReaches(level: Level, atLeast: Level): boolean {
  return LEVELS.indexOf(level) >= LEVELS.indexOf(atLeast);
}

/**
 * The lowest level that holds every granted flag: how the old four
 * checkboxes convert. View and update without create becomes Edit.
 */
export function roundUp(flags: Partial<Record<Action, boolean>>): Level {
  return LEVELS.find((level) =>
    ACTIONS.every((action) => !flags[action] || levelHolds(level, action))
  ) as Level;
}

export function lowerLevel(a: Level, b: Level): Level {
  return LEVELS.indexOf(a) <= LEVELS.indexOf(b) ? a : b;
}

/**
 * The actions a converted grant holds that its old checkboxes did not: what
 * the round-up gave. Empty for a grant saved since.
 */
export function actionsGained(
  level: Level,
  convertedFrom: readonly string[] | null
): Action[] {
  if (!convertedFrom) return [];
  return ACTIONS.filter(
    (action) => levelHolds(level, action) && !convertedFrom.includes(action)
  );
}

/**
 * `<subject>_<action>`: the key claims, audit events and SQL helpers carry.
 * The subject is a page id (`inventory.receipts`), a legacy module id
 * (`inventory`, no dot) or a portal key (`customerPortal`).
 */
export function permissionKey(subject: string, action: Action): string {
  return `${subject}_${action}`;
}

const ACTION_SET = new Set<string>(ACTIONS);

export function parsePermissionKey(
  key: string
): { subject: string; action: Action } | null {
  const cut = key.lastIndexOf("_");
  if (cut <= 0) return null;
  const action = key.slice(cut + 1);
  if (!ACTION_SET.has(action)) return null;
  return { subject: key.slice(0, cut), action: action as Action };
}
