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
import type { SyncedEntityType, SyncedField } from "../types";

/**
 * Push the given fields of a Carbon row to its Jira issue. A status change is
 * a workflow transition; the other fields go in one update. Returns the
 * fields Jira accepted.
 */
export async function pushToJira(args: {
  companyId: string;
  issueId: string;
  type: SyncedEntityType;
  row: SyncedRow;
  fields: SyncedField[];
  assigneeEmail: string | null;
}): Promise<SyncedField[]> {
  const jira = getJiraClient();
  const entity = syncedEntities[args.type];
  const input: UpdateJiraIssueInput = {};
  const pending: SyncedField[] = [];
  const sent: SyncedField[] = [];

  for (const field of args.fields) {
    switch (field) {
      case "status": {
        const moved = await jira.transitionIssue(
          args.companyId,
          args.issueId,
          mapCarbonStatusToJiraCategory(
            String(args.row.status) as Parameters<
              typeof mapCarbonStatusToJiraCategory
            >[0]
          )
        );
        if (moved) sent.push(field);
        break;
      }
      case "assignee": {
        if (!args.row[entity.assigneeColumn]) {
          input.assigneeId = null;
          pending.push(field);
        } else if (args.assigneeEmail) {
          const user = await jira.findUserByEmail(
            args.companyId,
            args.assigneeEmail
          );
          if (user) {
            input.assigneeId = user.accountId;
            pending.push(field);
          }
        }
        break;
      }
      case "dueDate": {
        input.duedate =
          (args.row[entity.dueDateColumn] as string | null) ?? null;
        pending.push(field);
        break;
      }
      case "description": {
        input.description = tiptapToAdf(
          args.row[entity.textColumn] as TiptapDocument | null
        );
        pending.push(field);
        break;
      }
      default:
        break;
    }
  }

  if (pending.length > 0) {
    const updated = await jira.updateIssue(args.companyId, args.issueId, input);
    if (updated) sent.push(...pending);
  }

  return sent;
}
