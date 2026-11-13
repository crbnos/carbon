// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { Edition, Plan } from "@carbon/utils";
import { parseAbsolute, type ZonedDateTime } from "@internationalized/date";
import {
  ACCESS_CONTROL_FEATURES,
  type Feature,
  type GateSpec,
  planMeetsRequirement,
  resolveRequirement
} from "../plan";
import type { LicenceStatus, LicenceView } from "./types";

/**
 * While false, the gates compute the licence answer and log it, but keep
 * today's answer for Enterprise. Client-safe, so
 * the client gate can follow it too.
 */
export const LICENCE_ENFORCED = false;

export type ResolvedLicence = {
  kind: "licence" | "floor";
  status: LicenceStatus | "none";
  plan: Plan | null;
  overrides: Partial<Record<Feature, boolean>>;
  error: string | null;
  licence: LicenceView | null;
  clockSuspect: boolean;
  checkIn: {
    lastAt: string | null;
    status: string | null;
    error: string | null;
    seatsUsed: number | null;
  };
};

/**
 * Whether the licence entitles the install. Authoring needs
 * an active licence; a runtime check also passes in the grace period. The
 * floor and a terminated licence refuse everything.
 */
export function licenceAllows(
  licence: ResolvedLicence,
  spec: GateSpec,
  purpose: "author" | "run"
): boolean {
  if (licence.kind === "floor" || licence.status === "terminated") return false;
  if (licence.status === "expired" && purpose === "author") return false;
  const override = spec.feature ? licence.overrides[spec.feature] : undefined;
  if (override !== undefined) return override;
  return planMeetsRequirement(
    licence.plan ?? Plan.Unknown,
    resolveRequirement(spec)
  );
}

/**
 * Whether an access-control rule enforces without asking the licence:
 * on Enterprise and Test, a lapse must never lift a restriction.
 */
export function enforcesWithoutLicence(edition: string, feature: Feature) {
  return (
    ACCESS_CONTROL_FEATURES.has(feature) &&
    (edition === Edition.Enterprise || edition === Edition.Test)
  );
}

export type LicenceNotice = {
  reason: "terminated" | "none" | "expired" | "check-in" | "seats" | "clock";
  /** The end of the grace period, for "expired". */
  until: string | null;
};

const CHECK_IN_STALE_DAYS = 3;

/** The one notice to show, most serious first, or null. */
export function pickLicenceNotice(
  licence: ResolvedLicence,
  now: ZonedDateTime
): LicenceNotice | null {
  const notice = (reason: LicenceNotice["reason"]): LicenceNotice => ({
    reason,
    until: licence.licence?.terminates_at ?? null
  });

  if (licence.status === "terminated") return notice("terminated");
  if (licence.kind === "floor") return notice("none");
  if (licence.status === "expired") return notice("expired");

  // A connected licence renews daily, so its issue date is its last success.
  const issuedAt = licence.licence?.issued_at;
  if (
    licence.licence?.mode === "connected" &&
    licence.checkIn.status === "failed" &&
    issuedAt &&
    parseAbsolute(issuedAt, "UTC")
      .add({ days: CHECK_IN_STALE_DAYS })
      .compare(now) < 0
  ) {
    return notice("check-in");
  }

  const seats = licence.licence?.seats;
  const used = licence.checkIn.seatsUsed;
  if (seats != null && used != null && used > seats) return notice("seats");
  if (licence.clockSuspect) return notice("clock");
  return null;
}
