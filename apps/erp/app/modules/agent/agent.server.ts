// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { CarbonError, defineServiceFn } from "@carbon/api/service-fn.server";
import type { Database } from "@carbon/database";
import { getCompanyTimeZone } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { companyHasFeature } from "@carbon/ee/plan.server";
import { Ratelimit, redis } from "@carbon/kv";
import { getLogger } from "@carbon/logger";
import {
  agentChatModel,
  agentProvider,
  agentTitleModel,
  datetime
} from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  consumeStream,
  convertToModelMessages,
  createIdGenerator,
  createUIMessageStreamResponse,
  generateText,
  hasToolCall,
  isStepCount,
  type ModelMessage,
  streamText,
  toUIMessageStream,
  type UIMessage
} from "ai";
import { z } from "zod";
import { toStoredParts } from "./agent.history";
import { chatRequest } from "./agent.models";
import { buildSystemPrompt } from "./agent.prompt";
import { agentModel } from "./agent.provider";
import {
  createThread,
  deleteThread,
  getModelHistory,
  getThread,
  saveAssistantMessage,
  saveUserMessage,
  setThreadTitle
} from "./agent.service";
import { createAgentTools } from "./agent.tools";
import type { BrowsingContext } from "./types";

const log = getLogger("erp", "agent");

// Every step re-sends the whole context. A docs answer is search → read → answer, with a
// read or two more at most, so a few steps cover it and bound the worst-case cost.
const MAX_STEPS = 6;

// The assistant message id is minted here and becomes the row's id, so the browser's
// copy of an answer and its database row share one id (feedback targets it).
const newAssistantMessageId = createIdGenerator({
  prefix: "agm",
  separator: "_",
  size: 20
});

// What the browser sees when a turn fails; the real error is logged, never streamed.
const TURN_FAILED_MESSAGE =
  "The assistant couldn't answer that. Please try again.";

const agentRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, "5 m")
});

/** Append the browsing context to the latest user message so it travels with the turn. */
function withContext(
  messages: ModelMessage[],
  context?: BrowsingContext | null
): ModelMessage[] {
  if (!context) return messages;
  const note = `\n\n[Current page: ${context.label}${context.route ? ` — ${context.route}` : ""}]`;
  const last = messages.findLast((m) => m.role === "user");
  if (typeof last?.content === "string") {
    last.content += note;
  } else if (Array.isArray(last?.content)) {
    last.content.push({ type: "text", text: note });
  }
  return messages;
}

/**
 * One turn: answer the last question in `history` (the stored thread, ending with the
 * question) and stream it as the AI SDK UI-message Response `useChat` reads. The answer
 * is saved when the stream ends; a failed turn saves nothing, so Retry answers the same
 * stored question.
 */
export async function streamChat(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    threadId: string;
    history: UIMessage[];
    context?: BrowsingContext | null;
    /** A new question (not a retry): the thread may need a title. */
    isNewQuestion: boolean;
    abortSignal?: AbortSignal;
  }
) {
  const { companyId, userId, threadId, history } = args;

  // Titling needs only the questions, so it runs alongside the answer instead of
  // holding the stream open for another model round trip at the end.
  const titling = args.isNewQuestion
    ? titleThread(client, { threadId, companyId, history }).catch((error) => {
        log.error("Failed to title thread", { error, threadId });
      })
    : Promise.resolve();

  const [messages, timeZone] = await Promise.all([
    convertToModelMessages(history),
    getCompanyTimeZone(client, companyId)
  ]);

  // Usage and finish reason come from the model stream, the message parts from the UI
  // stream; both end callbacks fire, the model stream's first.
  let usage = { inputTokens: 0, outputTokens: 0, finishReason: "stop" };
  let failed = false;

  const tools = createAgentTools();
  const result = streamText({
    model: agentModel(agentChatModel),
    instructions: buildSystemPrompt({
      today: datetime.today(timeZone).toString()
    }),
    messages: withContext(messages, args.context),
    tools,
    abortSignal: args.abortSignal,
    // present_choice hands the turn back to the user, so the answer ends there.
    stopWhen: [isStepCount(MAX_STEPS), hasToolCall("present_choice")],
    // On the final allowed step, forbid tools so the model must write an answer with what
    // it has — instead of ending on a dangling tool call and returning no text.
    prepareStep: ({ stepNumber }) =>
      stepNumber >= MAX_STEPS - 1 ? { toolChoice: "none" } : undefined,
    // One key for every turn: the system prompt and tool definitions are the same
    // prefix each time, and OpenAI bills a cached prefix at a fraction of the price.
    ...(agentProvider === "openai"
      ? { providerOptions: { openai: { promptCacheKey: "carbon-agent" } } }
      : {}),
    onError: ({ error }) => {
      failed = true;
      log.error("Agent model call failed", { error, threadId });
    },
    onEnd: (event) => {
      usage = {
        inputTokens: event.usage.inputTokens ?? 0,
        outputTokens: event.usage.outputTokens ?? 0,
        finishReason: event.finishReason
      };
      log.info("Agent turn", {
        threadId,
        model: agentChatModel,
        steps: event.steps.length,
        cachedInputTokens: event.usage.inputTokenDetails.cacheReadTokens ?? 0,
        ...usage
      });
    }
  });

  const stream = toUIMessageStream({
    stream: result.stream,
    tools,
    // Needed for the SDK to use generateMessageId for the answer.
    originalMessages: history,
    generateMessageId: newAssistantMessageId,
    onError: () => TURN_FAILED_MESSAGE,
    onEnd: async ({ responseMessage, isAborted }) => {
      const parts = toStoredParts(responseMessage);
      if (!failed && parts.length > 0) {
        try {
          await saveAssistantMessage(db, {
            id: responseMessage.id,
            threadId,
            companyId,
            userId,
            parts,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            finishReason: isAborted ? "aborted" : usage.finishReason
          });
        } catch (error) {
          log.error("Failed to save agent answer", { error, threadId });
        }
      }
      await titling;
    }
  });

  return createUIMessageStreamResponse({
    stream,
    // Keep reading the model stream if the browser disconnects, so onEnd still runs.
    consumeSseStream: consumeStream
  });
}

