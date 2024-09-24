import { type LoaderFunctionArgs } from "@vercel/remix";
import { requirePermissions } from "~/services/auth/auth.server";

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
};

export let loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { client } = await requirePermissions(request, {
    view: "documents",
  });
  const { bucket } = params;
  const path = params["*"];

  if (!bucket) throw new Error("Bucket not found");
  if (!path) throw new Error("Path not found");

  const fileType = path.split(".").pop();
  if (!fileType || !(fileType in supportedFileTypes))
    throw new Error("File type not supported");
  const contentType = supportedFileTypes[fileType];

  const result = await client.storage.from(bucket).download(`${path}`);
  if (result.error) {
    throw new Error("Failed to load file");
  }

  const headers = new Headers({
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=3600", // Cache for 1 hour
  });
  return new Response(result.data, { status: 200, headers });
};
