// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Database } from "@carbon/database";
import type { ProjectStateGroup } from "@carbon/database/project-plan";
import type { JiraStatusCategory } from "../jira/lib/types";
import { LinearWorkStateType } from "../linear/lib/utils";

export {
  mapCarbonStatusToJiraCategory,
  mapJiraStatusToCarbonStatus
} from "../jira/lib/utils";
export {
  mapCarbonStatusToLinearStatus,
  mapLinearStatusToCarbonStatus
} from "../linear/lib/utils";
export { LinearWorkStateType };

/** 32-bit FNV-1a of a string, as 8 lowercase hex digits. */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * A short, stable fingerprint of a rich-text value (Tiptap JSON, Markdown,
 * ADF), so the sync snapshot can compare descriptions without storing them.
 */
export function hashText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return fnv1a(typeof value === "string" ? value : JSON.stringify(value));
}

type ElementPriority = Database["public"]["Enums"]["projectElementPriority"];

/** A project state group as a Linear state type (spec: State mapping). */
export function groupToLinearType(
  group: ProjectStateGroup
): LinearWorkStateType {
  switch (group) {
    case "Backlog":
      return LinearWorkStateType.Backlog;
    case "Unstarted":
      return LinearWorkStateType.Unstarted;
    case "Started":
      return LinearWorkStateType.Started;
    case "Completed":
      return LinearWorkStateType.Completed;
    case "Cancelled":
      return LinearWorkStateType.Canceled;
  }
}

/** A Linear state type as a project state group. */
export function linearTypeToGroup(type: string): ProjectStateGroup {
  switch (type) {
    case LinearWorkStateType.Backlog:
    case LinearWorkStateType.Triage:
      return "Backlog";
    case LinearWorkStateType.Started:
      return "Started";
    case LinearWorkStateType.Completed:
      return "Completed";
    case LinearWorkStateType.Canceled:
    case LinearWorkStateType.Duplicate:
      return "Cancelled";
    default:
      return "Unstarted";
  }
}

/** A project state group as a Jira status category. */
export function groupToJiraCategory(
  group: ProjectStateGroup
): JiraStatusCategory {
  switch (group) {
    case "Backlog":
    case "Unstarted":
      return "new";
    case "Started":
      return "indeterminate";
    case "Completed":
    case "Cancelled":
      return "done";
  }
}

/**
 * A Jira status category as a project state group. Jira has three categories
 * for five groups, so `new` keeps a Backlog element in Backlog and `done`
 * keeps a Cancelled element in Cancelled.
 */
export function jiraCategoryToGroup(
  category: string,
  currentGroup: ProjectStateGroup | null | undefined
): ProjectStateGroup {
  switch (category) {
    case "new":
      return currentGroup === "Backlog" ? "Backlog" : "Unstarted";
    case "indeterminate":
      return "Started";
    case "done":
      return currentGroup === "Cancelled" ? "Cancelled" : "Completed";
    default:
      return "Unstarted";
  }
}

const LINEAR_PRIORITY: Record<ElementPriority, number> = {
  None: 0,
  Urgent: 1,
  High: 2,
  Medium: 3,
  Low: 4
};

/** An element priority as a Linear priority (0 None, 1 Urgent … 4 Low). */
export function priorityToLinear(priority: ElementPriority): number {
  return LINEAR_PRIORITY[priority] ?? 0;
}

/** A Linear priority as an element priority. */
export function linearToPriority(
  value: number | string | null | undefined
): ElementPriority {
  const n = Number(value ?? 0);
  return (
    (Object.entries(LINEAR_PRIORITY).find(([, v]) => v === n)?.[0] as
      | ElementPriority
      | undefined) ?? "None"
  );
}

/** An element priority as a Jira priority name, or null for None. */
export function priorityToJira(priority: ElementPriority): string | null {
  switch (priority) {
    case "Urgent":
      return "Highest";
    case "High":
      return "High";
    case "Medium":
      return "Medium";
    case "Low":
      return "Low";
    default:
      return null;
  }
}

/** A Jira priority name as an element priority, or null when it has no match. */
export function jiraToPriority(
  name: string | null | undefined
): ElementPriority | null {
  switch (name) {
    case "Highest":
      return "Urgent";
    case "High":
      return "High";
    case "Medium":
      return "Medium";
    case "Low":
    case "Lowest":
      return "Low";
    default:
      return null;
  }
}
