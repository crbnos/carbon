import { notFound } from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getLogger } from "@carbon/logger";
import { supportedModelTypes } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";

const logger = getLogger("erp", "public");

const supportedFileTypes: Record<string, string> = {
  glb: "model/gltf-binary",
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

  if (!path.includes("models")) {
    throw notFound("Invalid path");
  }

  const fileType = path.split(".").pop()?.toLowerCase();

  if (
    !fileType ||
    (!(fileType in supportedFileTypes) &&
      !supportedModelTypes.includes(fileType))
  )
    throw new Error(`File type ${fileType} not supported`);
  const contentType = supportedFileTypes[fileType];

  async function downloadFile() {
    const result = await client.storage.from("private").download(`${path}`);
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
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=31536000, immutable",
    "Access-Control-Allow-Origin": "*", // Allow cross-origin requests
    "Access-Control-Allow-Methods": "GET", // Only allow GET requests
    "Access-Control-Allow-Headers": "Content-Type" // Allow Content-Type header
  });
  return new Response(fileData, { status: 200, headers });
}
