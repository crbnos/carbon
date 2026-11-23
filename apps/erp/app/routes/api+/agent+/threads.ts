// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { deleteAgentThread } from "~/modules/agent/agent.server";
import { getThreads } from "~/modules/agent/agent.service";

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

export async function action(args: ActionFunctionArgs) {
  if (args.request.method === "DELETE") {
    const input = await validator(deleteAgentThread.input).request(args, {
      method: "DELETE"
    });
    if ("invalid" in input) return input.invalid;
    const api = await carbon(args.request);
    return api.agent.deleteAgentThread(input.data);
  }
  const input = await validator().request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.agent.createAgentThread({});
}
