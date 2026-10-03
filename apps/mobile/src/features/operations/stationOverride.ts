// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getLocalTimeZone, today } from "@internationalized/date";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * "I have dismissed my manning-board station for today."
 *
 * An operator with a people assignment opens the board on THEIR station — web
 * does the same, and for someone who stands at one machine it is the right
 * default. Web then offers a chip to dismiss it and remembers that in a cookie
 * **for the rest of that day**.
 *
 * The app had the chip but nothing behind it: the flag was component state, so
 * it was forgotten the moment the tab unmounted and the board reopened on one
 * column of a seven-column board every single time. This is the cookie's
 * equivalent — the DATE that was dismissed, so the default returns tomorrow,
 * exactly as it does on the web.
 *
 * Keyed by instance AND company, like every other stored value in this app: a
 * company id is not unique across Carbons, and an operator's station on
 * staging is not their station on production.
 */

const KEY = "station-override.v1";

export type StationScope = { instanceId: string; companyId: string };

const scopeKey = (scope: StationScope) =>
  `${scope.instanceId}:${scope.companyId}`;

type Stored = Record<string, string>;

/** Validates stored JSON rather than trusting it — it is a year-old string. */
export function parseStationOverrides(raw: string | null): Stored {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const out: Stored = {};
    for (const [key, date] of Object.entries(
      value as Record<string, unknown>
    )) {
      if (typeof date === "string") out[key] = date;
    }
    return out;
  } catch {
    // A corrupt blob must not stop the board loading; the default is simply
    // that the station applies, which is the behaviour without this at all.
    return {};
  }
}

/**
 * Whether the dismissal still stands.
 *
 * `serverDate` is the LOCATION's today, which the screen payload reports as
 * `peopleDate` — it is what the server compares against, so it is the
 * authority. `deviceDate` is only an optimistic stand-in for the first request
 * of a session, before any payload has arrived. They differ only for an
 * operator in a different timezone from their plant, or within a few hours of
 * midnight; when they do, the dismissal simply does not apply yet and the
 * board opens on the station until the payload lands and corrects it.
 */
export function isStationDismissed(
  dismissedDate: string | null,
  dates: { deviceDate: string; serverDate?: string | null }
) {
  if (!dismissedDate) return false;
  return (
    dismissedDate === dates.deviceDate || dismissedDate === dates.serverDate
  );
}

/** Today where the device is, as `YYYY-MM-DD`. */
export function deviceToday() {
  return today(getLocalTimeZone()).toString();
}

export async function loadStationOverride(
  scope: StationScope
): Promise<string | null> {
  try {
    const all = parseStationOverrides(await AsyncStorage.getItem(KEY));
    return all[scopeKey(scope)] ?? null;
  } catch {
    return null;
  }
}

export async function saveStationOverride(scope: StationScope, date: string) {
  try {
    const all = parseStationOverrides(await AsyncStorage.getItem(KEY));
    // Yesterday's entry for another company is dead weight, but there is one
    // per (instance, company) at most and it is overwritten daily, so it is
    // bounded — pruning it would cost a read of every key to save bytes.
    all[scopeKey(scope)] = date;
    await AsyncStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // A failed write costs the operator one more tap on the chip, which is
    // better than a crash on a board they are mid-shift on.
  }
}
