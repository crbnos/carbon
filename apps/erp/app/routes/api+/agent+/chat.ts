import { requirePermissions } from "@carbon/auth/auth.server";
import { companyHasFeature } from "@carbon/ee/plan.server";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import {
  chatRequest,
  getModelHistory,
  getThread,
  saveUserMessage
} from "~/modules/agent";
import { assertAgentRateLimit, streamChat } from "~/modules/agent/agent.server";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "agent-chat");

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

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
  const saveQuestion = async (question: string) => {
    try {
      await saveUserMessage(db, {
        threadId,
        companyId,
        userId,
        text: question,
        context
      });
    } catch (error) {
      logger.error("Failed to save agent message", {
        companyId,
        threadId,
        error
      });
      throw new Response("Failed to save your message", { status: 500 });
    }
  };
  const loadHistory = async () => {
    const history = await getModelHistory(client, { threadId, companyId });
    if (history.error) {
      logger.error("Failed to load agent history", {
        companyId,
        threadId,
        error: history.error
      });
      throw new Response("Failed to load the conversation", { status: 500 });
    }
    return history.data;
  };

  let saved = false;
  if (trigger === "submit-message" && text) {
    await saveQuestion(text);
    saved = true;
  }
  let history = await loadHistory();

  // A retry answers the stored, unanswered question — when it is the question being
  // retried. Otherwise that question was refused before it was saved (e.g. rate-limited),
  // possibly after an older one failed, so the retry's own text is saved and answered.
  if (trigger === "regenerate-message") {
    const last = history.at(-1);
    const pending =
      last?.role === "user"
        ? last.parts.map((p) => (p.type === "text" ? p.text : "")).join("")
        : null;
    if (text && text !== pending) {
      await saveQuestion(text);
      saved = true;
      history = await loadHistory();
    } else if (pending === null) {
      throw new Response("There is no question to answer", { status: 409 });
    }
  }

  return streamChat(client, db, {
    companyId,
    userId,
    threadId,
    history,
    context,
    isNewQuestion: saved,
    abortSignal: request.signal
  });
}
