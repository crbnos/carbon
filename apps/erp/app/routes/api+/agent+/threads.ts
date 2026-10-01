// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { createThread, deleteThread, getThreads } from "~/modules/agent";

const logger = getLogger("erp", "agent-threads");

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});
  const threads = await getThreads(client, { companyId, userId });
  if (threads.error) {
    logger.error("Failed to list agent threads", {
      companyId,
      error: threads.error
    });
    throw new Response("Failed to load your chats", { status: 500 });
  }
  return { threads: threads.data };
}

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

  if (request.method === "DELETE") {
    const threadId = String((await request.formData()).get("threadId") ?? "");
    if (!threadId) return { success: false };
    const deleted = await deleteThread(client, { threadId, companyId, userId });
    if (deleted.error) {
      logger.error("Failed to delete agent thread", {
        companyId,
        threadId,
        error: deleted.error
      });
    }
    return { success: !deleted.error };
  }

  const created = await createThread(client, { companyId, userId });
  if (created.error) {
    logger.error("Failed to create agent thread", {
      companyId,
      error: created.error
    });
    return { success: false, threadId: null };
  }
  return { success: true, threadId: created.data.id };
}
