// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sleep } from "@carbon/lib/async";
import { getLogger } from "@carbon/logger";
import { async } from "@carbon/utils";
import { sql } from "kysely";
import { getDatabaseClient } from "~/services/database.server";

const log = getLogger("erp", "inngest-event-url");

const RETRY_DELAY_MS = 60_000;

// Postgres sends its own events to Inngest (the event-queue wake-up, embeddings,
// job notifications) at a URL kept in its Vault. The app already holds the key
// that URL needs, so it keeps the key current on boot. It never changes an
// address that is already stored: the database may reach Inngest somewhere the
// app does not. With nothing stored, the URL starts from the app's own base.
async function setInngestEventConfig(
  eventKey: string,
  baseUrl: string,
  attempts: number
) {
  for (let attempt = 1; ; attempt++) {
    try {
      await sql`SELECT public.set_inngest_event_config(${eventKey}, ${baseUrl})`.execute(
        getDatabaseClient()
      );
      return;
    } catch (error) {
      // The function arrives with a migration, which can land after the app.
      if (attempt >= attempts) throw error;
      await sleep(RETRY_DELAY_MS);
    }
  }
}

const globalForEventUrl = globalThis as typeof globalThis & {
  __carbonInngestEventUrlStarted?: boolean;
};

/**
 * Fire-and-forget, production only: local dev's database reaches Inngest at a
 * docker-network address `crbn` sets. A serverless instance tries once (its
 * next cold start tries again); a long-lived one retries for a few minutes.
 */
export function scheduleInngestEventUrlSync() {
  if (process.env.NODE_ENV !== "production") return;
  if (globalForEventUrl.__carbonInngestEventUrlStarted) return;
  globalForEventUrl.__carbonInngestEventUrlStarted = true;

  const eventKey = process.env.INNGEST_EVENT_KEY;
  if (!eventKey) {
    log.warn(
      "INNGEST_EVENT_KEY is not set: database events will not reach Inngest"
    );
    return;
  }
  const baseUrl =
    process.env.INNGEST_EVENT_API_BASE_URL ||
    process.env.INNGEST_BASE_URL ||
    "https://inn.gs/";
  async.background(
    () => setInngestEventConfig(eventKey, baseUrl, process.env.VERCEL ? 1 : 5),
    (error) =>
      log.error(
        "Could not set the Inngest event key: database events will not reach Inngest until it is set",
        { error }
      )
  );
}
