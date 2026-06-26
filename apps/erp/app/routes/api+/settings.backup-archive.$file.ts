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

/** How many objects to download concurrently while packing the tar in order.
 *  Bounds memory to ~this many buffered files (NOT the whole backup). */
const DOWNLOAD_CONCURRENCY = 6;

/**
 * Stream a self-contained `.carbon.tar.gz` of a backup's `exports/<name>/` folder
 * (manifest, per-table files, assets) so a cross-environment import carries
 * everything. Objects are prefetched in a bounded window (overlapping downloads)
 * but packed in order, so memory stays bounded to ~DOWNLOAD_CONCURRENCY files.
 * Outer gzip is level 1 — the entries are already compressed — but stays a valid
 * gzip tar, which `backups-archive.server.ts` unpacks on re-import.
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

  const downloadAt = (i: number): Promise<Buffer | null> =>
    client.storage
      .from(companyId)
      .download(`${dir}/${relPaths[i]}`)
      .then((f) =>
        f.error || !f.data
          ? null
          : f.data.arrayBuffer().then((b) => Buffer.from(b))
      )
      .catch(() => null); // best-effort: a missing/failed object is skipped

  (async () => {
    try {
      // Sliding window: keep up to DOWNLOAD_CONCURRENCY downloads in flight, but
      // write entries to the tar strictly in index order.
      const inflight = new Map<number, Promise<Buffer | null>>();
      const prime = Math.min(DOWNLOAD_CONCURRENCY, relPaths.length);
      for (let i = 0; i < prime; i++) inflight.set(i, downloadAt(i));

      for (let i = 0; i < relPaths.length; i++) {
        const buf = await inflight.get(i)!;
        inflight.delete(i);
        const next = i + DOWNLOAD_CONCURRENCY;
        if (next < relPaths.length) inflight.set(next, downloadAt(next));
        if (buf) await addEntry(relPaths[i], buf);
      }
      archive.finalize();
    } catch (err) {
      archive.destroy(err as Error);
    }
  })();

  // tar -> gzip -> web stream. (Readable.toWeb yields a byte stream undici rejects
  // with "highWaterMark is required", so drain the gzip output by hand.)
  const gzip = createGzip({ level: 1 });
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
