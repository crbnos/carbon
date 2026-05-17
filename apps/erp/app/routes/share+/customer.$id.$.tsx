import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { Ratelimit, redis } from "@carbon/kv";
import {
  downloadCompanyPrivateObject,
  getCompanyPrivateBucket,
  hasCompanyPrivateObjectPathPrefix,
  supportedModelTypes
} from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { getJobByOperationId } from "~/modules/production";
import { getCustomerPortal } from "~/modules/shared/shared.service";

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
    console.error(customer.error);
    throw new Error("Customer not found");
  }

  const customerPortal = customer.data;

  if (!customerPortal?.customerId) {
    console.error(customer.error);
    throw new Error("Customer not found");
  }

  const objectPath = params["*"];

  if (!objectPath) throw new Error("Path not found");
  const storageObjectPath = objectPath;

  const decodedPath = decodeURIComponent(storageObjectPath);
  const [pathCompanyId, logicalFolder, operationId, fileName, ...rest] =
    decodedPath.split("/");

  const fileType = decodedPath.split(".").pop()?.toLowerCase();

  if (
    pathCompanyId !== customerPortal.companyId ||
    logicalFolder !== "job" ||
    !fileName ||
    rest.length > 0
  ) {
    return new Response(null, { status: 403 });
  }

  if (!operationId) {
    return new Response(null, { status: 403 });
  }

  const job = await getJobByOperationId(serviceRole, operationId);

  if (job.error) {
    console.error(job.error);
    return new Response(null, { status: 403 });
  }

  if (job.data.companyId !== customerPortal.companyId) {
    return new Response(null, { status: 403 });
  }

  if (job.data.customerId !== customerPortal.customerId) {
    return new Response(null, { status: 403 });
  }

  if (
    !fileType ||
    (!(fileType in supportedFileTypes) &&
      !supportedModelTypes.includes(fileType))
  )
    throw new Error(`File type ${fileType} not supported`);
  const contentType = supportedFileTypes[fileType];

  if (
    !hasCompanyPrivateObjectPathPrefix(customerPortal.companyId, decodedPath)
  ) {
    return new Response(null, { status: 403 });
  }

  async function downloadFile(): Promise<Blob | null> {
    const result = await downloadCompanyPrivateObject<Blob>({
      companyId: customerPortal.companyId,
      objectPath: storageObjectPath,
      requestedBucket: getCompanyPrivateBucket(customerPortal.companyId),
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
