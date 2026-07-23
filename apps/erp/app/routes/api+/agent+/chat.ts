import { requirePermissions } from "@carbon/auth/auth.server";
import { companyHasPlan } from "@carbon/ee/plan.server";
import type { UIMessage } from "ai";
import type { ActionFunctionArgs } from "react-router";
import {
  assertAgentRateLimit,
  chatRequest,
  createThread,
  saveUserMessage,
  streamChat
} from "~/modules/agent";

function extractText(message: unknown): string {
  const m = message as
    | { content?: unknown; parts?: Array<{ type?: string; text?: string }> }
    | undefined;
  if (!m) return "";
  if (typeof m.content === "string") return m.content;
  const parts = Array.isArray(m.parts)
    ? m.parts
    : Array.isArray(m.content)
      ? (m.content as Array<{ type?: string; text?: string }>)
      : [];
  return parts
    .filter((p) => p?.type === "text")
    .map((p) => p.text ?? "")
    .join("");
}

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {});

  const allowed = await companyHasPlan(client, companyId, {
    feature: "AI_AGENT"
  });
  if (!allowed) {
    throw new Response("Upgrade required", { status: 402 });
  }

  await assertAgentRateLimit(userId, companyId);

  const parsed = chatRequest.parse(await request.json());

  let threadId = parsed.threadId;
  if (!threadId) {
    const created = await createThread(client, {
      companyId,
      userId,
      context: parsed.context
    });
    if (created.error || !created.data) {
      throw new Response("Failed to create thread", { status: 500 });
    }
    threadId = created.data.id;
  }

  const text = extractText(parsed.messages[parsed.messages.length - 1]);
  if (text) {
    await saveUserMessage(client, {
      threadId,
      companyId,
      userId,
      text,
      context: parsed.context
    });
  }

  return streamChat(client, {
    companyId,
    companyGroupId,
    userId,
    threadId,
    messages: parsed.messages as UIMessage[],
    context: parsed.context
  });
}
