import { createHmac, timingSafeEqual } from "node:crypto";
import { SESSION_SECRET } from "@carbon/env";
import { inngest } from "@carbon/lib/inngest";
import type { ActionFunctionArgs } from "react-router";

// Completion webhook for the assembler: the terminal job envelope lands here
// and wakes the waiting run via `carbon/assembler-job-done`. Auth is the
// per-job HMAC token (the caller is the assembler, not a user); duplicate
// deliveries are inert (waitForEvent consumes the first match).

export function assemblerCallbackToken(jobId: string): string {
  return createHmac("sha256", SESSION_SECRET ?? "")
    .update(`assembler-callback:${jobId}`)
    .digest("hex");
}

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
  const expected = assemblerCallbackToken(job.id);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
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
