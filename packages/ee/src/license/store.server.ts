// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { redis } from "@carbon/kv";
import { EMPTY_STATE, type VerifierState } from "./types";

const KEY = "licence:v1";

/**
 * What survives a restart. Every sealed licence read from here is verified
 * again, so a written value can only make a licence fail, never grant one.
 */
export type StoredLicence = {
  /** The newest sealed renewal, crbn.v1.<sealed>. Never the key. */
  sealed: string | null;
  licenseId: string | null;
  issuedAt: string | null;
  state: VerifierState;
  revokedLicenseId: string | null;
  lastCheckInAt: string | null;
  lastCheckInStatus: string | null;
  lastCheckInError: string | null;
  nextCheckInAt: string | null;
  checkInFailures: number;
  /** Seats counted at the last check-in. */
  seatsUsed: number | null;
};

/**
 * Null for a missing key, an outage or a bad value. `@carbon/kv` answers
 * empty for a miss and an outage alike; both mean "start from CARBON_LICENSE".
 * A field that does not parse reads as missing.
 */
export async function readStoredLicence(): Promise<StoredLicence | null> {
  const fields = await redis.hgetall(KEY);
  if (!fields || typeof fields !== "object") return null;
  const entries = Object.entries(fields).flatMap(([field, raw]) => {
    try {
      return [[field, JSON.parse(raw)] as const];
    } catch {
      return [];
    }
  });
  if (entries.length === 0) return null;
  return { ...EMPTY_STORED, ...Object.fromEntries(entries) };
}

export const EMPTY_STORED: StoredLicence = {
  sealed: null,
  licenseId: null,
  issuedAt: null,
  state: EMPTY_STATE,
  revokedLicenseId: null,
  lastCheckInAt: null,
  lastCheckInStatus: null,
  lastCheckInError: null,
  nextCheckInAt: null,
  checkInFailures: 0,
  seatsUsed: null
};

/**
 * Writes the fields of `patch`, one JSON value per hash field. One HSET is
 * atomic, so writers of different fields (the resolver's state, the
 * check-in's renewal and revocation) never undo each other.
 */
export async function updateStoredLicence(
  patch: Partial<StoredLicence>
): Promise<void> {
  const fields = Object.entries(patch).flatMap(([field, value]) =>
    value === undefined ? [] : [field, JSON.stringify(value)]
  );
  if (fields.length > 0) await redis.hset(KEY, ...fields);
}
