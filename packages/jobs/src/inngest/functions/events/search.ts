// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { groupBy } from "@carbon/utils";
import { sql } from "kysely";
import { z } from "zod";
import { getJobDatabaseClient } from "../../../db";
import { inngest } from "../../client";
import { planIndexWrites, planLookups, toIndexRow } from "./search-config";

const SearchRecordSchema = z.object({
  event: z.object({
    table: z.string(),
    operation: z.enum(["INSERT", "UPDATE", "DELETE", "TRUNCATE"]),
    recordId: z.string(),
    new: z.record(z.string(), z.any()).nullable(),
    old: z.record(z.string(), z.any()).nullable(),
    timestamp: z.string()
  }),
  companyId: z.string()
});

const SearchPayloadSchema = z.object({
  records: z.array(SearchRecordSchema)
});

export type SearchPayload = z.infer<typeof SearchPayloadSchema>;

const UNDEFINED_TABLE = "42P01";

export const searchFunction = inngest.createFunction(
  {
    id: "event-handler-search",
    retries: 3
  },
  { event: "carbon/event-search" },
  async ({ event, step, logger }) => {
    const payload = SearchPayloadSchema.parse(event.data);

    logger.info(`Processing ${payload.records.length} search index events`);

    const results = {
      updated: 0,
      deleted: 0,
      skipped: 0
    };

    type SearchRecord = (typeof payload.records)[number];
    const byCompany = groupBy(payload.records, (r) => r.companyId);

    for (const [companyId, records] of Object.entries(byCompany) as [
      string,
      SearchRecord[]
    ][]) {
      if (!companyId || companyId === "undefined") {
        results.skipped += records.length;
        continue;
      }

      const companyResult = await step.run(
        `search-index-${companyId}`,
        async () => {
          const { deletes, upserts, skipped } = planIndexWrites(
            records.map((r) => r.event)
          );

          // The lookup tables are picked from config at runtime, which the
          // typed client cannot express.
          const client = getCarbonServiceRole() as any;
          const resolved = new Map(
            await Promise.all(
              planLookups(upserts).map(async (lookup) => {
                let query = client
                  .from(lookup.table)
                  .select(`${lookup.matchOn}, ${lookup.column}`)
                  .in(lookup.matchOn, lookup.ids);
                if (lookup.companyScoped) {
                  query = query.eq("companyId", companyId);
                }
                const { data, error } = await query;

                if (error) {
                  logger.error("Failed to read search index lookup", {
                    companyId,
                    table: lookup.table,
                    error
                  });
                  throw new Error(
                    `Search index lookup on "${lookup.table}" failed: ${error.message}`
                  );
                }

                const values = new Map<string, unknown>(
                  (data as Record<string, unknown>[]).map((row) => [
                    String(row[lookup.matchOn]),
                    row[lookup.column]
                  ])
                );
                return [lookup.key, values] as const;
              })
            )
          );

          const rows = upserts.map((upsert) => toIndexRow(upsert, resolved));
          const pg = getJobDatabaseClient();

          try {
            if (deletes.length > 0) {
              await sql`
                SELECT delete_from_search_index(${companyId}, d.entity_type, d.entity_id)
                FROM jsonb_to_recordset(${JSON.stringify(deletes)}::jsonb)
                  AS d(entity_type text, entity_id text)
              `.execute(pg);
            }

            if (rows.length > 0) {
              await sql`
                SELECT upsert_to_search_index(
                  ${companyId}, r.entity_type, r.entity_id, r.title,
                  r.description, r.link, r.tags, r.metadata
                )
                FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
                  AS r(
                    entity_type text, entity_id text, title text,
                    description text, link text, tags text[], metadata jsonb
                  )
              `.execute(pg);
            }
          } catch (error) {
            // Deleting a company drops its search table while its events may
            // still be queued. A missing table on a live company is a real
            // failure and still throws.
            if (
              (error as { code?: string }).code === UNDEFINED_TABLE &&
              !(await pg
                .selectFrom("company")
                .select("id")
                .where("id", "=", companyId)
                .executeTakeFirst())
            ) {
              logger.warn("Skipped search index events of a deleted company", {
                companyId
              });
              return { updated: 0, deleted: 0, skipped: records.length };
            }
            logger.error("Failed to write search index", { companyId, error });
            throw error;
          }

          return { updated: rows.length, deleted: deletes.length, skipped };
        }
      );

      results.updated += companyResult.updated;
      results.deleted += companyResult.deleted;
      results.skipped += companyResult.skipped;
    }

    logger.info("Search function completed", results);

    return results;
  }
);
