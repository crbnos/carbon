// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { MeResponse } from "@carbon/mes-core";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Which company and location this device is working in, per linked Carbon.
 *
 * The web keeps the chosen company in its session cookie, so a browser comes
 * back to the company it left. The app kept it in component state, so every
 * launch fell back to "the first company by name" — which for an account in
 * two companies is not the one the web opened, and which is how a developer
 * ended up looking at one company's work centres on a tablet and another's in
 * a browser with nothing on screen saying so.
 *
 * Not a secret, so AsyncStorage rather than SecureStore. Keyed by INSTANCE: a
 * company id on staging is not the same company on production.
 */

const KEY = "work-context.v1";

export type WorkContext = {
  companyId: string | null;
  locationId: string | null;
};

type Stored = Record<string, WorkContext>;

/** Validates stored JSON rather than trusting it — it is a year-old string. */
export function parseWorkContexts(raw: string | null): Stored {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const out: Stored = {};
    for (const [key, entry] of Object.entries(
      value as Record<string, unknown>
    )) {
      if (!entry || typeof entry !== "object") continue;
      const { companyId, locationId } = entry as Record<string, unknown>;
      out[key] = {
        companyId: typeof companyId === "string" ? companyId : null,
        locationId: typeof locationId === "string" ? locationId : null
      };
    }
    return out;
  } catch {
    return {};
  }
}

export async function loadWorkContext(
  instanceId: string
): Promise<WorkContext | null> {
  try {
    return (
      parseWorkContexts(await AsyncStorage.getItem(KEY))[instanceId] ?? null
    );
  } catch {
    return null;
  }
}

export async function saveWorkContext(
  instanceId: string,
  context: WorkContext
) {
  try {
    const all = parseWorkContexts(await AsyncStorage.getItem(KEY));
    all[instanceId] = context;
    await AsyncStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // A failed write costs one tap on the picker next launch, which is better
    // than a crash at sign-in.
  }
}

export async function clearWorkContext(instanceId: string) {
  try {
    const all = parseWorkContexts(await AsyncStorage.getItem(KEY));
    delete all[instanceId];
    await AsyncStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Nothing to recover: a context that survives is validated against the
    // next account's own companies before it is used.
  }
}

/**
 * The company to work in, or null when the operator has to choose.
 *
 * A remembered company wins while the account still belongs to it. Otherwise
 * an account with exactly ONE company has nothing to choose. An account with
 * several is never assigned one silently: "first by name" is an accident of
 * spelling, the web's own default follows a different rule, and a wrong guess
 * shows a plausible, fully working board for the wrong company.
 */
export function chooseCompany(
  companies: MeResponse["companies"],
  stored: WorkContext | null
): string | null {
  if (stored?.companyId && companies.some((c) => c.id === stored.companyId)) {
    return stored.companyId;
  }
  if (companies.length === 1) return companies[0]?.id ?? null;
  return null;
}

/**
 * The location to open on, given a `/me` payload that was read FOR `companyId`.
 *
 * `/me` reports one company's locations — the company named by the request —
 * so a payload read for a different company says nothing about this one, and
 * the answer is null rather than a location id from another tenant.
 *
 * Within the right payload: the remembered location while it still exists,
 * else the employee's own default, else the first. The default is the row the
 * web shell reads too, so both open in the same place.
 */
export function chooseLocation(
  me: Pick<MeResponse, "locations" | "defaultLocationId">,
  companyId: string | null,
  stored: WorkContext | null
): string | null {
  if (!companyId) return null;
  const locations = me.locations.filter((l) => l.companyId === companyId);
  if (locations.length === 0) return null;

  if (
    stored?.companyId === companyId &&
    stored.locationId &&
    locations.some((l) => l.id === stored.locationId)
  ) {
    return stored.locationId;
  }
  if (
    me.defaultLocationId &&
    locations.some((l) => l.id === me.defaultLocationId)
  ) {
    return me.defaultLocationId;
  }
  return locations[0]?.id ?? null;
}
