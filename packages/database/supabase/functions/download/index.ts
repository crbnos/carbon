import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { z } from "npm:zod@^4.5.4";

import { getFunctionLogger } from "../lib/logging.ts";
import { corsPreflight, errorResponse, jsonResponse } from "../lib/response.ts";
import { requirePermissions } from "../lib/supabase.ts";

const logger = getFunctionLogger("download");

const downloadValidator = z.object({
  bucket: z.string(),
  path: z.string(),
  companyId: z.string(),
  userId: z.string(),
});

// The storage API receives the path as a raw URL path: its parser ends the
// path at a raw `?`/`#`, drops tabs/newlines, reads `\` as `/` and resolves
// `.`/`..` segments even when percent-encoded (`%2e%2e`). So the segment and
// prefix checks run on the DECODED form — checking the raw string lets
// `<companyId>/%2e%2e/<otherCompanyId>/…` through.
function isCompanyStoragePath(path: string, companyId: string): boolean {
  if (/[?#]/.test(path)) return false;
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return false;
  }
  for (const char of decoded) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return false;
  }
  const segments = decoded.split(/[/\\]/);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return false;
  }
  return segments[0] === companyId;
}

serve(async (req: Request) => {
  const preflight = corsPreflight(req);
  if (preflight) return preflight;
  const payload = await req.json();

  try {
    const validatedPayload = downloadValidator.parse(payload);
    const { bucket, path, companyId, userId } = validatedPayload;

    logger.info({ bucket, path, companyId, userId });

    // verify that the request is authorized by an API key or service role
    const serviceRole = await requirePermissions(req, companyId, userId, { view: "documents" });

    // The client is service-role, so storage RLS is bypassed: requirePermissions
    // proved the caller may act in companyId, not that bucket/path are its own.
    // Allow the company's own bucket (or the legacy shared `private` bucket, or
    // the shared `public` / `temp-staging` buckets), and only a path under the
    // companyId segment.
    const allowedBucket =
      bucket === companyId ||
      bucket === "private" ||
      bucket === "public" ||
      bucket === "temp-staging";
    if (!allowedBucket || !isCompanyStoragePath(path, companyId)) {
      return errorResponse("File not found", 404);
    }

    const signedUrl = await serviceRole.storage
      .from(bucket)
      .createSignedUrl(path, 60);

    if (signedUrl.error) {
      return errorResponse(signedUrl.error, 404);
    }

    return jsonResponse({
      success: true,
      signedUrl: signedUrl.data?.signedUrl,
    });
  } catch (err) {
    return errorResponse(err, 500);
  }
});
