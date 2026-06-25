import type { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { extract as tarExtract } from "tar-stream";

/**
 * Unpack a `.carbon.tar.gz` (a whole backup folder) into a fresh
 * `exports/<name>/` so restore/import can read it. Streams entry-by-entry — every
 * file is small and under the bucket size cap — so a multi-GB prod backup is
 * never uploaded as one (over-cap) object. Returns the folder name.
 *
 * Server-only (tar-stream + zlib). Shared by the Settings upload route and the
 * onboarding "restore from a backup" flow.
 */
export async function unpackBackupArchive(
  client: SupabaseClient<Database>,
  companyId: string,
  source: Readable
): Promise<{ name: string; fileErrors: number }> {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const name = `${ts}_uploaded`;
  const dir = `exports/${name}`;
  let manifestSeen = false;
  let fileErrors = 0;

  const extract = tarExtract();
  const gunzip = createGunzip();
  source.on("error", (err) => extract.destroy(err));
  gunzip.on("error", (err) => extract.destroy(err));

  await new Promise<void>((resolve, reject) => {
    extract.on("entry", (header, stream, next) => {
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("error", next);
      stream.on("end", async () => {
        try {
          const rel = header.name;
          // Reject path traversal; only land files inside this backup's folder.
          if (rel.includes("..") || rel.startsWith("/")) {
            next();
            return;
          }
          if (rel === "manifest.json") manifestSeen = true;
          const up = await client.storage
            .from(companyId)
            .upload(`${dir}/${rel}`, Buffer.concat(chunks), { upsert: true });
          if (up.error) fileErrors++;
          next();
        } catch (err) {
          next(err as Error);
        }
      });
    });
    extract.on("finish", resolve);
    extract.on("error", reject);
    source.pipe(gunzip).pipe(extract);
  });

  if (!manifestSeen) {
    throw new Error("Archive is missing manifest.json");
  }
  return { name, fileErrors };
}