/**
 * Auto-name the thread with a cheap model: after the 1st question (so it's named
 * immediately), and once more after the 3rd, by which point a real topic has emerged
 * past an opening "hi".
 */
async function titleThread(
  client: SupabaseClient<Database>,
  args: { threadId: string; companyId: string; history: UIMessage[] }
) {
  const questions = args.history.filter((m) => m.role === "user").length;
  if (questions !== 1 && questions !== 3) return;

  const transcript = args.history
    .slice(0, 8)
    .map(
      (m) =>
        `${m.role}: ${m.parts.map((p) => (p.type === "text" ? p.text : "")).join(" ")}`
    )
    .join("\n");

  const { text } = await generateText({
    model: agentModel(agentTitleModel),
    prompt: `Give this chat a concise 3-6 word title describing what the user wants. No quotes, no trailing punctuation. If there's no clear topic yet, reply exactly "New chat".\n\n${transcript}`
  });
  const title = text
    .trim()
    .replace(/^["']|["']$/g, "")
    .slice(0, 80);
  if (!title) return;

  const { error } = await setThreadTitle(client, {
    threadId: args.threadId,
    companyId: args.companyId,
    title
  });
  if (error) throw error;
}

/**
 * Start a chat with the in-app assistant: a new, empty thread of the caller's.
 */
export const createAgentThread = defineServiceFn({
  input: z.object({}),
  permission: {},

  async run(ctx) {
    const created = await createThread(ctx.asCaller.supabase, {
      companyId: ctx.company.id,
      userId: ctx.auditUserId
    });
    if (created.error) {
      return ctx.error("internal", "Failed to create the chat", created.error);
    }
    return { threadId: created.data.id };
  }
});

/**
 * Delete one of the caller's chats with the in-app assistant, with its
 * messages.
 */
export const deleteAgentThread = defineServiceFn({
  input: z.object({ threadId: z.string().min(1) }),
  permission: {},

  async run(ctx, { threadId }) {
    const deleted = await deleteThread(ctx.asCaller.supabase, {
      threadId,
      companyId: ctx.company.id,
      userId: ctx.auditUserId
    });
    if (deleted.error) {
      return ctx.error("internal", "Failed to delete the chat", deleted.error);
    }
    return { threadId };
  }
});

/**
 * Start a turn of the in-app assistant: save the question, and return the
 * conversation its answer is drawn from.
 *
 * @remarks
 * Needs a plan that includes the AI agent, and is rate-limited per user and
 * company (30 messages in 5 minutes). The thread must be the caller's own. A
 * new question is saved to it. A retry (`regenerate-message`) answers the
 * stored, unanswered question when it is the one retried; otherwise that
 * question was refused before it was saved, so the retry's own text is saved
 * and answered. `history` is the thread, ending with the question;
 * `isNewQuestion` is whether one was saved (the thread may need a title).
 */
export const startAgentTurn = defineServiceFn({
  input: chatRequest,
  permission: {},

  async run(ctx, { threadId, trigger, text, context }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;

    const allowed = await companyHasFeature(client, companyId, {
      feature: "AI_AGENT"
    });
    if (!allowed) return ctx.error("entitlement", "Upgrade required");

    const { success } = await agentRatelimit.limit(
      `agent:${companyId}:${userId}`
    );
    if (!success) {
      return ctx.error(
        "rateLimited",
        "Rate limit exceeded. Please wait a moment."
      );
    }

    // The browser sends only its new message and a thread id: the thread must
    // be the caller's own before anything is written to it or read back.
    const thread = await getThread(client, { threadId, companyId, userId });
    if (thread.error) {
      return ctx.error(
        "internal",
        "Failed to load the conversation",
        thread.error
      );
    }
    if (!thread.data) return ctx.error("notFound", "Conversation not found");

    const saveQuestion = async (question: string) => {
      try {
        await saveUserMessage(ctx.asSystem.pg, {
          threadId,
          companyId,
          userId,
          text: question,
          context
        });
        return null;
      } catch (error) {
        return ctx.error("internal", "Failed to save your message", error);
      }
    };
    const loadHistory = async () => {
      const history = await getModelHistory(client, { threadId, companyId });
      if (history.error) {
        return ctx.error(
          "internal",
          "Failed to load the conversation",
          history.error
        );
      }
      return history.data;
    };

    let isNewQuestion = false;
    if (trigger === "submit-message" && text) {
      const failed = await saveQuestion(text);
      if (failed) return failed;
      isNewQuestion = true;
    }
    let history = await loadHistory();
    if (history instanceof CarbonError) return history;

    if (trigger === "regenerate-message") {
      const last = history.at(-1);
      const pending =
        last?.role === "user"
          ? last.parts
              .map((part) => (part.type === "text" ? part.text : ""))
              .join("")
          : null;
      if (text && text !== pending) {
        const failed = await saveQuestion(text);
        if (failed) return failed;
        isNewQuestion = true;
        history = await loadHistory();
        if (history instanceof CarbonError) return history;
      } else if (pending === null) {
        return ctx.error("conflict", "There is no question to answer");
      }
    }

    return { history, isNewQuestion };
  }
});
