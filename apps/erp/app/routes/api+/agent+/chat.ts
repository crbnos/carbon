// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { chatRequest } from "~/modules/agent/agent.models";
import { startAgentTurn } from "~/modules/agent/agent.server";
import { streamChat } from "~/modules/agent/agent.service";
import { serviceContext } from "~/modules/service-context.server";
import { getDatabaseClient } from "~/services/database.server";

// `useChat` reads a refusal from the status; the answer streams back.
export async function action(args: ActionFunctionArgs) {
  const input = await validator(chatRequest).request(args);
  if ("invalid" in input) {
    throw new Response("Invalid request", { status: 400 });
  }
  const auth = await requirePermissions(args.request, {});
  const turn = await startAgentTurn(serviceContext(auth), input.data);
  if (turn.error) {
    throw new Response(turn.error.message, { status: turn.error.status });
  }

  return streamChat(auth.client, getDatabaseClient(), {
    companyId: auth.companyId,
    userId: auth.userId,
    threadId: input.data.threadId,
    history: turn.data.history,
    context: input.data.context,
    isNewQuestion: turn.data.isNewQuestion,
    abortSignal: args.request.signal
  });
}
