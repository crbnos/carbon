import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import {
  PutObjectCommand,
  S3Client,
} from "https://deno.land/x/aws_sdk@v3.32.0-1/client-s3/mod.ts";
import {
  AnalyzeDocumentCommand,
  TextractClient,
} from "https://deno.land/x/aws_sdk@v3.32.0-1/client-textract/mod.ts";

import z from "https://deno.land/x/zod@v3.23.8/index.ts";
import { corsHeaders } from "../lib/headers.ts";
import { getSupabaseServiceRole } from "../lib/supabase.ts";

const s3Client = new S3Client({
  region: Deno.env.get("AWS_REGION"),
  credentials: {
    accessKeyId: Deno.env.get("AWS_ACCESS_KEY_ID")!,
    secretAccessKey: Deno.env.get("AWS_SECRET_ACCESS_KEY")!,
  },
});

const textractClient = new TextractClient({
  region: Deno.env.get("AWS_REGION"),
  credentials: {
    accessKeyId: Deno.env.get("AWS_ACCESS_KEY_ID")!,
    secretAccessKey: Deno.env.get("AWS_SECRET_ACCESS_KEY")!,
  },
});

const payloadValidator = z.object({
  path: z.string(),
});

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const payload = await req.json();

  try {
    const { path } = payloadValidator.parse(payload);

    console.log({
      function: "textract",
      path,
    });

    const supabase = getSupabaseServiceRole(req.headers.get("Authorization"));

    // Download file from Supabase Storage
    const { data, error } = await supabase.storage
      .from("documents")
      .download(path);

    if (error) throw error;

    // Upload file to S3
    const s3Key = `textract/${Date.now()}-${path.split("/").pop()}`;
    await s3Client.send(
      new PutObjectCommand({
        Bucket: Deno.env.get("AWS_S3_BUCKET"),
        Key: s3Key,
        Body: data,
      })
    );

    // Analyze document with Textract
    const textractResponse = await textractClient.send(
      new AnalyzeDocumentCommand({
        Document: {
          S3Object: {
            Bucket: Deno.env.get("AWS_S3_BUCKET"),
            Name: s3Key,
          },
        },
        FeatureTypes: ["FORMS", "TABLES"],
      })
    );

    return new Response(
      JSON.stringify({
        success: true,
        analysis: textractResponse,
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
