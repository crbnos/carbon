import { gunzipSync } from "node:zlib";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { nanoid } from "nanoid";
import { inngest } from "../../client";
import { type Artifact, TEMPLATES_BUCKET } from "./company-template";

/**
 * Publish an existing company export artifact into the demo catalog.
 *
 * Reuses the artifact the export engine already wrote to the source company
 * bucket — it never re-reads the live company. The artifact is copied into the
 * shared `company-templates` bucket and indexed in `companyTemplate` so any new
 * company can be provisioned from it during onboarding. Internal-only; the
 * caller (Data Management action) gates on `isInternal` before firing this.
 */
export const publishDemoFunction = inngest.createFunction(
  {
    id: "publish-demo",
    retries: 1,
    concurrency: { key: "event.data.companyId", limit: 1 }
  },
  { event: "carbon/publish-demo" },
  async ({ event, step }) => {
    const { companyId, userId, artifactPath, name, description, industryId } =
      event.data;

    return await step.run("publish-demo", async () => {
      const client = getCarbonServiceRole();

      // 1. Read the already-exported artifact from the source company bucket.
      const download = await client.storage
        .from(companyId)
        .download(artifactPath);
      if (download.error || !download.data) {
        throw new Error(
          `Failed to download artifact ${artifactPath}: ${download.error?.message}`
        );
      }
      const buffer = Buffer.from(await download.data.arrayBuffer());
      const artifact = JSON.parse(gunzipSync(buffer).toString()) as Artifact;
      const { manifest } = artifact;

      // 2. One canonical demo per industry — if one already exists, replace it
      // (reuse its artifact path so the bucket object is overwritten, leaving no
      // orphan). Untagged demos (no industry) are always inserted fresh.
      const existing = industryId
        ? await client
            .from("companyTemplate")
            .select("id, artifactPath")
            .eq("industryId", industryId)
            .maybeSingle()
        : { data: null };

      const catalogPath =
        existing.data?.artifactPath ?? `${nanoid()}.carbon.json.gz`;
      const upload = await client.storage
        .from(TEMPLATES_BUCKET)
        .upload(catalogPath, buffer, {
          contentType: "application/gzip",
          upsert: true
        });
      if (upload.error) throw new Error(upload.error.message);

      // 3. Index it (update the industry's demo in place, or insert a new one).
      const rowCount = manifest.tables.reduce((sum, t) => sum + t.rows, 0);
      const row = {
        name,
        description: description ?? null,
        industryId: industryId ?? null,
        sourceCompanyId: companyId,
        sourceCompanyName: manifest.sourceCompanyName,
        artifactPath: catalogPath,
        schemaVersion: manifest.schemaVersion,
        includesStorage: manifest.includeStorage === "all",
        rowCount
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
        artifactPath: catalogPath,
        rows: rowCount,
        schemaVersion: manifest.schemaVersion,
        replaced: Boolean(existing.data)
      });

      return {
        artifactPath: catalogPath,
        rows: rowCount,
        schemaVersion: manifest.schemaVersion,
        replaced: Boolean(existing.data)
      };
    });
  }
);
