import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The DB boundary: `companyIntegration` row + the vault RPC that resolves its
// secret bag. Everything between it and the route (getIntegration,
// resolveIntegrationSecrets, the HMAC check) runs for real.
const db = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  vault: {} as Record<string, unknown>
}));
// Env constants only: the real @carbon/auth barrel reaches Lingui macros that
// only compile under Vite's lingui plugin.
vi.mock("@carbon/auth", () => ({
  SUPABASE_URL: "http://localhost",
  JIRA_CLIENT_ID: "test",
  JIRA_CLIENT_SECRET: "test"
}));
vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: () => {
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () => ({ data: db.row, error: null })
    };
    return {
      from: () => query,
      rpc: async () => ({ data: db.vault, error: null })
    };
  }
}));
// The real payload schema (the @carbon/jobs barrel pulls in Lingui macros that
// only compile under Vite's lingui plugin); `trigger` is the Inngest boundary.
vi.mock("@carbon/jobs", async () => ({
  syncIssueFromLinearSchema: (
    await import("../../../../../packages/jobs/src/schemas")
  ).syncIssueFromLinearSchema,
  trigger: vi.fn()
}));
vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ info: vi.fn(), error: vi.fn(), warning: vi.fn() })
}));

import { trigger } from "@carbon/jobs";
import { action } from "./webhook.linear.$companyId";

const SECRET = "lin_wh_test_signing_secret";
const NOW = 1_790_000_000_000;

function payload(webhookTimestamp = NOW) {
  return JSON.stringify({
    type: "Issue",
    action: "update",
    data: { id: "issue-1", assigneeId: "user-1" },
    webhookTimestamp
  });
}

function sign(body: string, secret = SECRET) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function run(body: string, signature?: string) {
  const headers = new Headers({ "content-type": "application/json" });
  if (signature !== undefined) headers.set("linear-signature", signature);
  const request = new Request("http://localhost/api/webhook/linear/company-1", {
    method: "POST",
    body,
    headers
  });
  return action({ request, params: { companyId: "company-1" } } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  db.row = { active: true, metadata: {}, secretRef: "secret-ref" };
  db.vault = { apiKey: "lin_api_key", webhookSigningSecret: SECRET };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Linear webhook with a signing secret", () => {
  it("accepts a validly signed, fresh delivery and triggers the sync", async () => {
    const body = payload();
    expect(await run(body, sign(body))).toEqual({ success: true });
    expect(trigger).toHaveBeenCalledExactlyOnceWith("sync-issue-from-linear", {
      companyId: "company-1",
      event: {
        type: "Issue",
        action: "update",
        data: { id: "issue-1", assigneeId: "user-1" }
      }
    });
  });

  it.each([
    ["missing", undefined],
    ["signed with the wrong secret", sign(payload(), "wrong-secret")],
    ["not hex", "not-a-signature"],
    ["a valid digest with trailing junk", `${sign(payload())}zz`],
    ["truncated", sign(payload()).slice(0, 32)]
  ])("rejects a signature that is %s with 401", async (_label, signature) => {
    const result = await run(payload(), signature);
    expect(result).toMatchObject({ init: { status: 401 } });
    expect(trigger).not.toHaveBeenCalled();
  });

  it("rejects a signature over a different body", async () => {
    const tampered = payload().replace("issue-1", "issue-2");
    const result = await run(tampered, sign(payload()));
    expect(result).toMatchObject({ init: { status: 401 } });
    expect(trigger).not.toHaveBeenCalled();
  });

  it.each([
    ["older than 60 s", NOW - 60_001],
    ["more than 60 s in the future", NOW + 60_001]
  ])("rejects a validly signed delivery %s (replay)", async (_label, ts) => {
    const body = payload(ts);
    const result = await run(body, sign(body));
    expect(result).toMatchObject({ init: { status: 401 } });
    expect(trigger).not.toHaveBeenCalled();
  });

  it("rejects a validly signed delivery without webhookTimestamp", async () => {
    const body = JSON.stringify({
      type: "Issue",
      action: "update",
      data: { id: "issue-1" }
    });
    const result = await run(body, sign(body));
    expect(result).toMatchObject({ init: { status: 401 } });
    expect(trigger).not.toHaveBeenCalled();
  });

  it("fails closed with 500 when the vault cannot be read", async () => {
    db.row = { active: true, metadata: {}, secretRef: null };
    const body = payload();
    const result = await run(body, sign(body));
    expect(result).toMatchObject({ init: { status: 500 } });
    expect(trigger).not.toHaveBeenCalled();
  });
});

describe("Linear webhook without a signing secret", () => {
  beforeEach(() => {
    db.vault = { apiKey: "lin_api_key" };
  });

  it("still accepts an unsigned delivery (existing installs)", async () => {
    expect(await run(payload())).toEqual({ success: true });
    expect(trigger).toHaveBeenCalledOnce();
  });

  it("does not apply the replay window to unsigned deliveries", async () => {
    expect(await run(payload(NOW - 3_600_000))).toEqual({ success: true });
    expect(trigger).toHaveBeenCalledOnce();
  });
});
