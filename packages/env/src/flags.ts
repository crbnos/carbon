// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The feature flag registry. Every flag the code reads is declared here once,
// with the value the code uses when no flags source answers. This file is
// safe for the browser: the evaluation lives in `./flags.server`. Flags are
// booleans until one needs another type.

type FlagDefinition = { default: boolean; browser: boolean };

/**
 * `default` is the safe value: what an instance does with no flags source,
 * when the source has no such flag, or when the flag is DISABLED there.
 * `browser: true` sends the evaluated value to React through the
 * authenticated layout loader (`useFeatureFlags().feature(key)`).
 */
export const FLAGS = {
  // Settings → Companies. Carbon staff keep access without it.
  "multi-company-management": { default: false, browser: true },
  // Install of an `internalOnly` integration on Carbon Cloud. Carbon staff
  // keep access without it. Rules name the users and their company.
  "integration-early-access": { default: false, browser: false }
} as const satisfies Record<string, FlagDefinition>;

type Flags = typeof FLAGS;

export type FlagKey = keyof Flags;

export type BrowserFlagKey = {
  [K in FlagKey]: Flags[K]["browser"] extends true ? K : never;
}[FlagKey];

/** What the layout loaders send: the evaluated value of each browser flag. */
export type BrowserFlags = Partial<Record<BrowserFlagKey, boolean>>;

export function flagDefault(key: FlagKey): boolean {
  return FLAGS[key].default;
}

export const BROWSER_FLAG_KEYS = (Object.keys(FLAGS) as FlagKey[]).filter(
  (key) => FLAGS[key].browser
) as BrowserFlagKey[];
