import type { Database } from "@carbon/database";
import { Ratelimit, redis } from "@carbon/kv";
import { getLogger } from "@carbon/logger";
import { agentChatModel, agentTitleModel } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  convertToModelMessages,
  generateText,
  getToolName,
  isToolUIPart,
  type ModelMessage,
  stepCountIs,
  streamText,
  type UIMessage
} from "ai";
import { isEphemeralTool, isUiBlockTool } from "./agent.blocks";
import { buildSystemPrompt } from "./agent.prompt";
import { agentModel } from "./agent.provider";
import { createAgentTools } from "./agent.tools";
import type { BrowsingContext } from "./types";

const log = getLogger("erp", "agent");

const MAX_STEPS = 20;

// Sliding window: send the model only the most recent messages whose combined size stays
// under this character budget (a rough token proxy — ~4 chars/token), dropping the oldest.
// Keeps the conversation from growing unbounded toward the context window. Whole messages
// are kept/dropped so tool-call/result pairs stay intact.
const HISTORY_CHAR_BUDGET = 100_000; // ~25k tokens of history

function messageSize(m: UIMessage): number {
  let n = 0;
  for (const part of m.parts) {
    if (part.type === "text") n += part.text.length;
    else if (isToolUIPart(part)) {
      n +=
        JSON.stringify(part.input ?? "").length +
        JSON.stringify(part.output ?? "").length;
    }
  }
  return n;
}

function windowByChars(messages: UIMessage[], budget: number): UIMessage[] {
  const kept: UIMessage[] = [];
  let total = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const size = messageSize(messages[i]);
    // Always keep the most recent message, even if it alone exceeds the budget.
    if (kept.length > 0 && total + size > budget) break;
    kept.unshift(messages[i]);
    total += size;
  }
  // Anthropic requires the first message to be a user message; dropping the oldest
  // turns can leave an assistant at the front, so trim any leading non-user messages.
  while (kept.length > 1 && kept[0].role !== "user") kept.shift();
  return kept;
}

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

