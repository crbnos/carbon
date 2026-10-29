// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The customization plan's rows, read safely from their stored payload, and
// the summary the Customization Plan page shows above them.

import {
  CUSTOMIZATION_KINDS,
  CUSTOMIZATION_STATUSES
} from "../content/customization";
import type {
  CustomizationKind,
  CustomizationPayload,
  CustomizationStatus
} from "../types";

export const CUSTOMIZATION_KIND_KEYS = Object.keys(
  CUSTOMIZATION_KINDS
) as CustomizationKind[];

export const CUSTOMIZATION_STATUS_KEYS = Object.keys(
  CUSTOMIZATION_STATUSES
) as CustomizationStatus[];

// The statuses whose estimates count as committed work.
const COMMITTED: ReadonlySet<CustomizationStatus> = new Set([
  "agreed",
  "inProgress"
]);

export const isCustomizationKind = (
  value: unknown
): value is CustomizationKind =>
  typeof value === "string" && value in CUSTOMIZATION_KINDS;

const isStatus = (value: unknown): value is CustomizationStatus =>
  typeof value === "string" && value in CUSTOMIZATION_STATUSES;

const text = (value: unknown) =>
  typeof value === "string" && value.length > 0 ? value : undefined;

// A stored payload as a CustomizationPayload. Unknown kinds and statuses fall
// back to the defaults a new row starts with; malformed optional cells drop.
export function readCustomization(
  payload: Record<string, unknown>
): CustomizationPayload {
  const targetDate = text(payload.targetDate);
  const estimateDays =
    typeof payload.estimateDays === "number" &&
    Number.isFinite(payload.estimateDays) &&
    payload.estimateDays >= 0
      ? payload.estimateDays
      : undefined;
  return {
    title: typeof payload.title === "string" ? payload.title : "",
    kind: isCustomizationKind(payload.kind) ? payload.kind : "configuration",
    status: isStatus(payload.status) ? payload.status : "proposed",
    ...(text(payload.detail) ? { detail: text(payload.detail) } : {}),
    ...(text(payload.requirementRowId)
      ? { requirementRowId: text(payload.requirementRowId) }
      : {}),
    ...(targetDate && /^\d{4}-\d{2}-\d{2}$/.test(targetDate)
      ? { targetDate }
      : {}),
    ...(estimateDays !== undefined ? { estimateDays } : {})
  };
}

// An estimate typed into the page, in days. Blank, negative or non-numeric
// input is no estimate.
export function parseEstimateDays(input: string): number | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

export interface CustomizationSummary {
  byStatus: Record<CustomizationStatus, number>;
  // Total estimate of the agreed and in-progress customizations.
  committedDays: number;
}

export function summarizeCustomizations(
  customizations: CustomizationPayload[]
): CustomizationSummary {
  const byStatus = Object.fromEntries(
    CUSTOMIZATION_STATUS_KEYS.map((status) => [status, 0])
  ) as Record<CustomizationStatus, number>;
  let committedDays = 0;
  for (const customization of customizations) {
    byStatus[customization.status] += 1;
    if (COMMITTED.has(customization.status)) {
      committedDays += customization.estimateDays ?? 0;
    }
  }
  return { byStatus, committedDays };
}
