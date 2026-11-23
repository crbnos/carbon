// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Where each run type lives in the app. The rows a type claims, its sequence
// and its name in messages are `@carbon/database/run-type`; this adds the
// pages, so every route and component that sends a user back to "the run's
// list" reads one map.

import type { RunType } from "@carbon/database/run-type";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { path } from "~/utils/path";

export const RUN_PAGES: Record<
  RunType,
  { listPath: string; newPath: string; title: MessageDescriptor }
> = {
  "Revenue Recognition": {
    listPath: path.to.revenueRecognitionRuns,
    newPath: path.to.newRevenueRecognitionRun,
    title: msg`Revenue Recognition`
  },
  Lease: {
    listPath: path.to.leaseRuns,
    newPath: path.to.newLeaseRun,
    title: msg`Lease Runs`
  }
};
