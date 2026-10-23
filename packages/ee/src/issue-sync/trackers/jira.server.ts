// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { getJiraClient } from "../../jira/lib/client";
import type { TiptapDocument } from "../../jira/lib/richtext";
import { tiptapToAdf } from "../../jira/lib/richtext";
import type { UpdateJiraIssueInput } from "../../jira/lib/types";
import { mapCarbonStatusToJiraCategory } from "../../jira/lib/utils";
import type { SyncedRow } from "../canonical";
import { syncedEntities } from "../entities";
import { groupToJiraCategory, priorityToJira } from "../maps";
import type { FieldValues, SyncedEntityType, SyncedField } from "../types";

/**
 * Push the given fields of a Carbon row to its Jira issue. A status change is
 * a workflow transition; the other fields go in one update. Returns the
 * fields Jira accepted.
 */
export async function pushToJira(args: {
  companyId: string;
  issueId: string;
  /** The issue's status category as the link last saw it. */
  currentCategory: string | null;
  type: SyncedEntityType;
  row: SyncedRow;
  /** The row's snapshot values; an element's `status` is its state group. */
  carbon: FieldValues;
  fields: SyncedField[];
  assigneeEmail: string | null;
}): Promise<SyncedField[]> {
  const jira = getJiraClient();
  const entity = syncedEntities[args.type];
  const input: UpdateJiraIssueInput = {};
  const pending: SyncedField[] = [];
  // Each field's own part of the update, for the one-by-one fallback.
  const parts = new Map<SyncedField, UpdateJiraIssueInput>();
  const stage = (field: SyncedField, part: UpdateJiraIssueInput) => {
    Object.assign(input, part);
    parts.set(field, part);
    pending.push(field);
  };
  const sent: SyncedField[] = [];

  for (const field of args.fields) {
    switch (field) {
      case "status": {
        if (args.type === "projectElement" && !args.carbon.status) break;
        const target =
          args.type === "projectElement"
            ? groupToJiraCategory(
                args.carbon.status as Parameters<typeof groupToJiraCategory>[0]
              )
            : mapCarbonStatusToJiraCategory(
                String(args.row.status) as Parameters<
                  typeof mapCarbonStatusToJiraCategory
                >[0]
              );
        // Jira has three categories for more Carbon states. When the issue
        // is already in the target category, a transition would only move
        // it to another status of that category: leave it.
        if (target === args.currentCategory) {
          sent.push(field);
          break;
        }
        const moved = await jira.transitionIssue(
          args.companyId,
          args.issueId,
          target
        );
        if (moved) sent.push(field);
        break;
      }
      case "assignee": {
        if (!args.row[entity.assigneeColumn]) {
          stage(field, { assigneeId: null });
        } else if (args.assigneeEmail) {
          const user = await jira.findUserByEmail(
            args.companyId,
            args.assigneeEmail
          );
          if (user) stage(field, { assigneeId: user.accountId });
        }
        break;
      }
      case "title": {
        stage(field, { summary: String(args.row.name ?? "") });
        break;
      }
      case "priority": {
        // Jira priorities are per site: push only a name the site has.
        const name = priorityToJira(
          (args.row.priority ?? "None") as Parameters<typeof priorityToJira>[0]
        );
        if (!name) break;
        const priorities = await jira.listPriorities(args.companyId);
        if (priorities.some((priority) => priority.name === name)) {
          stage(field, { priority: name });
        }
        break;
      }
      case "dueDate": {
        stage(field, {
          duedate: (args.row[entity.dueDateColumn] as string | null) ?? null
        });
        break;
      }
      case "description": {
        stage(field, {
          description: tiptapToAdf(
            args.row[entity.textColumn] as TiptapDocument | null
          )
        });
        break;
      }
      default:
        break;
    }
  }

  if (pending.length > 0) {
    const updated = await jira.updateIssue(args.companyId, args.issueId, input);
    if (updated) {
      sent.push(...pending);
    } else if (pending.length > 1) {
      // Jira refuses the whole update when one field is not on the issue's
      // edit screen. Send each field alone so the others still sync.
      for (const field of pending) {
        const ok = await jira.updateIssue(
          args.companyId,
          args.issueId,
          parts.get(field) ?? {}
        );
        if (ok) sent.push(field);
      }
    }
  }

  return sent;
}
