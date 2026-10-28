// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The feature flag registry. Every flag the code reads is declared here once,
// with the value the code uses when no flags source answers. This file is
// safe for the browser: the evaluation lives in `./flags.server`.

type FlagDefinition =
  | { type: "boolean"; default: boolean; browser: boolean }
  | { type: "string"; default: string; browser: boolean }
  | { type: "number"; default: number; browser: boolean };

/**
 * `default` is the safe value: what an instance does with no flags source,
 * when the source has no such flag, or when the flag is DISABLED there.
 * `browser: true` sends the evaluated value to React through the
 * authenticated layout loader (`useFlags().feature(key)`).
 */
export const FLAGS = {
  // Settings → Companies. Carbon staff keep access without it.
  "multi-company-management": {
    type: "boolean",
    default: false,
    browser: true
  },
  // Install of an `internalOnly` integration on Carbon Cloud. Carbon staff
  // keep access without it. Rules name the users and their company.
  "integration-early-access": {
    type: "boolean",
    default: false,
    browser: false
  }
} as const satisfies Record<string, FlagDefinition>;

type Flags = typeof FLAGS;

export type FlagKey = keyof Flags;

type ValueOfType<T> = T extends "boolean"
  ? boolean
  : T extends "string"
    ? string
    : number;

export type FlagValue<K extends FlagKey> = ValueOfType<Flags[K]["type"]>;

/** The keys whose value has the given type. */
export type FlagKeyOf<T extends FlagDefinition["type"]> = {
  [K in FlagKey]: Flags[K]["type"] extends T ? K : never;
}[FlagKey];

export type BrowserFlagKey = {
  [K in FlagKey]: Flags[K]["browser"] extends true ? K : never;
}[FlagKey];

/** What the layout loaders send: the evaluated value of each browser flag. */
export type BrowserFlags = { [K in BrowserFlagKey]?: FlagValue<K> };

export function flagDefault<K extends FlagKey>(key: K): FlagValue<K> {
  return FLAGS[key].default as FlagValue<K>;
}

export const BROWSER_FLAG_KEYS = (Object.keys(FLAGS) as FlagKey[]).filter(
  (key) => FLAGS[key].browser
) as BrowserFlagKey[];
