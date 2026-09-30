import { z } from "zod";
import type { BrowsingContext } from "./types";

// Caps on what one request can put into the model's context (every step re-sends it).
export const MAX_MESSAGE_CHARS = 4_000;
const MAX_CONTEXT_CHARS = 500;

export const browsingContext = z.object({
  route: z.string().max(MAX_CONTEXT_CHARS),
  object: z.string().max(MAX_CONTEXT_CHARS).optional(),
  id: z.string().max(MAX_CONTEXT_CHARS).optional(),
  type: z.enum(["record", "list"]).optional(),
  label: z.string().max(MAX_CONTEXT_CHARS)
}) satisfies z.ZodType<BrowsingContext>;

// The browser sends only its newest question; the server loads the rest of the thread
// from the database, so nothing the browser holds reaches the model. A retry
// (`regenerate-message`) answers the stored, unanswered question, and uses `text` only when
// that question never reached the database.
export const chatRequest = z
  .object({
    threadId: z.string().min(1),
    trigger: z
      .enum(["submit-message", "regenerate-message"])
      .default("submit-message"),
    text: z.string().trim().min(1).max(MAX_MESSAGE_CHARS).optional(),
    context: browsingContext.nullable().optional()
  })
  .refine((r) => r.trigger === "regenerate-message" || r.text !== undefined, {
    message: "text is required",
    path: ["text"]
  });
export type ChatRequest = z.infer<typeof chatRequest>;

// The assistant message id is minted by the server and is the row's id, so feedback
// lands on the exact answer the thumbs were shown under.
export const feedbackValidator = z.object({
  messageId: z.string().min(1),
  feedback: z.enum(["up", "down"]),
  note: z.string().max(MAX_MESSAGE_CHARS).optional()
});
