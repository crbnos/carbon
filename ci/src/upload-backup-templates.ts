import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

import { client } from "./client";

dotenv.config();

const TEMPLATE_BUCKET = "company-templates";
const BACKUP_SUFFIX = ".carbon.json.gz";

// The bucket the app serves per-company assets (3D models, …) from, and the
// shared prefix within it where each template's assets live ONCE per workspace.
// A template import references these instead of copying files per company.
// NOTE: `_templates` must match `TEMPLATE_ASSET_PREFIX` in
// packages/jobs/src/inngest/functions/tasks/company-backup.ts — keep in sync.
const PRIVATE_BUCKET = "private";
const TEMPLATE_ASSET_PREFIX = "_templates";

// Idempotent by default: skip any object that already exists, so re-running is a
// cheap no-op. Pass `--force` to overwrite (republish an updated template).
const FORCE = process.argv.includes("--force");

type StorageApi = ReturnType<typeof createClient>["storage"];

/**
 * Upload one object, idempotently. Without `--force`, an object that already
 * exists is left untouched and reported as "skipped" (the storage API returns a
 * 409 "Duplicate" we treat as success). With `--force`, it is overwritten.
 */
async function publishObject(
  storage: StorageApi,
  bucket: string,
  path: string,
  bytes: Buffer,
  contentType?: string
): Promise<"uploaded" | "skipped" | { error: string }> {
  const { error } = await storage
    .from(bucket)
    .upload(path, bytes, { upsert: FORCE, contentType });
  if (!error) return "uploaded";

  const alreadyExists =
    (error as { statusCode?: string }).statusCode === "409" ||
    /already exists|duplicate/i.test(error.message);
  if (!FORCE && alreadyExists) return "skipped";

  return { error: error.message };
}

// Repo-committed onboarding demo templates. Authored manually (export a
// populated company from Settings → Backups, download the .gz, commit it here),
// versioned so we control when to break backwards compatibility via the
// backup's own manifest version.
const BACKUPS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "packages",
  "database",
  "supabase",
  "backups"
);

type Workspace = {
  id: number;
  database_url: string | null;
  service_role_key: string | null;
};

type TemplateAsset = { path: string; bytes: Buffer };
type Template = {
  fileName: string;
  industryId: string;
  bytes: Buffer;
  assets: TemplateAsset[];
};

async function loadTemplates(): Promise<Template[]> {
  let entries: string[];
  try {
    entries = await readdir(BACKUPS_DIR);
  } catch {
    return [];
  }
  const files = entries.filter((f) => f.endsWith(BACKUP_SUFFIX));
  return Promise.all(
    files.map(async (fileName) => {
      const bytes = await readFile(join(BACKUPS_DIR, fileName));
      const industryId = fileName.slice(0, -BACKUP_SUFFIX.length);
      return {
        fileName,
        industryId,
        bytes,
        assets: extractTemplateAssets(industryId, bytes)
      };
    })
  );
}

// A template gz embeds its storage assets keyed by the source company's path
// (`{sourceCompanyId}/models/{id}.stl`). Pull them out and rekey to the shared
// `_templates/{industryId}/…` location so a referenced import can point at them
// without copying. Mirrors `rewriteToTemplateAssetPath` in @carbon/jobs.
function extractTemplateAssets(
  industryId: string,
  gzBytes: Buffer
): TemplateAsset[] {
  let backup: {
    manifest?: { sourceCompanyId?: string };
    storage?: Record<string, string>;
  };
  try {
    backup = JSON.parse(gunzipSync(gzBytes).toString());
  } catch (err) {
    console.error(`🔴 ${industryId}: failed to read template gz`, err);
    return [];
  }

  const sourceCompanyId = backup.manifest?.sourceCompanyId;
  const storage = backup.storage;
  if (!sourceCompanyId || !storage) return [];

  const assets: TemplateAsset[] = [];
  for (const [path, base64] of Object.entries(storage)) {
    const rest = path.startsWith(`${sourceCompanyId}/`)
      ? path.slice(sourceCompanyId.length + 1)
      : path;
    assets.push({
      path: `${TEMPLATE_ASSET_PREFIX}/${industryId}/${rest}`,
      bytes: Buffer.from(base64, "base64")
    });
  }
  return assets;
}

// Manual publish step (NOT run on every deploy — see the "Publish backup
// templates" workflow). Templates change rarely and are large, so they're
// published deliberately. Multi-tenant: each workspace is its own Supabase
// project (its own url + service-role key in the workspaces table), so we upload
// the repo templates into every workspace's company-templates bucket and fan
// their assets into the shared `_templates/` prefix. Onboarding then provisions
// a new company from the matching <industryId> template. Idempotent: existing
// objects are skipped unless `--force` is passed.
async function main(): Promise<void> {
  const templates = await loadTemplates();
  if (templates.length === 0) {
    console.log("⏭️ No backup templates committed — nothing to upload");
    return;
  }
  console.log(
    `✅ Publishing ${templates.length} backup template(s)${
      FORCE ? " (force overwrite)" : " (skip existing)"
    }: ${templates.map((t) => t.fileName).join(", ")}`
  );

  const { data: workspaces, error } = await client
    .from("workspaces")
    .select("id, database_url, service_role_key");

  if (error) {
    console.error("🔴 Failed to fetch workspaces", error);
    process.exit(1);
  }

  let hasErrors = false;

  for (const ws of (workspaces ?? []) as Workspace[]) {
    if (!ws.database_url || !ws.service_role_key) {
      console.log(`⏭️ Skipping workspace ${ws.id} — missing url/service key`);
      continue;
    }

    const storage = createClient(ws.database_url, ws.service_role_key).storage;
    for (const { fileName, bytes, assets } of templates) {
      const gz = await publishObject(
        storage,
        TEMPLATE_BUCKET,
        `templates/${fileName}`,
        bytes,
        "application/gzip"
      );
      if (typeof gz === "object") {
        console.error(
          `🔴 Workspace ${ws.id}: failed to upload templates/${fileName}`,
          gz.error
        );
        hasErrors = true;
      }

      // Fan the template's storage assets into the shared `_templates/` prefix
      // so onboarding-from-template can reference them instead of copying files
      // into every company's bucket.
      let uploaded = gz === "uploaded" ? 1 : 0;
      let skipped = gz === "skipped" ? 1 : 0;
      for (const asset of assets) {
        const result = await publishObject(
          storage,
          PRIVATE_BUCKET,
          asset.path,
          asset.bytes
        );
        if (typeof result === "object") {
          console.error(
            `🔴 Workspace ${ws.id}: failed to upload ${asset.path}`,
            result.error
          );
          hasErrors = true;
        } else if (result === "uploaded") {
          uploaded++;
        } else {
          skipped++;
        }
      }
      console.log(
        `✅ Workspace ${ws.id}: ${fileName} — ${uploaded} uploaded, ${skipped} skipped`
      );
    }
  }

  if (hasErrors) {
    console.error("🔴 Backup template upload completed with errors");
    process.exit(1);
  }

  console.log("✅ Uploaded backup templates to all workspaces");
}

main().catch((err) => {
  console.error("🔴 upload-backup-templates failed", err);
  process.exit(1);
});
