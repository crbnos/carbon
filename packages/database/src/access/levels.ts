// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/** One choice per page; each level holds every action of the levels below it. */
export const LEVELS = ["None", "View", "Create", "Edit", "Full"] as const;
export type Level = (typeof LEVELS)[number];

export const ACTIONS = ["view", "create", "update", "delete"] as const;
export type Action = (typeof ACTIONS)[number];

/** The lowest level that holds an action. */
export const ACTION_LEVEL: Record<Action, Level> = {
  view: "View",
  create: "Create",
  update: "Edit",
  delete: "Full"
};

export function levelHolds(level: Level, action: Action): boolean {
  return LEVELS.indexOf(level) >= LEVELS.indexOf(ACTION_LEVEL[action]);
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
 * Flat `<module>_<action>` keys (an API key's old scopes) as one level per
 * module, for the keys that name the company.
 */
export function levelsFromKeys(
  keys: Record<string, unknown>,
  companyId: string
): Record<string, Level> {
  const flags: Record<string, Partial<Record<Action, boolean>>> = {};
  for (const [key, companies] of Object.entries(keys)) {
    const match = key.match(/^(.+)_(view|create|update|delete)$/);
    if (!match || !Array.isArray(companies) || !companies.includes(companyId))
      continue;
    const [, module, action] = match as [string, string, Action];
    flags[module] = { ...flags[module], [action]: true };
  }
  return Object.fromEntries(
    Object.entries(flags).map(([module, f]) => [module, roundUp(f)])
  );
}
