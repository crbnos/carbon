// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  fileResponseHeaders,
  getContentType,
  getFileExtension,
  hasCompanyPrivateObjectPathPrefix,
  isStorageNotFound,
  isUnsafeStoragePath,
  storage,
  storageErrorStatus
} from "@carbon/files";
import { Ratelimit, redis } from "@carbon/kv";
import { getLogger } from "@carbon/logger";
import { getClientIp } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import {
  getJobByOperationId,
  getJobOperationFileRecord
} from "~/modules/production/production.service";
import { getActiveCustomerPortal } from "~/modules/sales/sales.service";
import { customerPortalServesFile } from "~/modules/sales/sales.utils";
import { parseJobFilePath } from "~/utils/supabase";

const logger = getLogger("erp", "share", "customer-portal");

export let loader = async ({ params, request }: LoaderFunctionArgs) => {
  const { id } = params;
  if (!id) {
    throw new Error("Customer ID is required");
  }

  const ip = getClientIp(request) ?? "127.0.0.1";
  const ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, "1 m"), // 10 downloads per minute
    analytics: true
  });
  const { success } = await ratelimit.limit(ip);

  if (!success) {
    return new Response(null, { status: 429 });
  }

  const serviceRole = getCarbonServiceRole();
  const customer = await getActiveCustomerPortal(serviceRole, id);

  if (customer.refusal) {
    return new Response(null, {
      status: customer.refusal === "error" ? 500 : 404
    });
  }

  // hoisted so the narrowing survives into downloadFile's closure
  const shareCompanyId = customer.data.companyId;

  let path = params["*"];

  if (!path) throw new Error("Path not found");

  path = decodeURIComponent(path);

  if (isUnsafeStoragePath(path)) {
    logger.error("Refused a storage path that escapes its prefix", {
      companyId: shareCompanyId,
      path
    });
    return new Response(null, { status: 404 });
  }

  // Private objects are keyed by companyId — a path outside the portal's
  // company must not resolve to another tenant's bucket.
  if (!hasCompanyPrivateObjectPathPrefix(customer.data.companyId, path)) {
    return new Response(null, { status: 404 });
  }

  // Photos and PDFs only: CAD models and drawings can be export-controlled.
  if (!customerPortalServesFile(path)) {
    logger.warn("Customer portal refused a file type it does not serve", {
      companyId: shareCompanyId,
      path
    });
    return new Response(null, { status: 404 });
  }

  const jobFile = parseJobFilePath(path);

  if (!jobFile || jobFile.companyId !== customer.data.companyId) {
    return new Response(null, { status: 403 });
  }

  const { operationId } = jobFile;

  const job = await getJobByOperationId(serviceRole, operationId);

  if (job.error) {
    logger.error("Failed to get job by operation id", { error: job.error });
    return new Response(null, { status: 403 });
  }

  if (job.data.companyId !== customer.data.companyId) {
    return new Response(null, { status: 403 });
  }

  if (job.data.customerId !== customer.data.customerId) {
    return new Response(null, { status: 403 });
  }

  // Only a file recorded on a File step of the operation, which is what the
  // portal links to; any other file in the operation's folder is not shared.
  const fileRecord = await getJobOperationFileRecord(
    serviceRole,
    shareCompanyId,
    operationId,
    path
  );
  if (fileRecord.error) {
    logger.error("Failed to read the job operation file record", {
      companyId: shareCompanyId,
      operationId,
      error: fileRecord.error
    });
    return new Response(null, { status: 500 });
  }
  if (!fileRecord.data) {
    logger.warn("Customer portal refused a file no step recorded", {
      companyId: shareCompanyId,
      operationId,
      path
    });
    return new Response(null, { status: 404 });
  }

  const contentType = getContentType(getFileExtension(path));

  const { data: fileData, error } = await storage(serviceRole)
    .company(shareCompanyId)
    .download(path);
  if (error) {
    logger.error("Failed to download file", {
      path,
      status: storageErrorStatus(error),
      error
    });
    return new Response(null, {
      status: (await isStorageNotFound(error)) ? 404 : 500
    });
  }

  const headers = fileResponseHeaders(
    contentType,
    // Revalidate every use: a cached copy would outlive the portal's expiry
    // or the customer's status.
    "private, no-cache"
  );
  return new Response(fileData, { status: 200, headers });
};
