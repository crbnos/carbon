import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { inngest } from "../../client";
import { buildCompanyArtifact } from "./company-export";
import {
  getCompanyTableCatalog,
  getJobDatabaseClient,
  TEMPLATES_BUCKET
} from "./company-template";

/**
 * Keep demo backups current as the schema evolves. For every catalog entry
 * whose stored `schemaVersion` lags the live schema, re-build a fresh artifact
 * from its (now-migrated) source company and overwrite it in place — so a
 * customer never onboards from a backup the schema can no longer accept.
 *
 * Runs daily as a backstop; the deploy pipeline also fires
 * `carbon/refresh-demo-catalog` right after migrations apply.
 */
export const refreshDemoCatalogFunction = inngest.createFunction(
  { id: "refresh-demo-catalog", retries: 1 },
  [{ cron: "0 9 * * *" }, { event: "carbon/refresh-demo-catalog" }],
  async ({ step }) => {
    return await step.run("refresh-demo-catalog", async () => {
      const client = getCarbonServiceRole();
      const db = getJobDatabaseClient(1);

      const { schemaVersion: current } = await getCompanyTableCatalog(db);

      const stale = await client
        .from("companyTemplate")
        .select(
          "id, sourceCompanyId, createdBy, includesStorage, artifactPath, schemaVersion"
        )
        .neq("schemaVersion", current)
        .not("sourceCompanyId", "is", null);

      let refreshed = 0;
      for (const row of stale.data ?? []) {
        if (!row.sourceCompanyId) continue;
        try {
          const { compressed, manifest, rows } = await buildCompanyArtifact(
            client,
            db,
            {
              companyId: row.sourceCompanyId,
              userId: row.createdBy,
              includeStorage: row.includesStorage ? "all" : "none"
            }
          );

          const upload = await client.storage
            .from(TEMPLATES_BUCKET)
            .upload(row.artifactPath, compressed, {
              contentType: "application/gzip",
              upsert: true
            });
          if (upload.error) throw new Error(upload.error.message);

          await client
            .from("companyTemplate")
            .update({
              schemaVersion: manifest.schemaVersion,
              rowCount: rows,
              sourceCompanyName: manifest.sourceCompanyName,
              updatedAt: new Date().toISOString()
            })
            .eq("id", row.id);
          refreshed++;
        } catch (err) {
          // A source company that's gone or groupless can't be refreshed — log
          // and continue so one bad entry doesn't block the rest.
          console.error("Failed to refresh demo", {
            id: row.id,
            error: (err as Error).message
          });
        }
      }

      console.log("Demo catalog refresh complete", {
        stale: stale.data?.length ?? 0,
        refreshed
      });
      return { stale: stale.data?.length ?? 0, refreshed };
    });
  }
);
