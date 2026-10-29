// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { getCompanyTimeZone } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
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
import { UI_BLOCK_TOOLS } from "./agent.blocks";
import {
  buildModelHistory,
  type StoredPart,
  toDisplayMessages,
  toStoredParts
} from "./agent.history";
import { buildSystemPrompt } from "./agent.prompt";
import { agentModel } from "./agent.provider";
import { createAgentTools } from "./agent.tools";
import type { BrowsingContext } from "./types";

// Reads run on the caller's RLS client, which already limits the agent tables to the
// caller's own threads; the explicit filters say so in the query. The two message writes
// use Kysely (one transaction each), which bypasses RLS: the chat route checks the thread
// with getThread before calling them.

export async function createThread(
  client: SupabaseClient<Database>,
  args: { companyId: string; userId: string }
) {
  return client
    .from("agentThread")
    .insert({
      companyId: args.companyId,
      userId: args.userId,
      createdBy: args.userId
    })
    .select("id")
    .single();
}

/** The caller's own thread, or null. Every read or write of a thread checks this first. */
export async function getThread(
  client: SupabaseClient<Database>,
  args: { threadId: string; companyId: string; userId: string }
) {
  return client
    .from("agentThread")
    .select("id")
    .eq("id", args.threadId)
    .eq("companyId", args.companyId)
    .eq("userId", args.userId)
    .maybeSingle();
}

export async function getThreads(
  client: SupabaseClient<Database>,
  args: { companyId: string; userId: string }
) {
  return client
    .from("agentThread")
    .select("id, title, createdAt")
    .eq("companyId", args.companyId)
    .eq("userId", args.userId)
    .order("createdAt", { ascending: false });
}

/** Hard delete: messages and parts cascade. */
export async function deleteThread(
  client: SupabaseClient<Database>,
  args: { threadId: string; companyId: string; userId: string }
) {
  return client
    .from("agentThread")
    .delete()
    .eq("id", args.threadId)
    .eq("companyId", args.companyId)
    .eq("userId", args.userId);
}

export async function setThreadTitle(
  client: SupabaseClient<Database>,
  args: { threadId: string; companyId: string; title: string }
) {
  return client
    .from("agentThread")
    .update({ title: args.title })
    .eq("id", args.threadId)
    .eq("companyId", args.companyId);
}

// A thread is read newest-first and capped, so a long thread costs the same per request
// as a short one. The model's history is trimmed further by its character budget.
export const MAX_THREAD_MESSAGES = 200;

const newestFirst = <T>(rows: T[] | null) => (rows ?? []).slice().reverse();

/** The stored thread as the panel shows it (see `toDisplayMessages`). */
export async function getDisplayMessages(
  client: SupabaseClient<Database>,
  args: { threadId: string; companyId: string }
) {
  const { data, error } = await client
    .from("agentMessage")
    .select(
      "id, role, parts:agentMessagePart(orderIndex, type, textContent, toolName, toolCallId, toolInput, toolOutput)"
    )
    .eq("threadId", args.threadId)
    .eq("companyId", args.companyId)
    // Only what the panel shows: read-tool outputs are the bulk of a thread's bytes.
    .or(`type.eq.text,toolName.in.(${UI_BLOCK_TOOLS.join(",")})`, {
      referencedTable: "parts"
    })
    .order("createdAt", { ascending: false })
    .limit(MAX_THREAD_MESSAGES);
  if (error) return { data: null, error };
  return { data: toDisplayMessages(newestFirst(data)), error: null };
}

/** The stored thread as the model sees it (see `buildModelHistory`). */
export async function getModelHistory(
  client: SupabaseClient<Database>,
  args: { threadId: string; companyId: string }
) {
  const { data, error } = await client
    .from("agentMessage")
    .select(
      "id, role, parts:agentMessagePart(orderIndex, type, textContent, toolName, toolInput)"
    )
    .eq("threadId", args.threadId)
    .eq("companyId", args.companyId)
    // Text, plus offered choices (see buildModelHistory); never read-tool output.
    .or("type.eq.text,toolName.eq.present_choice", { referencedTable: "parts" })
    .order("createdAt", { ascending: false })
    .limit(MAX_THREAD_MESSAGES);
  if (error) return { data: null, error };
  return { data: buildModelHistory(newestFirst(data)), error: null };
}

export async function setFeedback(
  client: SupabaseClient<Database>,
  args: {
    messageId: string;
    companyId: string;
    feedback: "up" | "down";
    note?: string;
  }
) {
  return client
    .from("agentMessage")
    .update({ feedback: args.feedback, feedbackNote: args.note ?? null })
    .eq("id", args.messageId)
    .eq("companyId", args.companyId)
    .eq("role", "assistant")
    .select("id")
    .maybeSingle();
}

/** Save the user's question and its text part in one transaction. */
export async function saveUserMessage(
  db: Kysely<KyselyDatabase>,
  args: {
    threadId: string;
    companyId: string;
    userId: string;
    text: string;
    context?: BrowsingContext | null;
  }
) {
  return db.transaction().execute(async (trx) => {
    const message = await trx
      .insertInto("agentMessage")
      .values({
        threadId: args.threadId,
        companyId: args.companyId,
        role: "user",
        context: args.context ? JSON.stringify(args.context) : null,
        createdBy: args.userId
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("agentMessagePart")
      .values({
        messageId: message.id,
        companyId: args.companyId,
        orderIndex: 0,
        type: "text",
        textContent: args.text,
        createdBy: args.userId
      })
      .execute();
    return message.id;
  });
}

/** Save an answer and its parts in one transaction, under the id the browser already has. */
export async function saveAssistantMessage(
  db: Kysely<KyselyDatabase>,
  args: {
    id: string;
    threadId: string;
    companyId: string;
    userId: string;
    parts: StoredPart[];
    inputTokens: number;
    outputTokens: number;
    finishReason: string;
  }
) {
  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto("agentMessage")
      .values({
        id: args.id,
        threadId: args.threadId,
        companyId: args.companyId,
        role: "assistant",
        finishReason: args.finishReason,
        inputTokens: args.inputTokens,
        outputTokens: args.outputTokens,
        createdBy: args.userId
      })
      .execute();
    await trx
      .insertInto("agentMessagePart")
      .values(
        args.parts.map((part, orderIndex) => ({
          ...part,
          messageId: args.id,
          companyId: args.companyId,
          orderIndex,
          createdBy: args.userId
        }))
      )
      .execute();
  });
}
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
