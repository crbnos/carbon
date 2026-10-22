// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { TiptapText } from "@carbon/files/markdown";
import { getLogger } from "@carbon/logger";
import { getLinearClient } from "../../linear/lib/client";
import { mapCarbonStatusToLinearStatus } from "../../linear/lib/utils";
import type { SyncedRow } from "../canonical";
import { syncedEntities } from "../entities";
import { groupToLinearType, priorityToLinear } from "../maps";
import type { FieldValues, SyncedEntityType, SyncedField } from "../types";

const logger = getLogger("ee", "issue-sync-linear");

/**
 * Push the given fields of a Carbon row to its Linear issue in one update.
 * Returns the fields Linear accepted; a field it cannot map (no state of
 * that type in the team, no Linear user with that email) is left out.
 */
export async function pushToLinear(args: {
  companyId: string;
  issueId: string;
  teamId: string | null;
  type: SyncedEntityType;
  row: SyncedRow;
  /** The row's snapshot values; an element's `status` is its state group. */
  carbon: FieldValues;
  fields: SyncedField[];
  assigneeEmail: string | null;
}): Promise<SyncedField[]> {
  const linear = getLinearClient();
  const entity = syncedEntities[args.type];
  const input: Parameters<typeof linear.updateIssue>[1] = { id: args.issueId };
  const sent: SyncedField[] = [];

  for (const field of args.fields) {
    switch (field) {
      case "status": {
        if (!args.teamId) break;
        if (args.type === "projectElement" && !args.carbon.status) break;
        try {
          const state = await linear.getWorkflowState(
            args.companyId,
            args.teamId,
            args.type === "projectElement"
              ? groupToLinearType(
                  args.carbon.status as Parameters<typeof groupToLinearType>[0]
                )
              : mapCarbonStatusToLinearStatus(String(args.row.status))
          );
          if (state) {
            input.stateId = state.id;
            sent.push(field);
          }
        } catch (error) {
          logger.error("Failed to resolve the Linear state", { error });
        }
        break;
      }
      case "assignee": {
        if (!args.row[entity.assigneeColumn]) {
          input.assigneeId = null;
          sent.push(field);
        } else if (args.assigneeEmail) {
          const [user] = await linear.getUsers(args.companyId, {
            email: args.assigneeEmail
          });
          if (user) {
            input.assigneeId = user.id;
            sent.push(field);
          }
        }
        break;
      }
      case "title": {
        input.title = String(args.row.name ?? "");
        sent.push(field);
        break;
      }
      case "priority": {
        input.priority = priorityToLinear(
          (args.row.priority ?? "None") as Parameters<
            typeof priorityToLinear
          >[0]
        );
        sent.push(field);
        break;
      }
      case "dueDate": {
        input.dueDate =
          (args.row[entity.dueDateColumn] as string | null) ?? null;
        sent.push(field);
        break;
      }
      case "description": {
        input.description = TiptapText(
          args.row[entity.textColumn]
        ).toMarkdown();
        sent.push(field);
        break;
      }
      default:
        break;
    }
  }

  if (sent.length === 0) return [];

  const updated = await linear.updateIssue(args.companyId, input);
  return updated ? sent : [];
}
