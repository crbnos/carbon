import { openai } from "@ai-sdk/openai";
import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import { INTAKE_QUESTIONS } from "@carbon/onboarding";
import { insertIntakeTranscript } from "@carbon/onboarding/server";
import { generateObject } from "ai";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";

const logger = getLogger("erp", "intake-clarify");

const inputValidator = z.object({
  questionKey: z.string().min(1),
  message: z.string().min(1).max(4000)
});

// The intake's "talk it through" clarifier: the customer describes their
// situation in their own words (typed or spoken) and the AI maps it onto the
// question's options — or asks one plain follow-up. The exchange is persisted
// as a transcript for Carbon's sales review. Returns raw JSON for plain fetch().
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {});

  const parsed = inputValidator.safeParse(
    Object.fromEntries(await request.formData())
  );
  if (!parsed.success) {
    return Response.json({ error: "Invalid input" }, { status: 400 });
  }
  const { questionKey, message } = parsed.data;

  const question = INTAKE_QUESTIONS.find((q) => String(q.key) === questionKey);
  if (!question) {
    return Response.json({ error: "Unknown question" }, { status: 400 });
  }

  // Persist the exchange regardless of what the model does with it.
  const persisted = await insertIntakeTranscript(client, {
    companyId,
    userId,
    questionKey,
    source: "clarifier",
    transcript: message
  });
  if (persisted.error) {
    logger.error("Failed to persist clarifier transcript", {
      error: persisted.error
    });
  }

  const options = (question.options ?? []).map((o) => o.value);

  try {
    const { object } = await generateObject({
      model: openai("gpt-4o-mini"),
      temperature: 0.2,
      schema: z.object({
        reply: z
          .string()
          .describe(
            "One or two plain, friendly sentences for a factory owner — confirm what you understood, or ask one simple follow-up. No ERP jargon."
          ),
        answerValue: z
          .string()
          .optional()
          .describe(
            options.length > 0
              ? `The option value that best matches what they said, chosen ONLY from: ${options.join(", ")}. For pick-all-that-apply questions, a comma-separated list of matching values. Omit when genuinely unsure.`
              : "Omit — this question has no options."
          )
      }),
      prompt: `You are helping a manufacturer answer one onboarding question about their factory, in plain language.

Question: ${questionKey}
${options.length > 0 ? `Allowed option values: ${options.join(", ")}` : "Free-text question."}

They said: "${message}"

Map their words onto the best option value when you can. If they seem unsure, recommend the safest common choice and say why in one sentence.`
    });

    return Response.json({
      reply: object.reply,
      answerValue: object.answerValue
    });
  } catch (err) {
    logger.error("Clarifier failed", { error: err });
    return Response.json({ error: "Clarifier unavailable" }, { status: 502 });
  }
}