export async function saveUserMessage(
  client: SupabaseClient<Database>,
  args: {
    threadId: string;
    companyId: string;
    userId: string;
    text: string;
    context?: BrowsingContext | null;
  }
) {
  const { data: message, error } = await client
    .from("agentMessage")
    .insert({
      threadId: args.threadId,
      companyId: args.companyId,
      role: "user",
      context: args.context ?? null,
      createdBy: args.userId
    })
    .select("id")
    .single();
  if (error || !message) return { data: message, error };

  const { error: partError } = await client.from("agentMessagePart").insert({
    messageId: message.id,
    companyId: args.companyId,
    orderIndex: 0,
    type: "text",
    textContent: args.text,
    createdBy: args.userId
  });
  // supabase-js has no multi-statement transaction; compensate by deleting the parent
  // so a failed part insert never leaves an empty, unrecoverable message bubble.
  if (partError) {
    await client
      .from("agentMessage")
      .delete()
      .eq("id", message.id)
      .eq("companyId", args.companyId);
    return { data: null, error: partError };
  }
  return { data: message, error: null };
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

export async function setFeedback(
  client: SupabaseClient<Database>,
  args: {
    threadId: string;
    companyId: string;
    feedback: "up" | "down";
    note?: string;
  }
) {
  const { data: latest } = await client
    .from("agentMessage")
    .select("id")
    .eq("threadId", args.threadId)
    .eq("companyId", args.companyId)
    .eq("role", "assistant")
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latest) return { data: null, error: null };
  return client
    .from("agentMessage")
    .update({ feedback: args.feedback, feedbackNote: args.note ?? null })
    .eq("id", latest.id)
    .eq("companyId", args.companyId);
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
 * Persists the assistant message + parts on finish, using the SAME normalized
 * UIMessage shape the client (and history load) speak — so read and write stay
 * inverse transforms of one shape rather than two divergent ones.
 */
export function streamChat(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    companyGroupId: string;
    userId: string;
    threadId: string;
    messages: UIMessage[];
    context?: BrowsingContext | null;
  }
) {
  const ctx = {
    client,
    companyId: args.companyId,
    companyGroupId: args.companyGroupId,
    userId: args.userId
  };

  const modelMessages = injectContext(
    convertToModelMessages(windowByChars(args.messages, HISTORY_CHAR_BUDGET)),
    args.context
  );

  // Token usage / finish reason live on the streamText event (typed), the
  // normalized message parts live on the UI-message stream — capture the former
  // to persist alongside the latter.
  let inputTokens = 0;
  let outputTokens = 0;
  let finishReason = "stop";

  const result = streamText({
    model: agentModel(agentChatModel),
    system: buildSystemPrompt(),
    messages: modelMessages,
    tools: createAgentTools(ctx),
    stopWhen: stepCountIs(MAX_STEPS),
    // On the final allowed step, forbid tools so the model must write an answer with what
    // it has — instead of ending on a dangling tool call and returning no text.
    prepareStep: ({ stepNumber }) =>
      stepNumber >= MAX_STEPS - 1 ? { toolChoice: "none" } : undefined,
    onFinish: (event) => {
      inputTokens = event.totalUsage.inputTokens ?? 0;
      outputTokens = event.totalUsage.outputTokens ?? 0;
      finishReason = event.finishReason;
    }
  });

  return result.toUIMessageStreamResponse({
    onFinish: async ({ responseMessage }) => {
      // This callback runs after the stream is handed to the client, so a throw here is
      // otherwise swallowed silently — log both steps so a persistence failure is diagnosable.
      try {
        await persistAssistantTurn(client, {
          threadId: args.threadId,
          companyId: args.companyId,
          userId: args.userId,
          message: responseMessage,
          inputTokens,
          outputTokens,
          finishReason
        });
      } catch (error) {
        log.error("Failed to persist assistant turn", {
          error,
          threadId: args.threadId
        });
      }
      try {
        await maybeTitleThread(client, {
          threadId: args.threadId,
          companyId: args.companyId
        });
      } catch (error) {
        log.error("Failed to title thread", {
          error,
          threadId: args.threadId
        });
      }
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

async function persistAssistantTurn(
  client: SupabaseClient<Database>,
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
  const { data: message } = await client
    .from("agentMessage")
    .insert({
      threadId: args.threadId,
      companyId: args.companyId,
      role: "assistant",
      finishReason: args.finishReason,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      createdBy: args.userId
    })
    .select("id")
    .single();
  if (!message) return;

  const parts: Database["public"]["Tables"]["agentMessagePart"]["Insert"][] =
    [];
  let order = 0;
  for (const part of args.message.parts) {
    if (part.type === "text" && part.text) {
      parts.push({
        messageId: message.id,
        companyId: args.companyId,
        orderIndex: order++,
        type: "text",
        textContent: part.text,
        createdBy: args.userId
      });
    } else if (isToolUIPart(part)) {
      const name = getToolName(part);
      if (isEphemeralTool(name)) continue; // e.g. navigate — never persisted, never replayed
      parts.push({
        messageId: message.id,
        companyId: args.companyId,
        orderIndex: order++,
        type: "tool",
        toolName: name,
        toolClassification: isUiBlockTool(name) ? null : "READ",
        toolCallId: part.toolCallId,
        toolInput: (part.input ?? null) as never,
        toolOutput: (part.state === "output-error"
          ? { error: part.errorText }
          : (part.output ?? null)) as never,
        toolState: part.state === "output-available" ? "success" : "error",
        createdBy: args.userId
      });
    }
  }
  if (parts.length > 0) {
    const { error: partsError } = await client
      .from("agentMessagePart")
      .insert(parts);
    // No multi-statement transaction in supabase-js: roll back the parent message so a
    // failed parts insert never persists an empty assistant bubble with no recoverable content.
    if (partsError) {
      await client
        .from("agentMessage")
        .delete()
        .eq("id", message.id)
        .eq("companyId", args.companyId);
      throw partsError;
    }
  }
}
