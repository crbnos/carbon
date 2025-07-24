import { getCarbonServiceRole } from "@carbon/auth";
import { redis } from "@carbon/kv";
import { supportedModelTypes } from "@carbon/react";
import { Ratelimit } from "@upstash/ratelimit";
import { type LoaderFunctionArgs } from "@vercel/remix";
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
  step: "application/step",
};

const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "1 m"), // 10 downloads per minute
  analytics: true,
});

export let loader = async ({ params, request }: LoaderFunctionArgs) => {
  const { id } = params;
  if (!id) {
    throw new Error("Customer ID is required");
  }

  const ip = request.headers.get("x-forwarded-for") ?? "127.0.0.1";

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

  if (!customer.data.customerId) {
    console.error(customer.error);
    throw new Error("Customer not found");
  }

  let path = params["*"];
  let bucket = "private"; // TODO: refactor to use companyId when we separate the storage buckets

  if (!path) throw new Error("Path not found");

  path = decodeURIComponent(path);

  const pathMatch = params["*"]?.match(/^([^/]+)\/job\/([^/]+)\/[^/]+$/);
  const companyId = pathMatch?.[1];
  const operationId = pathMatch?.[2];

  const fileType = path.split(".").pop()?.toLowerCase();

  if (companyId !== customer.data.companyId) {
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

  if (job.data.companyId !== customer.data.companyId) {
    return new Response(null, { status: 403 });
  }

  if (job.data.customerId !== customer.data.customerId) {
    return new Response(null, { status: 403 });
  }

  if (
    !fileType ||
    (!(fileType in supportedFileTypes) &&
      !supportedModelTypes.includes(fileType))
  )
    throw new Error(`File type ${fileType} not supported`);
  const contentType = supportedFileTypes[fileType];

  if (!path.includes(customer.data.companyId)) {
    return new Response(null, { status: 403 });
  }

  async function downloadFile() {
    const result = await serviceRole.storage.from(bucket!).download(`${path}`);
    if (result.error) {
      console.error(result.error);
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
    "Cache-Control": "private, max-age=31536000, immutable",
  });
  return new Response(fileData, { status: 200, headers });
};
