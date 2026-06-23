import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { nanoid } from "nanoid";
import { inngest } from "../../client";
import { buildCompanyArtifact } from "./company-export";
import { getJobDatabaseClient, TEMPLATES_BUCKET } from "./company-template";

/**
 * Publish a source company as an industry's demo (internal tooling). Builds a
 * fresh artifact from the source company, writes it into the shared
 * `company-templates` bucket, and stamps the demo onto the `industry` row —
 * reusing the existing path on re-publish so no orphan gzip is left.
 *
 * `industry.sourceCompanyId` is set to the source company so the
 * `refresh-demo-catalog` job can re-export it after future migrations.
 */
export const publishDemoFunction = inngest.createFunction(
  {
    id: "publish-demo",
    retries: 1,
    concurrency: { key: "event.data.companyId", limit: 1 }
  },
  { event: "carbon/publish-demo" },
  async ({ event, step }) => {
    const { companyId, userId, industryId, includeStorage } = event.data;

    return await step.run("publish-demo", async () => {
      const client = getCarbonServiceRole();
      const db = getJobDatabaseClient(1);

      const { compressed, manifest, rows } = await buildCompanyArtifact(
        client,
        db,
        {
          companyId,
          userId,
          label: null,
          includeStorage: includeStorage ?? "none"
        }
      );

      // Reuse this industry's existing artifact path on re-publish so the bucket
      // object is overwritten in place (no orphan gzip).
      const industry = await client
        .from("industry")
        .select("artifactPath")
        .eq("id", industryId)
        .maybeSingle();

      const artifactPath =
        industry.data?.artifactPath ?? `${nanoid()}.carbon.json.gz`;
      const upload = await client.storage
        .from(TEMPLATES_BUCKET)
        .upload(artifactPath, compressed, {
          contentType: "application/gzip",
          upsert: true
        });
      if (upload.error) throw new Error(upload.error.message);

      const update = await client
        .from("industry")
        .update({
          sourceCompanyId: companyId,
          sourceCompanyName: manifest.sourceCompanyName,
          artifactPath,
          schemaVersion: manifest.schemaVersion,
          includesStorage: (includeStorage ?? "none") === "all",
          rowCount: rows,
          updatedAt: new Date().toISOString()
        })
        .eq("id", industryId);
      if (update.error) throw new Error(update.error.message);

      console.log("Demo published", {
        industryId,
        sourceCompanyId: companyId,
        artifactPath,
        rows,
        schemaVersion: manifest.schemaVersion
      });

      return { artifactPath, rows, schemaVersion: manifest.schemaVersion };
    });
  }
);
