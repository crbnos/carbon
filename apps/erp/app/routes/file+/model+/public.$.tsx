import { notFound } from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  downloadCompanyPrivateObject,
  getCompanyPrivateBucket,
  supportedModelTypes
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
  flac: "audio/flac"
};

export async function loader({ params }: LoaderFunctionArgs) {
  const client = getCarbonServiceRole();

  const path = params["*"];

  if (!path) throw new Error("Path not found");
  const objectPath = path;
  const companyId = objectPath.split("/")[0] ?? "";

  if (!companyId || !objectPath.includes("models")) {
    throw notFound("Invalid path");
  }

  const fileType = objectPath.split(".").pop()?.toLowerCase();

  if (
    !fileType ||
    (!(fileType in supportedFileTypes) &&
      !supportedModelTypes.includes(fileType))
  )
    throw new Error(`File type ${fileType} not supported`);
  const contentType =
    supportedFileTypes[fileType] ?? "application/octet-stream";

  async function downloadFile(): Promise<Blob | null> {
    const result = await downloadCompanyPrivateObject<Blob>({
      companyId,
      objectPath,
      requestedBucket: getCompanyPrivateBucket(companyId),
      downloadObject: (physicalBucket, objectPath) =>
        client.storage.from(physicalBucket).download(objectPath)
    });

    return result?.data ?? null;
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
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=31536000, immutable",
    "Access-Control-Allow-Origin": "*", // Allow cross-origin requests
    "Access-Control-Allow-Methods": "GET", // Only allow GET requests
    "Access-Control-Allow-Headers": "Content-Type" // Allow Content-Type header
  });
  return new Response(fileData, { status: 200, headers });
}
