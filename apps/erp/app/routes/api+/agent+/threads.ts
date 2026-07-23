import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { createThread, deleteThread, getThreads } from "~/modules/agent";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});
  const threads = await getThreads(client, { companyId, userId });
  return { threads: threads.data ?? [] };
}

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

  if (request.method === "DELETE") {
    const form = await request.formData();
    const threadId = String(form.get("threadId") ?? "");
    if (threadId) {
      // Hard delete — messages and parts cascade, freeing storage.
      await deleteThread(client, { threadId, companyId, userId });
    }
    return { success: true };
  }

  const created = await createThread(client, { companyId, userId });
  if (created.error || !created.data) {
    return { success: false, threadId: null };
  }
  return { success: true, threadId: created.data.id };
}
