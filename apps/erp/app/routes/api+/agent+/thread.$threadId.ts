import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import type { LoaderFunctionArgs } from "react-router";
import { getDisplayMessages, getThread } from "~/modules/agent";

const logger = getLogger("erp", "agent-thread");

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});
  const threadId = params.threadId;
  if (!threadId) throw new Response("Conversation not found", { status: 404 });

  // A missing or foreign thread is a 404, so the browser falls back to a new chat
  // instead of sending into a thread it can no longer read.
  const thread = await getThread(client, { threadId, companyId, userId });
  if (!thread.data) {
    if (thread.error) {
      logger.error("Failed to read agent thread", {
        companyId,
        threadId,
        error: thread.error
      });
    }
    throw new Response("Conversation not found", { status: 404 });
  }

  const messages = await getDisplayMessages(client, { threadId, companyId });
  if (messages.error) {
    logger.error("Failed to load agent messages", {
      companyId,
      threadId,
      error: messages.error
    });
    throw new Response("Failed to load the conversation", { status: 500 });
  }
  return { messages: messages.data };
}
