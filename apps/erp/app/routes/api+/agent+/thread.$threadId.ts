import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getMessages } from "~/modules/agent";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});
  const threadId = params.threadId;
  if (!threadId) return { messages: [] };
  const messages = await getMessages(client, { threadId, companyId });
  return { messages: messages.data ?? [] };
}
