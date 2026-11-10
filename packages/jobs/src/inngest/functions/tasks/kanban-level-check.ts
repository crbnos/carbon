// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { postingOrThrow } from "@carbon/api/postings.server";
import { getJobDatabaseClient } from "../../../db";
import { inngest } from "../../client";

/**
 * Replenishes Transfer kanbans whose To storage unit is below its
 * replenishment level. Only the database sends the event: the `itemLedger`
 * statement handler, the `kanban` interceptor and the hourly sweep
 * (`util.sweep_kanban_levels`). `kanban-replenish` re-checks the level inside
 * its own transaction, so a stale or duplicate event writes nothing.
 *
 * No `debounce`: the local Inngest dev server cannot run it.
 */
export const kanbanLevelCheckFunction = inngest.createFunction(
  {
    id: "kanban-level-check",
    retries: 3,
    concurrency: {
      limit: 1,
      scope: "env",
      key: '"kanban-level:" + event.data.companyId'
    }
  },
  { event: "carbon/kanban.level-check" },
  async ({ event, step, logger }) => {
    const { companyId, kanbanIds } = event.data;

    const result = await step.run("replenish", () =>
      postingOrThrow(
        "kanban-replenish",
        { db: getJobDatabaseClient(), companyId, userId: "system" },
        { mode: "level", kanbanIds }
      )
    );

    for (const outcome of result.results) {
      if (outcome.outcome === "created") {
        logger.info("Kanban replenishment created", {
          companyId,
          kanbanId: outcome.kanbanId,
          stockTransferId: outcome.stockTransferId
        });
      } else if (outcome.outcome === "invalid") {
        logger.warn("Kanban not replenished", {
          companyId,
          kanbanId: outcome.kanbanId,
          reason: outcome.reason
        });
      }
    }

    return result;
  }
);
