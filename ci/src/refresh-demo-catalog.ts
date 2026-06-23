import * as dotenv from "dotenv";

import { client } from "./client";

dotenv.config();

type Workspace = {
  id: number;
  inngest_base_url: string | null;
  inngest_event_key: string | null;
};

const RETRY_DELAYS_MS = [2000, 4000, 8000];

// POST the event to a workspace's Inngest environment, retrying transient
// failures with exponential backoff so a network blip doesn't fail the deploy.
async function sendEvent(baseUrl: string, eventKey: string): Promise<void> {
  const body = JSON.stringify({
    name: "carbon/refresh-demo-catalog",
    data: {},
  });

  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${baseUrl}/e/${eventKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (res.ok) return;
      const text = await res.text().catch(() => "(unreadable body)");
      throw new Error(`${res.status} ${text}`);
    } catch (err) {
      if (attempt >= RETRY_DELAYS_MS.length) throw err;
      await new Promise((resolve) =>
        setTimeout(resolve, RETRY_DELAYS_MS[attempt]),
      );
    }
  }
}

// Fired by the deploy pipeline right after migrations apply. Multi-tenant: each
// workspace is its own Inngest environment (its own event key, mirrored in the
// workspaces table), so — exactly like `ci:jobs` re-syncs every workspace's
// /api/inngest — we fan the refresh event out to every workspace. Each
// workspace's `refresh-demo-catalog` job then re-exports its demo catalog from
// its source companies against its own (now-migrated) database.
async function main(): Promise<void> {
  const { data: workspaces, error } = await client
    .from("workspaces")
    .select("id, inngest_base_url, inngest_event_key");

  if (error) {
    console.error("🔴 Failed to fetch workspaces", error);
    process.exit(1);
  }

  let hasErrors = false;

  for (const ws of (workspaces ?? []) as Workspace[]) {
    if (!ws.inngest_event_key) {
      console.log(`⏭️ Skipping workspace ${ws.id} — no inngest_event_key`);
      continue;
    }
    const baseUrl = ws.inngest_base_url || "https://inn.gs";
    try {
      await sendEvent(baseUrl, ws.inngest_event_key);
      console.log(`✅ Triggered demo-catalog refresh for workspace ${ws.id}`);
    } catch (err) {
      console.error(`🔴 Failed to trigger refresh for workspace ${ws.id}`, err);
      hasErrors = true;
    }
  }

  if (hasErrors) {
    console.error("🔴 Demo catalog refresh trigger completed with errors");
    process.exit(1);
  }

  console.log("✅ Triggered carbon/refresh-demo-catalog for all workspaces");
}

main().catch((err) => {
  console.error("🔴 refresh-demo-catalog trigger failed", err);
  process.exit(1);
});
