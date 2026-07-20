import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getLogger } from "@carbon/logger";
import type { LoaderFunctionArgs } from "react-router";

const logger = getLogger("erp", "bucket");

const supportedFileTypes: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  svg: "image/svg+xml",
  avif: "image/avif",
  webp: "image/webp",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  wmv: "video/x-ms-wmv",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  dxf: "application/dxf",
  dwg: "application/dxf",
  stl: "application/stl",
  obj: "application/obj",
  glb: "application/glb",
  gltf: "application/gltf",
  fbx: "application/fbx",
  ply: "application/ply",
  off: "application/off",
  step: "application/step"
};

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
  const effectiveType = isZst
    ? path.slice(0, -4).split(".").pop()?.toLowerCase()
    : fileType;
  const contentType = effectiveType
    ? supportedFileTypes[effectiveType]
    : undefined;

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

  const serviceRole = await getCarbonServiceRole();

  async function downloadFile() {
    if (!path) throw new Error("Path not found");
    // Use the original encoded path for the storage API call
    const result = await serviceRole.storage.from(bucket!).download(path);
    if (result.error) {
      logger.error(result.error);
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
      throw new Error("Failed to download file after retry");
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
