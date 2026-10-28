// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Client-safe: the ERP's forms and tables import the timings from here, and
// `./sequence` (which pulls in Kysely) re-exports them. The SQL CHECKs on
// companySettings and itemSerialSequence list the same values.
export const serialNumberTimings = [
  "jobCreation",
  "jobRelease",
  "production"
] as const;
export type SerialNumberTiming = (typeof serialNumberTimings)[number];

export function asSerialNumberTiming(
  value: unknown
): SerialNumberTiming | null {
  return serialNumberTimings.find((timing) => timing === value) ?? null;
}
