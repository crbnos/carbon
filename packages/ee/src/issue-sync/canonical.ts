// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { ProjectStateGroup } from "@carbon/database/project-plan";
import {
  adfToTiptap,
  isTiptapEmpty,
  type TiptapDocument
} from "../jira/lib/richtext";
import type { JiraIssue } from "../jira/lib/types";
import type { LinearIssue } from "../linear/lib/types";
import { syncedEntities } from "./entities";
import { hashText } from "./maps";
import type { FieldValues, SyncedEntityType } from "./types";

/** A row of a synced table, as `select("*")` returns it. */
export type SyncedRow = Record<string, unknown> & { id: string };

const text = (value: unknown): string | null =>
  value === null || value === undefined || value === "" ? null : String(value);

/** A rich-text value with no text in it counts as no description. */
const richText = (doc: unknown): string | null =>
  isTiptapEmpty(doc as TiptapDocument | null) ? null : hashText(doc);

/** The synced fields of a Carbon row, as the snapshot's `carbon` values. */
export function carbonValues(
  type: SyncedEntityType,
  row: SyncedRow,
  ctx: { stateGroupById?: Map<string, ProjectStateGroup> } = {}
): FieldValues {
  const entity = syncedEntities[type];
  const values: FieldValues = {
    status: text(row.status),
    assignee: text(row[entity.assigneeColumn]),
    dueDate: text(row[entity.dueDateColumn]),
    description: richText(row[entity.textColumn])
  };

  if (type === "projectElement") {
    // An element's status is its state's group: the tracker knows no
    // company-specific state.
    values.status = ctx.stateGroupById?.get(String(row.stateId)) ?? null;
    values.title = text(row.name);
    values.priority = text(row.priority);
  }

  return values;
}

/** The synced fields of a Linear issue, as the snapshot's `remote` values. */
export function linearValues(issue: LinearIssue): FieldValues {
  return {
    title: issue.title,
    status: issue.state.type,
    assignee: issue.assignee?.email?.toLowerCase() ?? null,
    priority: String(issue.priority ?? 0),
    dueDate: text(issue.dueDate),
    description: issue.description?.trim() ? hashText(issue.description) : null
  };
}

/**
 * The synced fields of a Jira issue. The assignee is the account id: Jira can
 * hide the email, but the account id always changes with the assignee.
 */
export function jiraValues(issue: JiraIssue): FieldValues {
  return {
    title: issue.fields.summary,
    status: issue.fields.status.statusCategory.key,
    assignee: issue.fields.assignee?.accountId ?? null,
    priority: issue.fields.priority?.name ?? null,
    dueDate: text(issue.fields.duedate),
    description: isTiptapEmpty(
      adfToTiptap(issue.fields.description ?? null) as TiptapDocument
    )
      ? null
      : hashText(issue.fields.description)
  };
}
