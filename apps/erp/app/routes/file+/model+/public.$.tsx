// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { notFound } from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  fileResponseHeaders,
  getContentType,
  isStorageNotFound,
  isUnsafeStoragePath,
  storage,
  storageErrorStatus
} from "@carbon/files";
import { getLogger } from "@carbon/logger";
import type { LoaderFunctionArgs } from "react-router";

const logger = getLogger("erp", "public");

export async function loader({ params }: LoaderFunctionArgs) {
  const client = getCarbonServiceRole();

  const path = params["*"];

  if (!path) throw new Error("Path not found");

  // Unauthenticated: the unguessable model id in the key is the only
  // credential, so serve model objects (`${companyId}/models/…`) and nothing
  // else — never any object whose key merely contains "models".
  if (path.split("/")[1] !== "models" || isUnsafeStoragePath(path)) {
    logger.error("Refused a public model path", { path });
    throw notFound("Invalid path");
  }

  // Only the GLB the model viewer draws (`/file/model/$id`, rendered headless
  // for thumbnails). Any other type here is a tenant-uploaded file served with
  // no session — an SVG under models/ ran script on our origin.
  if (path.split(".").pop()?.toLowerCase() !== "glb") {
    logger.error("Refused a public model file type", { path });
    throw notFound("Invalid path");
  }

  // No auth session on this public route — the object path's first segment is
  // the companyId, which selects the per-company bucket (with legacy fallback).
  const companyId = path.split("/")[0];

  const { data: fileData, error } = await storage(client)
    .company(companyId)
    .download(path);
  if (error) {
    logger.error("Failed to download file", {
      path,
      status: storageErrorStatus(error),
      error
    });
    if (await isStorageNotFound(error)) throw notFound("File not found");
    throw new Response(null, { status: 500 });
  }

  const headers = fileResponseHeaders(
    getContentType("glb"),
    "public, max-age=31536000, immutable"
  );
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  return new Response(fileData, { status: 200, headers });
}
