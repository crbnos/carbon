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
