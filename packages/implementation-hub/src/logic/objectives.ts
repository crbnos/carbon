// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { OBJECTIVE_EVENT_KEYS } from "../content/objectives";
import type { ObjectiveEvent, ObjectivePayload } from "../types";

// A `YYYY-MM-DD` day, the shape every hub date field stores.
export const isIsoDay = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

const isEvent = (value: unknown): value is ObjectiveEvent =>
  typeof value === "string" &&
  (OBJECTIVE_EVENT_KEYS as string[]).includes(value);

const text = (value: unknown) =>
  typeof value === "string" && value !== "" ? value : undefined;

// Read an objective row's stored payload. Rows are written by people, sales
// handover and agents over MCP, so every field is checked: an unknown event or
// a malformed date reads as unset rather than breaking the page.
export function readObjective(
  payload: Record<string, unknown>
): ObjectivePayload {
  return {
    title: typeof payload.title === "string" ? payload.title : "",
    detail: text(payload.detail),
    event: isEvent(payload.event) ? payload.event : undefined,
    targetDate: isIsoDay(payload.targetDate) ? payload.targetDate : undefined,
    goLive: payload.goLive === true,
    locationId: text(payload.locationId)
  };
}

// The Objectives page lists go-live objectives first, then milestones (tied to
// an event), then the rest.
export type ObjectiveGroup = "goLive" | "milestone" | "other";

export const OBJECTIVE_GROUP_ORDER: ObjectiveGroup[] = [
  "goLive",
  "milestone",
  "other"
];

export function objectiveGroup(
  objective: Pick<ObjectivePayload, "goLive" | "event">
): ObjectiveGroup {
  if (objective.goLive) return "goLive";
  if (objective.event) return "milestone";
  return "other";
}

// UX mirror of the server rule (apply-mutation `refusalFor`): Carbon staff
// change any objective, everyone else only the ones assigned to them. A staff
// member previewing as the customer changes nothing.
export function mayChangeObjective(
  viewer: { userId: string; isInternal: boolean; previewing: boolean },
  assigneeId: string | undefined
): boolean {
  if (viewer.previewing) return false;
  if (viewer.isInternal) return true;
  return viewer.userId !== "" && assigneeId === viewer.userId;
}
