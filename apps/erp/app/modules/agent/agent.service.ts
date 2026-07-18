import type { Database } from "@carbon/database";
import { Ratelimit, redis } from "@carbon/kv";
import { anthropicChatModel } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  convertToModelMessages,
  getToolName,
  isToolUIPart,
  type ModelMessage,
  stepCountIs,
  streamText,
  type UIMessage
} from "ai";
import type { BrowsingContext } from "./agent.models";
import { buildSystemPrompt } from "./agent.prompt";
import { anthropic } from "./agent.provider";
import { createAgentTools } from "./agent.tools";

const MAX_STEPS = 8;

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
      context: args.context ?? null
    })
    .select("id")
    .single();
  if (error || !message) return { data: message, error };

  await client.from("agentMessagePart").insert({
    messageId: message.id,
    companyId: args.companyId,
    orderIndex: 0,
    type: "text",
    textContent: args.text
  });
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
    .is("archivedAt", null)
    .order("createdAt", { ascending: false });
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
    convertToModelMessages(args.messages),
    args.context
  );

  // Token usage / finish reason live on the streamText event (typed), the
  // normalized message parts live on the UI-message stream — capture the former
  // to persist alongside the latter.
  let inputTokens = 0;
  let outputTokens = 0;
  let finishReason = "stop";

  const result = streamText({
    model: anthropic(anthropicChatModel),
    system: buildSystemPrompt(),
    messages: modelMessages,
    tools: createAgentTools(ctx),
    stopWhen: stepCountIs(MAX_STEPS),
    onFinish: (event) => {
      inputTokens = event.totalUsage.inputTokens ?? 0;
      outputTokens = event.totalUsage.outputTokens ?? 0;
      finishReason = event.finishReason;
    }
  });

  return result.toUIMessageStreamResponse({
    onFinish: async ({ responseMessage }) => {
      await persistAssistantTurn(client, {
        threadId: args.threadId,
        companyId: args.companyId,
        message: responseMessage,
        inputTokens,
        outputTokens,
        finishReason
      });
    }
  });
}

async function persistAssistantTurn(
  client: SupabaseClient<Database>,
  args: {
    threadId: string;
    companyId: string;
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
      outputTokens: args.outputTokens
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
        textContent: part.text
      });
    } else if (isToolUIPart(part)) {
      parts.push({
        messageId: message.id,
        companyId: args.companyId,
        orderIndex: order++,
        type: "tool",
        toolName: getToolName(part),
        toolClassification: "READ",
        toolCallId: part.toolCallId,
        toolInput: (part.input ?? null) as never,
        toolOutput: (part.state === "output-error"
          ? { error: part.errorText }
          : (part.output ?? null)) as never,
        toolState: part.state === "output-available" ? "success" : "error"
      });
    }
  }
  if (parts.length > 0) {
    await client.from("agentMessagePart").insert(parts);
  }
}
