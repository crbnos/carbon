import { SupabaseClient } from "@supabase/supabase-js";
import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { experimental_transcribe as transcribe } from "npm:ai@5.0.87";
import { z } from "npm:zod@^4.5.4";
import { openai } from "../lib/ai/openai.ts";
import { corsHeaders } from "../lib/headers.ts";
import { getFunctionLogger } from "../lib/logging.ts";
import { corsPreflight, errorResponse, jsonResponse } from "../lib/response.ts";
import { getSupabase } from "../lib/supabase.ts";
import { Database } from "../lib/types.ts";

const logger = getFunctionLogger("transcription");

const transcriptionRequestSchema = z.object({
  audio: z.string().describe("Base64 encoded audio data"),
  mimeType: z.string().describe("MIME type of the audio file"),
});

serve(async (req: Request) => {
  const preflight = corsPreflight(req);
  if (preflight) return preflight;

  logger.info("invoked");

  let client: SupabaseClient<Database> | null = null;
  let userId: string | null = null;
  let companyId: string | null = null;

  const authHeader = req.headers.get("Authorization");
  const token = authHeader?.replace("Bearer ", "") ?? null;

  if (token) {
    client = getSupabase(token);
    companyId = req.headers.get("x-company-id");

    await client.auth.setSession({
      access_token: token,
      refresh_token: token,
    });

    const user = (await client.auth.getUser())?.data?.user;
    if (user) {
      userId = user.id;
    }
  }

  if (!client || !companyId || !userId) {
    return new Response("Unauthorized", {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 401,
    });
  }

  try {
    // Parse and validate the request body
    const body = await req.json();
    const validationResult = transcriptionRequestSchema.safeParse(body);

    if (!validationResult.success) {
      return new Response(
        JSON.stringify({ success: false, error: validationResult.error }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    const { audio, mimeType } = validationResult.data;

    logger.info({ mimeType, audioLength: audio.length });

    // Convert base64 to Uint8Array
    const audioBuffer = Uint8Array.from(atob(audio), (c) => c.charCodeAt(0));

    // Create FormData for OpenAI API
    const formData = new FormData();
    const audioBlob = new Blob([audioBuffer], { type: mimeType });
    formData.append("file", audioBlob, "audio.webm");
    formData.append("model", "whisper-1");

    const result = await transcribe({
      model: openai.transcription("gpt-4o-mini-transcribe"),
      audio: audioBuffer,
    });

    logger.info("Audio transcription completed", {
      userId,
      companyId,
      transcriptLength: result.text.length,
    });

    return jsonResponse({
      success: true,
      text: result.text,
      language: result.language,
    });
  } catch (error) {
    logger.error("Transcription failed", {
      error: String((error as Error)?.stack ?? error),
    });

    return errorResponse(error, 500);
  }
});
