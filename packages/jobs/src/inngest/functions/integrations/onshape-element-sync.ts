// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { OnshapeOAuthIntegrationId } from "@carbon/ee/onshape/integration-id";
import { inngest } from "../../client";
import {
  ONSHAPE_CHECKPOINTING,
  runOnshapeDrawingSync,
  runOnshapeElementSync
} from "./onshape-sync-element";

/**
 * One element's export as its own run, for callers that sync many elements
 * (the backfill `step.invoke`s it per item): each element's polls, sleeps and
 * fetch are this run's steps, so a long backfill stays under the per-run step
 * limit. One run per item at a time.
 */
export const onshapeElementSyncFunction = inngest.createFunction(
  {
    id: "onshape-element-sync",
    checkpointing: ONSHAPE_CHECKPOINTING,
    // As the backfill's: a 429 reschedules the step through RetryAfterError,
    // and each reschedule counts against this budget.
    retries: 10,
    concurrency: { key: "event.data.itemId", limit: 1 }
  },
  { event: "carbon/onshape-element-sync" },
  async ({ event, step }) =>
    runOnshapeElementSync(
      step,
      getCarbonServiceRole(),
      {
        ...event.data,
        integrationId: event.data.integrationId as
          | OnshapeOAuthIntegrationId
          | undefined
      },
      "element"
    )
);

/** One released drawing's PDF export as its own run (the backfill
 *  `step.invoke`s it per drawing), for the same reason as the element sync. */
export const onshapeDrawingSyncFunction = inngest.createFunction(
  {
    id: "onshape-drawing-sync",
    checkpointing: ONSHAPE_CHECKPOINTING,
    // As the backfill's: a 429 reschedules the step through RetryAfterError,
    // and each reschedule counts against this budget.
    retries: 10,
    concurrency: { key: "event.data.itemId", limit: 1 }
  },
  { event: "carbon/onshape-drawing-sync" },
  async ({ event, step }) =>
    runOnshapeDrawingSync(
      step,
      getCarbonServiceRole(),
      {
        ...event.data,
        integrationId: event.data.integrationId as
          | OnshapeOAuthIntegrationId
          | undefined
      },
      "drawing"
    )
);
