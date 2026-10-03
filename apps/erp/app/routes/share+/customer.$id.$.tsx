// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { companyHasFeature } from "@carbon/ee/plan.server";
import {
  fileResponseHeaders,
  getContentType,
  hasCompanyPrivateObjectPathPrefix,
  isStorageNotFound,
  isUnsafeStoragePath,
  MEDIA_CONTENT_TYPES,
  storage,
  storageErrorStatus
} from "@carbon/files";
import { supportedModelTypes } from "@carbon/files/cad";
import { Ratelimit, redis } from "@carbon/kv";
import { getLogger } from "@carbon/logger";
import { getClientIp } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { getJobByOperationId } from "~/modules/production";
import { getCustomerPortal } from "~/modules/shared/shared.service";
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
  const customer = await getCustomerPortal(serviceRole, id);

  if (customer.error) {
    logger.error("Customer not found", { error: customer.error });
    throw new Error("Customer not found");
  }

  if (!customer.data.customerId) {
    logger.error("Customer not found", { error: customer.error });
    throw new Error("Customer not found");
  }

  // hoisted so the narrowing survives into downloadFile's closure
  const shareCompanyId = customer.data.companyId;

  const hasPlan = await companyHasFeature(serviceRole, shareCompanyId, {
    feature: "CUSTOMER_PORTALS"
  });
  if (!hasPlan) {
    return new Response(null, { status: 403 });
  }

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

  const jobFile = parseJobFilePath(path);

  const fileType = path.split(".").pop()?.toLowerCase();

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

  if (
    !fileType ||
    (!(fileType in MEDIA_CONTENT_TYPES) &&
      !supportedModelTypes.includes(fileType))
  )
    throw new Error(`File type ${fileType} not supported`);
  const contentType = getContentType(fileType);

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
    "private, max-age=31536000, immutable"
  );
  return new Response(fileData, { status: 200, headers });
};
