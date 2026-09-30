import { requirePermissions } from "@carbon/auth/auth.server";
import { companyHasFeature } from "@carbon/ee/plan.server";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import {
  assertAgentRateLimit,
  chatRequest,
  getModelHistory,
  getThread,
  saveUserMessage,
  streamChat
} from "~/modules/agent";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "agent-chat");

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {});

  const allowed = await companyHasFeature(client, companyId, {
    feature: "AI_AGENT"
  });
  if (!allowed) {
    throw new Response("Upgrade required", { status: 402 });
  }

  await assertAgentRateLimit(userId, companyId);

  const parsed = chatRequest.safeParse(await request.json());
  if (!parsed.success) {
    throw new Response("Invalid request", { status: 400 });
  }
  const { threadId, trigger, text, context } = parsed.data;

  // The browser sends only its new message and a thread id; the thread must be the
  // caller's own before anything is written to it or read back into the model.
  const thread = await getThread(client, { threadId, companyId, userId });
  if (thread.error) {
    logger.error("Failed to read agent thread", {
      companyId,
      threadId,
      error: thread.error
    });
    throw new Response("Failed to load the conversation", { status: 500 });
  }
  if (!thread.data) {
    throw new Response("Conversation not found", { status: 404 });
  }

  const db = getDatabaseClient();
  if (trigger === "submit-message" && text) {
    try {
      await saveUserMessage(db, { threadId, companyId, userId, text, context });
    } catch (error) {
      logger.error("Failed to save agent message", {
        companyId,
        threadId,
        error
      });
      throw new Response("Failed to save your message", { status: 500 });
    }
  }

  const history = await getModelHistory(client, { threadId, companyId });
  if (history.error || !history.data) {
    logger.error("Failed to load agent history", {
      companyId,
      threadId,
      error: history.error
    });
    throw new Response("Failed to load the conversation", { status: 500 });
  }
  // A retry answers the stored, unanswered question; with none there is nothing to do.
  if (history.data.at(-1)?.role !== "user") {
    throw new Response("There is no question to answer", { status: 409 });
  }

  return streamChat(client, db, {
    companyId,
    companyGroupId,
    userId,
    threadId,
    history: history.data,
    context,
    isNewQuestion: trigger === "submit-message",
    abortSignal: request.signal
  });
}
