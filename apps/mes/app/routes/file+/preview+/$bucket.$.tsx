import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  downloadCompanyPrivateObject,
  getCompanyPrivateBucket,
  hasCompanyPrivateObjectPathPrefix
} from "@carbon/utils";

import type { LoaderFunctionArgs } from "react-router";

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
  const objectPath = params["*"];

  if (!bucket) throw new Error("Bucket not found");
  if (!objectPath) throw new Error("Path not found");
  const storageObjectPath = objectPath;

  const fileType = storageObjectPath.split(".").pop()?.toLowerCase();

  if (!fileType) {
    return new Response(null, { status: 400 });
  }
  const contentType = supportedFileTypes[fileType];

  const decodedPath = decodeURIComponent(objectPath);

  if (bucket !== getCompanyPrivateBucket(companyId)) {
    return new Response(null, { status: 403 });
  }

  if (!hasCompanyPrivateObjectPathPrefix(companyId, decodedPath)) {
    return new Response(null, { status: 403 });
  }

  const serviceRole = await getCarbonServiceRole();

  async function downloadFile(): Promise<Blob | null> {
    const result = await downloadCompanyPrivateObject<Blob>({
      companyId,
      objectPath: storageObjectPath,
      requestedBucket: bucket,
      downloadObject: async (physicalBucket, currentObjectPath) => {
        const result = await serviceRole.storage
          .from(physicalBucket)
          .download(currentObjectPath);

        return {
          data: result.data ?? null,
          error: result.error ?? null
        };
      }
    });

    return result?.data ?? null;
  }

  let fileData: Blob | null = await downloadFile();
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

  return new Response(fileData, { status: 200, headers });
};
