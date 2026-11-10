// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createGzip } from "node:zlib";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getCompanyPrivateBucket } from "@carbon/files";
import { backupDir, listCompanyFiles } from "@carbon/jobs/backups";
import type { LoaderFunctionArgs } from "react-router";
import { pack as tarPack } from "tar-stream";
import {
  isUserBackupName,
  requireBackupAccess
} from "~/modules/settings/settings.service";

/** How many objects to download concurrently while packing the tar in order.
 *  Bounds memory to ~this many buffered files (NOT the whole backup). */
const DOWNLOAD_CONCURRENCY = 6;

/**
 * Stream a self-contained `.carbon.tar.gz` of a backup folder
 * (manifest, per-table files, assets) so a cross-environment import carries
 * everything. Objects are prefetched in a bounded window (overlapping downloads)
 * but packed in order, so memory stays bounded to ~DOWNLOAD_CONCURRENCY files.
 * Outer gzip is level 1 — the entries are already compressed — but stays a valid
 * gzip tar, which `unpackBackupArchive` unpacks on re-import.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await requireBackupAccess(request);

  const name = params.file ?? "";
  if (!isUserBackupName(name)) {
    throw new Response("Invalid backup", { status: 400 });
  }
  const dir = backupDir(name);
  // Backup objects are service-role only; the gate above guards this route.
  const serviceRole = getCarbonServiceRole();
  const bucket = getCompanyPrivateBucket(companyId);

  // A listing cut short would ship an archive that looks complete without the
  // files it left out; `listCompanyFiles` pages and throws on errors.
  const relPaths = (await listCompanyFiles(serviceRole, companyId, dir)).map(
    (f) => f.path.slice(dir.length + 1)
  );
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

  // A file that can't be read fails the download: skipped, the archive
  // would still carry its manifest and import as if complete.
  const downloadAt = (i: number): Promise<Buffer> => {
    const download = serviceRole.storage
      .from(bucket)
      .download(`${dir}/${relPaths[i]}`)
      .then((f) => {
        if (f.error || !f.data) {
          throw new Error(
            `Failed to read ${relPaths[i]}: ${f.error?.message ?? "no data"}`
          );
        }
        return f.data.arrayBuffer().then((b) => Buffer.from(b));
      });
    // Prefetched before it is awaited: mark it handled so an early failure
    // isn't an unhandled rejection (fatal in Node). The await still throws.
    download.catch(() => undefined);
    return download;
  };

  (async () => {
    try {
      // Sliding window: keep up to DOWNLOAD_CONCURRENCY downloads in flight, but
      // write entries to the tar strictly in index order.
      const inflight = new Map<number, Promise<Buffer>>();
      const prime = Math.min(DOWNLOAD_CONCURRENCY, relPaths.length);
      for (let i = 0; i < prime; i++) inflight.set(i, downloadAt(i));

      for (let i = 0; i < relPaths.length; i++) {
        const buf = await inflight.get(i)!;
        inflight.delete(i);
        const next = i + DOWNLOAD_CONCURRENCY;
        if (next < relPaths.length) inflight.set(next, downloadAt(next));
        await addEntry(relPaths[i], buf);
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
