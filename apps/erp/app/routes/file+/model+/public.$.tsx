import { notFound } from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getContentType, MEDIA_CONTENT_TYPES } from "@carbon/files";
import { supportedModelTypes } from "@carbon/files/cad";
import { getLogger } from "@carbon/logger";
import { downloadCompanyPrivateObject } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";

const logger = getLogger("erp", "public");

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
    (!(fileType in MEDIA_CONTENT_TYPES) &&
      !supportedModelTypes.includes(fileType))
  )
    throw new Error(`File type ${fileType} not supported`);
  const contentType = getContentType(fileType);

  // No auth session on this public route — the object path's first segment is
  // the companyId, which selects the per-company bucket (with legacy fallback).
  const companyId = path.split("/")[0];

  async function downloadFile() {
    const result = await downloadCompanyPrivateObject({
      storage: client.storage,
      companyId,
      objectPath: `${path}`
    });
    if (!result.data) {
      logger.error("Failed to download file", { errors: result.errors });
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
