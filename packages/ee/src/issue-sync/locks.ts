// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { isChangeNoticeLocked } from "@carbon/database/change-notice";
import { syncedEntities } from "./entities";
import type { SyncedEntityType, SyncedField } from "./types";

/** What the inbound sync knows about a record's locks. */
export type LockContext = {
  changeNoticeStatus?: string | null;
  projectStatus?: string | null;
  planLocked?: boolean;
};

/**
 * The fields a lock protects from an inbound change, and why, or null.
 * A refused field is not written; the link stores the refusal.
 */
export function lockedFields(
  type: SyncedEntityType,
  ctx: LockContext
): { fields: SyncedField[]; reason: string } | null {
  if (
    type === "changeOrderActionTask" &&
    isChangeNoticeLocked(ctx.changeNoticeStatus)
  ) {
    return {
      fields: [...syncedEntities[type].fields],
      reason: "the change notice is closed"
    };
  }
  if (type === "projectElement") {
    if (ctx.projectStatus === "Closed") {
      return {
        fields: [...syncedEntities[type].fields],
        reason: "the project is closed"
      };
    }
    // Name and description are plan-layer fields (PLAN_LAYER_FIELDS).
    if (ctx.planLocked) {
      return {
        fields: ["title", "description"],
        reason: "the project plan is locked"
      };
    }
  }
  return null;
}
