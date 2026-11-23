// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { isAssemblerCallbackToken } from "@carbon/api/internal-call";
import { SESSION_SECRET } from "@carbon/env";
import { inngest } from "@carbon/lib/inngest";
import type { ActionFunctionArgs } from "react-router";

// Completion webhook for the assembler: the terminal job envelope lands here
// and wakes the waiting run via `carbon/assembler-job-done`. Auth is the
// per-job HMAC token (the caller is the assembler, not a user); duplicate
// deliveries are inert (waitForEvent consumes the first match).

export async function action({ request }: ActionFunctionArgs) {
  const body = (await request.json().catch(() => null)) as {
    job?: {
      id?: string;
      status?: string;
      result?: unknown;
      stats?: unknown;
      error?: { code?: string; message?: string };
    };
  } | null;
  const job = body?.job;
  if (!job?.id || !job.status) {
    throw new Response("Bad request", { status: 400 });
  }

  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!isAssemblerCallbackToken(SESSION_SECRET ?? "", job.id, token)) {
    throw new Response("Unauthorized", { status: 401 });
  }

  await inngest.send({
    name: "carbon/assembler-job-done",
    data: {
      jobId: job.id,
      status: job.status,
      result: job.result ?? null,
      stats: job.stats ?? null,
      error: job.error ?? null
    }
  });

  return { ok: true };
}
