import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { inngest } from "../../client";
import { buildCompanyArtifact } from "./company-export";
import { getJobDatabaseClient, TEMPLATES_BUCKET } from "./company-template";

/**
 * Re-export every industry's demo from its persistent source company after a
 * migration, overwriting the gzip in place so onboarding always serves a
 * current-schema backup. Fired by the deploy pipeline right after migrations
 * apply (no payload — it walks the industry catalog).
 *
 * Per-source failures are non-fatal: the old gzip is left untouched (still
 * valid for additive migrations) and the run continues, so one broken source
 * never blocks the rest.
 */
export const refreshDemoCatalogFunction = inngest.createFunction(
  { id: "refresh-demo-catalog", retries: 1 },
  { event: "carbon/refresh-demo-catalog" },
  async ({ step }) => {
    return await step.run("refresh-demo-catalog", async () => {
      const client = getCarbonServiceRole();
      const db = getJobDatabaseClient(1);

      const { data: rows } = await client
        .from("industry")
        .select("id, sourceCompanyId, includesStorage, artifactPath")
        .not("sourceCompanyId", "is", null);

      let refreshed = 0;
      const failures: Array<{ id: string; error: string }> = [];

      for (const row of rows ?? []) {
        if (!row.sourceCompanyId || !row.artifactPath) continue;
        try {
          const {
            compressed,
            manifest,
            rows: rowCount
          } = await buildCompanyArtifact(client, db, {
            companyId: row.sourceCompanyId,
            userId: "system",
            includeStorage: row.includesStorage ? "all" : "none"
          });

          const upload = await client.storage
            .from(TEMPLATES_BUCKET)
            .upload(row.artifactPath, compressed, {
              contentType: "application/gzip",
              upsert: true
            });
          if (upload.error) throw new Error(upload.error.message);

          const update = await client
            .from("industry")
            .update({
              schemaVersion: manifest.schemaVersion,
              rowCount,
              sourceCompanyName: manifest.sourceCompanyName,
              updatedAt: new Date().toISOString()
            })
            .eq("id", row.id);
          if (update.error) throw new Error(update.error.message);
          refreshed++;
        } catch (err) {
          // Non-fatal: leave the old gzip (still valid for additive migrations)
          // and keep going so one bad source doesn't block the rest.
          const message = (err as Error).message;
          console.error("Failed to refresh demo", {
            id: row.id,
            error: message
          });
          failures.push({ id: row.id, error: message });
        }
      }

      console.log("Demo catalog refresh complete", {
        total: rows?.length ?? 0,
        refreshed,
        failed: failures.length
      });
      return { total: rows?.length ?? 0, refreshed, failures };
    });
  }
);
