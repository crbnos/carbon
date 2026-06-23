import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { nanoid } from "nanoid";
import { inngest } from "../../client";
import { buildCompanyArtifact } from "./company-export";
import { getJobDatabaseClient, TEMPLATES_BUCKET } from "./company-template";

/**
 * Publish a source company into the demo catalog (internal tooling). Builds a
 * fresh artifact from the source company, writes it into the shared
 * `company-templates` bucket, and upserts the `companyTemplate` row — keyed
 * one-per-industry, so re-publishing an industry replaces its demo in place
 * (reusing the existing path, leaving no orphan gzip).
 *
 * `sourceCompanyId` is set to the source company so the `refresh-demo-catalog`
 * job can re-export it after future migrations.
 */
export const publishDemoFunction = inngest.createFunction(
  {
    id: "publish-demo",
    retries: 1,
    concurrency: { key: "event.data.companyId", limit: 1 }
  },
  { event: "carbon/publish-demo" },
  async ({ event, step }) => {
    const { companyId, userId, industryId, includeStorage, name, description } =
      event.data;

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

      // One canonical demo per industry — replace the existing one in place
      // (reuse its path so no orphan gzip is left). Untagged demos insert fresh.
      const existing = industryId
        ? await client
            .from("companyTemplate")
            .select("id, artifactPath")
            .eq("industryId", industryId)
            .maybeSingle()
        : { data: null };

      const artifactPath =
        existing.data?.artifactPath ?? `${nanoid()}.carbon.json.gz`;
      const upload = await client.storage
        .from(TEMPLATES_BUCKET)
        .upload(artifactPath, compressed, {
          contentType: "application/gzip",
          upsert: true
        });
      if (upload.error) throw new Error(upload.error.message);

      const row = {
        name,
        description: description ?? null,
        industryId: industryId ?? null,
        sourceCompanyId: companyId,
        sourceCompanyName: manifest.sourceCompanyName,
        artifactPath,
        schemaVersion: manifest.schemaVersion,
        includesStorage: (includeStorage ?? "none") === "all",
        rowCount: rows,
        isPublic: true
      };

      const result = existing.data
        ? await client
            .from("companyTemplate")
            .update({
              ...row,
              updatedBy: userId,
              updatedAt: new Date().toISOString()
            })
            .eq("id", existing.data.id)
        : await client
            .from("companyTemplate")
            .insert({ ...row, createdBy: userId });
      if (result.error) throw new Error(result.error.message);

      console.log("Demo published", {
        sourceCompanyId: companyId,
        artifactPath,
        rows,
        schemaVersion: manifest.schemaVersion,
        replaced: Boolean(existing.data)
      });

      return {
        artifactPath,
        rows,
        schemaVersion: manifest.schemaVersion,
        replaced: Boolean(existing.data)
      };
    });
  }
);
