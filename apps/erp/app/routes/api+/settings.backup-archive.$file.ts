import { createGzip } from "node:zlib";
import { requirePermissions } from "@carbon/auth/auth.server";
import { isInternalEmail } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LoaderFunctionArgs } from "react-router";
import { pack as tarPack } from "tar-stream";

/** List every object under a storage prefix, returning paths relative to it. */
async function listRelative(
  client: SupabaseClient,
  bucket: string,
  prefix: string,
  base: string = prefix
): Promise<string[]> {
  const out: string[] = [];
  const { data } = await client.storage
    .from(bucket)
    .list(prefix, { limit: 1000 });
  if (!data) return out;
  for (const entry of data) {
    const full = `${prefix}/${entry.name}`;
    if (entry.id === null) {
      out.push(...(await listRelative(client, bucket, full, base)));
    } else {
      out.push(full.slice(base.length + 1));
    }
  }
  return out;
}

/**
 * Stream a self-contained `.carbon.tar.gz` of a backup: the whole
 * `exports/<name>/` folder (manifest, per-table files, assets) bundled into one
 * gzipped tar so a cross-environment import carries everything. Storage keeps the
 * folder layout; the tar only exists in transit, and one file is buffered at a
 * time, so a large backup streams at flat memory.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, email } = await requirePermissions(request, {
    view: "settings"
  });
  if (!isInternalEmail(email)) throw new Response("Not found", { status: 404 });

  const name = params.file ?? "";
  if (!name || name.includes("/")) {
    throw new Response("Invalid backup", { status: 400 });
  }
  const dir = `exports/${name}`;

  const relPaths = await listRelative(client, companyId, dir);
  if (relPaths.length === 0) {
    throw new Response("Backup not found", { status: 404 });
  }

  const archive = tarPack();
  const addEntry = (entryName: string, body: Buffer) =>
    new Promise<void>((resolve, reject) => {
      archive.entry({ name: entryName }, body, (err) =>
        err ? reject(err) : resolve()
      );
    });

  (async () => {
    try {
      for (const rel of relPaths) {
        const f = await client.storage
          .from(companyId)
          .download(`${dir}/${rel}`);
        if (f.error || !f.data) continue; // best-effort
        await addEntry(rel, Buffer.from(await f.data.arrayBuffer()));
      }
      archive.finalize();
    } catch (err) {
      archive.destroy(err as Error);
    }
  })();

  // tar -> gzip -> web stream. (Readable.toWeb yields a byte stream undici rejects
  // with "highWaterMark is required", so drain the gzip output by hand.)
  const gzip = createGzip();
  archive.on("error", (err) => gzip.destroy(err));
  archive.pipe(gzip);
  const stream = new ReadableStream({
    start(controller) {
      gzip.on("data", (chunk: Buffer) =>
        controller.enqueue(new Uint8Array(chunk))
      );
      gzip.on("end", () => controller.close());
      gzip.on("error", (err) => controller.error(err));
    },
    cancel() {
      gzip.destroy();
      archive.destroy();
    }
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="${name}.carbon.tar.gz"`
    }
  });
}
