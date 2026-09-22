import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { companyHasFeature } from "@carbon/ee/plan.server";
import {
  getContentType,
  hasCompanyPrivateObjectPathPrefix,
  MEDIA_CONTENT_TYPES,
  storage
} from "@carbon/files";
import { supportedModelTypes } from "@carbon/files/cad";
import { Ratelimit, redis } from "@carbon/kv";
import { getLogger } from "@carbon/logger";
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

  const ip = request.headers.get("x-forwarded-for") ?? "127.0.0.1";
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

  async function downloadFile() {
    const result = await storage(serviceRole)
      .company(shareCompanyId)
      .download(`${path}`);
    if (!result.data) {
      logger.error("Failed to download file", { error: result.error });
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
    "Cache-Control": "private, max-age=31536000, immutable"
  });
  return new Response(fileData, { status: 200, headers });
};
