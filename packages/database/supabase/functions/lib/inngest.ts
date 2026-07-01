/**
 * Minimal Inngest event sender for edge functions.
 *
 * We intentionally avoid `@inngest/sdk` here: it transitively pulls TypeScript,
 * @types/node, OpenTelemetry instrumentation and aws-lambda types into the Deno
 * bundle (~100MB), which blows past Supabase's edge-function deploy size limit
 * (HTTP 413). Sending an event is just a POST to the Inngest event API, so we do
 * that directly.
 *
 * URL/env resolution mirrors the SDK exactly (see consts.ts in @inngest/sdk):
 * `${INNGEST_BASE_URL ?? "https://inn.gs/"}e/${INNGEST_EVENT_KEY ?? "NO_EVENT_KEY_SET"}`.
 * Local dev + the docker edge-runtime set INNGEST_DEV + INNGEST_BASE_URL to point
 * at the local Inngest dev server; production uses Inngest Cloud + the event key.
 */

const DEFAULT_EVENT_BASE_URL = "https://inn.gs/";
const DEFAULT_DEV_SERVER_HOST = "http://localhost:8288/";
const DUMMY_EVENT_KEY = "NO_EVENT_KEY_SET";

type InngestEvent = { name: string; data: Record<string, unknown> };

function getSendEventUrl(): string {
  const eventKey = Deno.env.get("INNGEST_EVENT_KEY") || DUMMY_EVENT_KEY;

  // INNGEST_BASE_URL pins the host for both dev and prod when set (this is what
  // local dev and the docker edge-runtime use). Otherwise fall back to the dev
  // server in dev mode, or Inngest Cloud in production.
  const baseUrl =
    Deno.env.get("INNGEST_EVENT_API_BASE_URL") ||
    Deno.env.get("INNGEST_BASE_URL") ||
    (Deno.env.get("INNGEST_DEV") ? DEFAULT_DEV_SERVER_HOST : DEFAULT_EVENT_BASE_URL);

  return new URL(`e/${eventKey}`, baseUrl).href;
}

async function send(payload: InngestEvent | InngestEvent[]): Promise<void> {
  const response = await fetch(getSendEventUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Failed to send Inngest event(s): ${response.status} ${response.statusText} ${text}`.trim()
    );
  }
}

export async function sendInngestEvent(
  name: string,
  data: Record<string, unknown>,
) {
  await send({ name, data });
}

export async function sendInngestEvents(
  events: Array<{ name: string; data: Record<string, unknown> }>,
) {
  await send(events);
}
