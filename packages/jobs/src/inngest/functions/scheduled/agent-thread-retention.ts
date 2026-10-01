// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { pluckUnique } from "@carbon/utils";
import { sql } from "kysely";

// Agent chat threads are transient: purged after this many days without a message.
export const AGENT_THREAD_TTL_DAYS = 7;
const BATCH = 1000;
// Bounds one run; a larger backlog drains over the following runs.
const MAX_BATCHES = 50;

/**
 * Delete agent threads with no message in the last `ttlDays` (messages and parts
 * cascade). Stale = started before the cutoff AND no message since, so a thread the user
 * is still talking in stays. The activity test is in the query, not applied after it, so
 * every batch is purgeable and the sweep always advances: filtering afterwards let a page
 * of old-but-active threads be fetched, skipped and fetched again on every run.
 */
export async function purgeStaleAgentThreads(
  db: Kysely<KyselyDatabase>,
  ttlDays = AGENT_THREAD_TTL_DAYS
) {
  const cutoff = sql<string>`now() - make_interval(days => ${ttlDays})`;
  let purged = 0;

  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const stale = await db
      .selectFrom("agentThread as t")
      .select(["t.id", "t.companyId"])
      .where("t.createdAt", "<", cutoff)
      .where(({ exists, not, selectFrom }) =>
        not(
          exists(
            selectFrom("agentMessage as m")
              .select("m.id")
              .whereRef("m.threadId", "=", "t.id")
              .whereRef("m.companyId", "=", "t.companyId")
              .where("m.createdAt", ">=", cutoff)
          )
        )
      )
      .orderBy("t.createdAt")
      .limit(BATCH)
      .execute();

    if (stale.length > 0) {
      // One statement per batch, on the composite key (companyId, id).
      const result = await db
        .deleteFrom("agentThread")
        .where(
          "companyId",
          "in",
          pluckUnique(stale, (t) => t.companyId)
        )
        .where(({ eb, refTuple, tuple }) =>
          eb(
            refTuple("companyId", "id"),
            "in",
            stale.map((t) => tuple(t.companyId, t.id))
          )
        )
        .executeTakeFirst();
      purged += Number(result.numDeletedRows ?? 0);
    }

    if (stale.length < BATCH) return { purged, drained: true };
  }
  return { purged, drained: false };
}
