import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { Ratelimit, redis } from "@carbon/kv";
import { getLogger } from "@carbon/logger";
import { agentChatModel, agentProvider, agentTitleModel } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  consumeStream,
  convertToModelMessages,
  createIdGenerator,
  generateText,
  getToolName,
  hasToolCall,
  isToolUIPart,
  type ModelMessage,
  stepCountIs,
  streamText,
  type UIMessage
} from "ai";
import { isEphemeralTool, isUiBlockTool } from "./agent.blocks";
import { buildModelHistory, type StoredMessage } from "./agent.history";
import { buildSystemPrompt } from "./agent.prompt";
import { agentModel } from "./agent.provider";
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

const DOC_TOOLS = new Set(["search_docs", "read_doc"]);

const agentRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, "5 m")
});

/** Throws a 429 Response when the per-user/company message rate is exceeded. */
export async function assertAgentRateLimit(userId: string, companyId: string) {
  const { success } = await agentRatelimit.limit(
    `agent:${companyId}:${userId}`
  );
  if (!success) {
    throw new Response("Rate limit exceeded. Please wait a moment.", {
      status: 429
    });
  }
}

export async function createThread(
  client: SupabaseClient<Database>,
  args: { companyId: string; userId: string; context?: BrowsingContext | null }
) {
  return client
    .from("agentThread")
    .insert({
      companyId: args.companyId,
      userId: args.userId,
      createdBy: args.userId,
      lastContext: args.context ?? null
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

/**
 * Save the user's question and its text part in one transaction. Kysely bypasses RLS:
 * the chat route has already checked the thread belongs to this user and company.
 */
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

export async function getMessages(
  client: SupabaseClient<Database>,
  args: { threadId: string; companyId: string }
) {
  return client
    .from("agentMessage")
    .select("*, parts:agentMessagePart(*)")
    .eq("threadId", args.threadId)
    .eq("companyId", args.companyId)
    .order("createdAt", { ascending: true });
}

/** The stored thread as the model sees it (see `buildModelHistory`). */
export async function getModelHistory(
  client: SupabaseClient<Database>,
  args: { threadId: string; companyId: string }
) {
  const { data, error } = await getMessages(client, args);
  if (error) return { data: null, error };
  return {
    data: buildModelHistory((data ?? []) as StoredMessage[]),
    error: null
  };
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

/** Append the browsing context to the latest user message so it travels with the turn. */
function injectContext(
  messages: ModelMessage[],
  context?: BrowsingContext | null
): ModelMessage[] {
  if (!context) return messages;
  const note = `\n\n[Current page: ${context.label}${context.route ? ` — ${context.route}` : ""}]`;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    if (typeof m.content === "string") {
      m.content += note;
    } else if (Array.isArray(m.content)) {
      m.content.push({ type: "text", text: note });
    }
    break;
  }
  return messages;
}

/**
 * Core streaming turn. Returns the AI SDK UI-message SSE Response for `useChat`.
 * `history` comes from the database (`getModelHistory`) and ends with the question being
 * answered; the answer is persisted on finish in one transaction.
 */
export function streamChat(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    companyGroupId: string;
    userId: string;
    threadId: string;
    history: UIMessage[];
    context?: BrowsingContext | null;
    /** A new question (not a retry): the thread may need a title. */
    isNewQuestion: boolean;
    abortSignal?: AbortSignal;
  }
) {
  const ctx = {
    client,
    companyId: args.companyId,
    companyGroupId: args.companyGroupId,
    userId: args.userId,
    // Already authorized by the chat route's requirePermissions; the per-operation
    // scope gate applies to API keys only.
    authKind: "session" as const,
    scopes: {}
  };

  // Titling needs only the stored questions, so it runs alongside the answer instead of
  // holding the stream open for another model round trip at the end.
  const titling = args.isNewQuestion
    ? maybeTitleThread(client, {
        threadId: args.threadId,
        companyId: args.companyId
      }).catch((error) => {
        log.error("Failed to title thread", { error, threadId: args.threadId });
      })
    : Promise.resolve();

  const modelMessages = injectContext(
    convertToModelMessages(args.history),
    args.context
  );

  // Token usage / finish reason live on the streamText event (typed), the
  // normalized message parts live on the UI-message stream — capture the former
  // to persist alongside the latter.
  let inputTokens = 0;
  let outputTokens = 0;
  let finishReason = "stop";
  let failed = false;

  const result = streamText({
    model: agentModel(agentChatModel),
    system: buildSystemPrompt(),
    messages: modelMessages,
    tools: createAgentTools(ctx),
    abortSignal: args.abortSignal,
    // present_choice hands the turn back to the user, so the answer ends there.
    stopWhen: [stepCountIs(MAX_STEPS), hasToolCall("present_choice")],
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
      log.error("Agent model call failed", { error, threadId: args.threadId });
    },
    onFinish: (event) => {
      inputTokens = event.totalUsage.inputTokens ?? 0;
      outputTokens = event.totalUsage.outputTokens ?? 0;
      finishReason = event.finishReason;
      log.info("Agent turn", {
        threadId: args.threadId,
        model: agentChatModel,
        steps: event.steps.length,
        inputTokens,
        cachedInputTokens: event.totalUsage.cachedInputTokens ?? 0,
        outputTokens,
        finishReason
      });
    }
  });

  return result.toUIMessageStreamResponse({
    // Needed for the SDK to use generateMessageId for the answer.
    originalMessages: args.history,
    generateMessageId: newAssistantMessageId,
    // Keep reading the model stream if the browser disconnects, so onFinish still runs.
    consumeSseStream: consumeStream,
    onError: () => TURN_FAILED_MESSAGE,
    onFinish: async ({ responseMessage, isAborted }) => {
      // A failed turn is not persisted: the question stays unanswered, and Retry (or the
      // next question) answers it from the stored thread.
      if (!failed) {
        try {
          await persistAssistantTurn(db, {
            threadId: args.threadId,
            companyId: args.companyId,
            userId: args.userId,
            message: responseMessage,
            inputTokens,
            outputTokens,
            finishReason: isAborted ? "aborted" : finishReason
          });
        } catch (error) {
          log.error("Failed to persist assistant turn", {
            error,
            threadId: args.threadId
          });
        }
      }
      await titling;
    }
  });
}

/**
 * Auto-name the thread with a cheap model. Titles after the 1st user message (so it's
 * named immediately), then re-titles once more after the 3rd — by which point a real
 * topic has emerged past the opening "hi"/"hello".
 */
async function maybeTitleThread(
  client: SupabaseClient<Database>,
  args: { threadId: string; companyId: string }
) {
  const { count } = await client
    .from("agentMessage")
    .select("id", { count: "exact", head: true })
    .eq("threadId", args.threadId)
    .eq("companyId", args.companyId)
    .eq("role", "user");
  if (count !== 1 && count !== 3) return;

  const { data: msgs } = await client
    .from("agentMessage")
    .select("role, agentMessagePart(orderIndex, type, textContent)")
    .eq("threadId", args.threadId)
    .eq("companyId", args.companyId)
    .order("createdAt", { ascending: true })
    .limit(8);
  if (!msgs) return;

  const transcript = msgs
    .map((m) => {
      const text = (m.agentMessagePart ?? [])
        .filter((p) => p.type === "text" && p.textContent)
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((p) => p.textContent)
        .join(" ");
      return text ? `${m.role}: ${text}` : "";
    })
    .filter(Boolean)
    .join("\n");
  if (!transcript) return;

  const { text } = await generateText({
    model: agentModel(agentTitleModel),
    prompt: `Give this chat a concise 3-6 word title describing what the user wants. No quotes, no trailing punctuation. If there's no clear topic yet, reply exactly "New chat".\n\n${transcript}`
  });
  const title = text
    .trim()
    .replace(/^["']|["']$/g, "")
    .slice(0, 80);
  if (!title) return;

  await client
    .from("agentThread")
    .update({ title })
    .eq("id", args.threadId)
    .eq("companyId", args.companyId);
}

type StoredPart = Omit<
  Database["public"]["Tables"]["agentMessagePart"]["Insert"],
  "messageId" | "companyId" | "orderIndex" | "createdBy"
>;

/** The parts of an answer worth keeping: text, and tool calls that completed. */
function storedParts(message: UIMessage): StoredPart[] {
  return message.parts.flatMap((part): StoredPart[] => {
    if (part.type === "text") {
      return part.text ? [{ type: "text", textContent: part.text }] : [];
    }
    if (!isToolUIPart(part)) return [];
    const name = getToolName(part);
    // Ephemeral tools (navigate) are never replayed; a call cut off by Stop has no result.
    if (isEphemeralTool(name)) return [];
    if (part.state !== "output-available" && part.state !== "output-error") {
      return [];
    }
    return [
      {
        type: "tool",
        toolName: name,
        toolClassification: isUiBlockTool(name)
          ? null
          : DOC_TOOLS.has(name)
            ? "DOCS"
            : "READ",
        toolCallId: part.toolCallId,
        toolInput: JSON.stringify(part.input ?? null),
        toolOutput: JSON.stringify(
          part.state === "output-error"
            ? { error: part.errorText }
            : (part.output ?? null)
        ),
        toolState: part.state === "output-available" ? "success" : "error"
      }
    ];
  });
}

/**
 * Save the answer and its parts in one transaction, under the id the browser already
 * has. An answer with nothing to show is not saved. Kysely bypasses RLS: the chat route
 * checked the thread's ownership before the turn started.
 */
async function persistAssistantTurn(
  db: Kysely<KyselyDatabase>,
  args: {
    threadId: string;
    companyId: string;
    userId: string;
    message: UIMessage;
    inputTokens: number;
    outputTokens: number;
    finishReason: string;
  }
) {
  const parts = storedParts(args.message);
  if (parts.length === 0) return;

  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto("agentMessage")
      .values({
        id: args.message.id,
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
        parts.map((part, orderIndex) => ({
          ...part,
          messageId: args.message.id,
          companyId: args.companyId,
          orderIndex,
          createdBy: args.userId
        }))
      )
      .execute();
  });
}
