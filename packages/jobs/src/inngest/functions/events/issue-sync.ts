// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { isSyncedEntityType } from "@carbon/ee/issue-sync";
import { deleteLinks, pushRecords } from "@carbon/ee/issue-sync.server";
import { groupBy } from "@carbon/utils";
import { z } from "zod";
import { inngest } from "../../client";

/**
 * One concurrency key for every write that one company's Linear or Jira sync
 * makes: the outbound push here and the inbound jobs
 * (`integrations/linear.ts`, `integrations/jira.ts`). A push and a pull of
 * one company never interleave, so neither reads a snapshot the other is
 * about to replace.
 */
export const ISSUE_SYNC_CONCURRENCY = {
  limit: 1,
  scope: "env",
  key: '"issue-sync-" + event.data.companyId'
} as const;

const IssueSyncRecordSchema = z.object({
  event: z.object({
    table: z.string(),
    operation: z.enum(["INSERT", "UPDATE", "DELETE", "TRUNCATE"]),
    recordId: z.string(),
    old: z.record(z.string(), z.any()).nullable()
  }),
  companyId: z.string()
});

const IssueSyncPayloadSchema = z.object({
  records: z.array(IssueSyncRecordSchema)
});

const IssueSyncPushSchema = z.object({
  companyId: z.string(),
  initial: z.boolean().optional(),
  records: z.array(
    z.object({
      table: z.string(),
      recordId: z.string(),
      operation: z.enum(["UPDATE", "DELETE"]),
      old: z.record(z.string(), z.any()).nullable()
    })
  )
});

/**
 * ISSUE_SYNC handler. A queue batch can hold several companies, and the push
 * needs a per-company concurrency key, so this function only fans the batch
 * out: one `carbon/issue-sync.push` event per company.
 */
export const issueSyncFunction = inngest.createFunction(
  { id: "event-handler-issue-sync", retries: 3 },
  { event: "carbon/event-issue-sync" },
  async ({ event, step }) => {
    const payload = IssueSyncPayloadSchema.parse(event.data);
    const byCompany = groupBy(
      payload.records.filter(
        (r) => r.event.operation === "UPDATE" || r.event.operation === "DELETE"
      ),
      (r) => r.companyId
    );

    const events = Object.entries(byCompany).map(([companyId, records]) => ({
      name: "carbon/issue-sync.push" as const,
      data: {
        companyId,
        records: records.map((r) => ({
          table: r.event.table,
          recordId: r.event.recordId,
          operation: r.event.operation as "UPDATE" | "DELETE",
          old: r.event.old
        }))
      }
    }));

    if (events.length > 0) {
      await step.sendEvent("fan-out-issue-sync", events);
    }

    return { companies: events.length };
  }
);

/**
 * Push one company's changed synced records to Linear and Jira, and remove
 * the links of deleted records. The engine reads the current rows; the
 * events only say which rows to look at.
 */
export const issueSyncPushFunction = inngest.createFunction(
  {
    id: "issue-sync-push",
    retries: 3,
    concurrency: ISSUE_SYNC_CONCURRENCY
  },
  { event: "carbon/issue-sync.push" },
  async ({ event, step }) => {
    const { companyId, records, initial } = IssueSyncPushSchema.parse(
      event.data
    );
    const client = getCarbonServiceRole();
    const results: Record<string, unknown> = {};

    const byTable = groupBy(records, (r) => r.table);
    for (const [table, tableRecords] of Object.entries(byTable) as [
      string,
      typeof records
    ][]) {
      if (!isSyncedEntityType(table)) continue;

      const updatedIds = [
        ...new Set(
          tableRecords
            .filter((r) => r.operation === "UPDATE")
            .map((r) => r.recordId)
        )
      ];
      const deleted = tableRecords
        .filter((r) => r.operation === "DELETE")
        .map((r) => ({ id: r.recordId, old: r.old }));

      if (updatedIds.length > 0) {
        results[`push-${table}`] = await step.run(`push-${table}`, () =>
          pushRecords(client, companyId, table, updatedIds, { initial })
        );
      }

      if (deleted.length > 0) {
        results[`unlink-${table}`] = await step.run(`unlink-${table}`, () =>
          deleteLinks(client, companyId, table, deleted)
        );
      }
    }

    return results;
  }
);
