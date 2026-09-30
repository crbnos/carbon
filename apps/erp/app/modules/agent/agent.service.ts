import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildModelHistory,
  type StoredPart,
  toDisplayMessages
} from "./agent.history";
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

function getMessages(
  client: SupabaseClient<Database>,
  args: { threadId: string; companyId: string }
) {
  return client
    .from("agentMessage")
    .select(
      "id, role, parts:agentMessagePart(orderIndex, type, textContent, toolName, toolCallId, toolInput, toolOutput)"
    )
    .eq("threadId", args.threadId)
    .eq("companyId", args.companyId)
    .order("createdAt", { ascending: true });
}

/** The stored thread as the panel shows it (see `toDisplayMessages`). */
export async function getDisplayMessages(
  client: SupabaseClient<Database>,
  args: { threadId: string; companyId: string }
) {
  const { data, error } = await getMessages(client, args);
  if (error) return { data: null, error };
  return { data: toDisplayMessages(data ?? []), error: null };
}

/** The stored thread as the model sees it (see `buildModelHistory`). */
export async function getModelHistory(
  client: SupabaseClient<Database>,
  args: { threadId: string; companyId: string }
) {
  const { data, error } = await getMessages(client, args);
  if (error) return { data: null, error };
  return { data: buildModelHistory(data ?? []), error: null };
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
