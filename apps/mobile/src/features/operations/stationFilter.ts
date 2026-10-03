// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * "Show me only my manning-board station."
 *
 * **Off by default, which is the opposite of web, on purpose.** Web MES mostly
 * runs on a terminal bolted to one machine, so opening on that machine's
 * station is right there. This app is a tablet an operator CARRIES between
 * machines — it is why the operation header shows a work centre at all, which
 * web's does not — so the board opens on the whole floor and the station is
 * something you ask for.
 *
 * It had been the other way round, matching web. The result was a board that
 * reopened on one column of a seven-column board every time, with six work
 * centres apparently missing and no indication that a filter was responsible.
 *
 * Stored per instance AND company, like every other value this app keeps: a
 * company id is not unique across Carbons, and a station on staging is not a
 * station on production. A plain boolean, not a date — the server resolves
 * "my station" fresh each day, so wanting it is a standing preference, not
 * something that should lapse overnight.
 */

const KEY = "station-filter.v1";

export type StationScope = { instanceId: string; companyId: string };

const scopeKey = (scope: StationScope) =>
  `${scope.instanceId}:${scope.companyId}`;

type Stored = Record<string, boolean>;

/** Validates stored JSON rather than trusting it — it is a year-old string. */
export function parseStationFilters(raw: string | null): Stored {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const out: Stored = {};
    for (const [key, on] of Object.entries(value as Record<string, unknown>)) {
      if (typeof on === "boolean") out[key] = on;
    }
    return out;
  } catch {
    // A corrupt blob must not stop the board loading, and the default it falls
    // back to — the whole floor — is the safe one: nothing is hidden.
    return {};
  }
}

export async function loadStationFilter(scope: StationScope): Promise<boolean> {
  try {
    const all = parseStationFilters(await AsyncStorage.getItem(KEY));
    return all[scopeKey(scope)] ?? false;
  } catch {
    return false;
  }
}

export async function saveStationFilter(scope: StationScope, on: boolean) {
  try {
    const all = parseStationFilters(await AsyncStorage.getItem(KEY));
    all[scopeKey(scope)] = on;
    await AsyncStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // A failed write costs the operator one tap next launch, which is better
    // than a crash on a board they are mid-shift on.
  }
}
