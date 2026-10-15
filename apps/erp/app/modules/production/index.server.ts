// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  cancelJob,
  planDraftJob,
  releaseBatchMemberJobs,
  releaseJobs,
  reorderScheduleOperations,
  replanAfterItemChange
} from "./production.server";

/** The production module's operations, by entity. */
export const production = {
  job: { cancel: cancelJob, plan: planDraftJob, release: releaseJobs },
  batch: { releaseMemberJobs: releaseBatchMemberJobs },
  schedule: { reorder: reorderScheduleOperations },
  planning: { replanItem: replanAfterItemChange }
};
