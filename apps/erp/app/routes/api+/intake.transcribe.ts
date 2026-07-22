import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import { insertIntakeTranscript } from "@carbon/onboarding/server";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";

const logger = getLogger("erp", "intake-transcribe");

const inputValidator = z.object({
  audio: z.string().min(1), // base64, no data: prefix
  mimeType: z.string().min(1),
  questionKey: z.string().min(1)
});

// Voice answers for the intake wizard: transcribe the clip via the existing
// transcription edge function, persist the transcript (Carbon's sales team
// reads these later — every utterance is kept), and hand the text back.
// Returns a raw JSON Response so the wizard can await plain fetch().
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {});

  const parsed = inputValidator.safeParse(
    Object.fromEntries(await request.formData())
  );
  if (!parsed.success) {
    return Response.json({ error: "Invalid input" }, { status: 400 });
  }
  const { audio, mimeType, questionKey } = parsed.data;

  const { data: result, error: invokeError } = await client.functions.invoke<{
    success: boolean;
    text?: string;
  }>("transcription", { body: { audio, mimeType } });

  if (invokeError || !result?.success || !result.text) {
    logger.error("Transcription failed", { error: invokeError });
    return Response.json({ error: "Transcription failed" }, { status: 502 });
  }

  const persisted = await insertIntakeTranscript(client, {
    companyId,
    userId,
    questionKey,
    source: "voice",
    transcript: result.text
  });
  if (persisted.error) {
    // The transcript record is a hard requirement — fail loudly rather than
    // silently dropping what sales needs to see.
    logger.error("Failed to persist intake transcript", {
      error: persisted.error
    });
    return Response.json(
      { error: "Failed to save the transcript" },
      { status: 500 }
    );
  }

  return Response.json({ text: result.text });
}
