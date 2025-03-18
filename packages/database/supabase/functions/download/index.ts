import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { z } from "npm:zod@^3.24.1";

import { corsHeaders } from "../lib/headers.ts";
import { getSupabaseServiceRole } from "../lib/supabase.ts";

const downloadValidator = z.object({
  bucket: z.string(),
  path: z.string(),
  companyId: z.string(),
});

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const payload = await req.json();

  try {
    const validatedPayload = downloadValidator.parse(payload);
    const { bucket, path, companyId } = validatedPayload;

    console.log({
      function: "download",
      bucket,
      path,
      companyId,
    });

    // verify that the request is authorized by an API key or service role
    const serviceRole = await getSupabaseServiceRole(
      req.headers.get("Authorization"),
      req.headers.get("carbon-key") ?? "",
      companyId
    );

    const signedUrl = await serviceRole.storage
      .from(bucket)
      .createSignedUrl(path, 60);

    if (signedUrl.error) {
      return new Response(
        JSON.stringify({
          success: false,
          error: signedUrl.error.message,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 404,
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        signedUrl: signedUrl.data?.signedUrl,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify(err), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
