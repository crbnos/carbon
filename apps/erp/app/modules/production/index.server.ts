// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  cancelJob,
  planDraftJob,
  releaseBatches,
  releaseJobs,
  reorderScheduleOperations,
  replanAfterItemChange
} from "./production.server";

/** The production module's operations, by entity. */
export const production = {
  job: { release: releaseJobs, cancel: cancelJob, plan: planDraftJob },
  batch: { release: releaseBatches },
  schedule: { reorder: reorderScheduleOperations },
  planning: { replanItem: replanAfterItemChange }
};
