import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { CompanyBucket } from "@carbon/files";
import {
  effectiveExtension,
  getCompanyPrivateBucket,
  getContentType,
  LEGACY_PRIVATE_BUCKET,
  storage
} from "@carbon/files";
import { getLogger } from "@carbon/logger";
import type { LoaderFunctionArgs } from "react-router";

const log = getLogger("mes");

export let loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { companyId } = await requirePermissions(request, {});
  const { bucket } = params;
  let path = params["*"];

  if (!bucket) throw new Error("Bucket not found");
  if (!path) throw new Error("Path not found");

  // Don't decode the path here - let Supabase handle the URL encoding
  // path = decodeURIComponent(path);

  const fileType = path.split(".").pop()?.toLowerCase();

  if (!fileType) {
    return new Response(null, { status: 400 });
  }
  // Retained CAD raws are stored zstd-compressed (`raw.step.zst`, …) to keep
  // them from lingering as the fat upload. Decompress on the way out so a
  // download yields the original, openable file. The content-type + extension
  // come from the underlying format, not the `.zst` wrapper.
  const isZst = fileType === "zst";
  const effectiveType = effectiveExtension(path);
  // HEIC is converted at upload, so this only serves legacy files and paths
  // that bypass the app (API uploads): browsers outside Safari can't render
  // HEIC, so ask storage for the imgproxy JPEG rendition instead.
  const isHeicFile = effectiveType === "heic" || effectiveType === "heif";
  let contentType = effectiveType ? getContentType(effectiveType) : undefined;

  // Authorize against the companyId as a full path segment (prefix or
  // slash-bounded), not a loose substring — `.includes(companyId)` lets
  // `<otherCo>/.../<yourCompanyId>.pdf` serve another company's private file.
  const decodedPath = decodeURIComponent(path);
  const ownsPath =
    decodedPath.startsWith(`${companyId}/`) ||
    decodedPath.includes(`/${companyId}/`);
  if (!ownsPath) {
    return new Response(null, { status: 403 });
  }

  // `public` and `temp-staging` are shared buckets legitimately served through
  // this route (file previews, staged CAD raw downloads); any other bucket id
  // that isn't the caller's own company bucket (or legacy `private`) would be
  // another tenant's private bucket — refuse it. The ownsPath check alone is
  // not enough: a slash-bounded match allows `<otherCo>/x/<yourCo>/file`.
  const isPrivateBucket =
    bucket === getCompanyPrivateBucket(companyId) ||
    bucket === LEGACY_PRIVATE_BUCKET;
  if (!isPrivateBucket && bucket !== "public" && bucket !== "temp-staging") {
    return new Response(null, { status: 403 });
  }

  const serviceRole = await getCarbonServiceRole();
  // A company-private request reads the company bucket with legacy fallback;
  // any other bucket is read as-is.
  const source: Pick<CompanyBucket, "download"> = isPrivateBucket
    ? storage(serviceRole).company(companyId)
    : storage(serviceRole).from(bucket);

  async function downloadFile() {
    if (!path) throw new Error("Path not found");
    if (isHeicFile) {
      const transformed = await source.download(path, {
        transform: { quality: 85 }
      });
      if (!transformed.error) {
        // imgproxy may negotiate webp via Accept — trust the blob, not the path
        contentType = transformed.data.type || "image/jpeg";
        return transformed.data;
      }
      // No imgproxy (stale self-host stack) — fall through to the raw bytes;
      // Safari can still render them.
      log.error("Failed to transform HEIC file", { error: transformed.error });
    }
    // Use the original encoded path for the storage API call
    const result = await source.download(path);
    if (result.error) {
      log.error("Failed to download file", { error: result.error });
      return null;
    }
    return result.data;
  }

  let fileData = await downloadFile();
  if (!fileData) {
    // Wait for a second and try again
    await new Promise((resolve) => setTimeout(resolve, 1000));
    fileData = await downloadFile();
    if (!fileData) {
      // A missing object is a clean 404, not a 500 — consumers (e.g. the model
      // download flow) branch on the status; an opaque error page body must
      // never be saved to disk as if it were the file.
      return new Response(null, { status: 404 });
    }
  }

  const headers = new Headers({
    "Cache-Control": "private, max-age=31536000, immutable"
  });

  if (contentType) {
    headers.set("Content-Type", contentType);
  }

  if (isZst) {
    // Stream the storage object through a zstd decompress transform (Node
    // >=22.15/24) rather than buffering the whole file — the decompressed source
    // can be large, and this keeps memory flat.
    const { createZstdDecompress } = await import("node:zlib");
    const { Readable } = await import("node:stream");
    const source = Readable.fromWeb(
      fileData.stream() as import("node:stream/web").ReadableStream
    );
    const decompressed = source.pipe(createZstdDecompress());
    return new Response(
      Readable.toWeb(decompressed) as unknown as ReadableStream,
      { status: 200, headers }
    );
  }

  return new Response(fileData, { status: 200, headers });
};
