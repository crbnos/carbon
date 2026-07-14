import { GTM_EVENTS_API_SECRET_KEY, GTM_URL } from "@carbon/env";
import { getLogger } from "@carbon/logger";

const log = getLogger("stripe", "gtm-events");

export async function forwardToGtm(
  type: string,
  metadata: Record<string, unknown>
): Promise<void> {
  if (!GTM_URL || !GTM_EVENTS_API_SECRET_KEY) {
    log.error("missing GTM_URL or GTM_EVENTS_API_SECRET_KEY");
    return;
  }

  try {
    const res = await fetch(`${GTM_URL}/api/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gtm-events-key": GTM_EVENTS_API_SECRET_KEY
      },
      body: JSON.stringify({ type, metadata })
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.error("request failed", { status: res.status, body });
    }
  } catch (err) {
    log.error("request failed", { error: err });
  }
}
