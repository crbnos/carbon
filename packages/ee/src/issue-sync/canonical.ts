// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { JiraIssue } from "../jira/lib/types";
import type { LinearIssue } from "../linear/lib/types";
import { syncedEntities } from "./entities";
import { hashText } from "./maps";
import type { FieldValues, SyncedEntityType } from "./types";

/** A row of a synced table, as `select("*")` returns it. */
export type SyncedRow = Record<string, unknown> & { id: string };

const text = (value: unknown): string | null =>
  value === null || value === undefined || value === "" ? null : String(value);

/** The synced fields of a Carbon row, as the snapshot's `carbon` values. */
export function carbonValues(
  type: SyncedEntityType,
  row: SyncedRow
): FieldValues {
  const entity = syncedEntities[type];
  return {
    status: text(row.status),
    assignee: text(row[entity.assigneeColumn]),
    dueDate: text(row[entity.dueDateColumn]),
    description: hashText(row[entity.textColumn] ?? null)
  };
}

/** The synced fields of a Linear issue, as the snapshot's `remote` values. */
export function linearValues(issue: LinearIssue): FieldValues {
  return {
    status: issue.state.type,
    assignee: issue.assignee?.email?.toLowerCase() ?? null,
    dueDate: text(issue.dueDate),
    description: hashText(issue.description || null)
  };
}

/**
 * The synced fields of a Jira issue. The assignee is the account id: Jira can
 * hide the email, but the account id always changes with the assignee.
 */
export function jiraValues(issue: JiraIssue): FieldValues {
  return {
    status: issue.fields.status.statusCategory.key,
    assignee: issue.fields.assignee?.accountId ?? null,
    dueDate: text(issue.fields.duedate),
    description: hashText(issue.fields.description ?? null)
  };
}
