import { z } from "zod";
import type { BrowsingContext } from "./types";

export const browsingContext = z.object({
  route: z.string(),
  object: z.string().optional(),
  id: z.string().optional(),
  type: z.enum(["record", "list"]).optional(),
  label: z.string()
}) satisfies z.ZodType<BrowsingContext>;

export const chatRequest = z.object({
  threadId: z.string().optional(),
  messages: z.array(z.any()),
  context: browsingContext.nullable().optional()
});
export type ChatRequest = z.infer<typeof chatRequest>;

// Feedback targets the thread's most-recent assistant message (the one the UI shows
// the thumbs on). useChat message ids are client-side, so we key by thread, not row id.
export const feedbackValidator = z.object({
  threadId: z.string(),
  feedback: z.enum(["up", "down"]),
  note: z.string().optional()
});
