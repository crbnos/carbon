import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  syncIssueFromJiraSchema: (
    await import("../../../../../packages/jobs/src/schemas")
  ).syncIssueFromJiraSchema,
  trigger: vi.fn()
}));
vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ info: vi.fn(), error: vi.fn(), warning: vi.fn() })
}));

import { trigger } from "@carbon/jobs";
import { action } from "./webhook.jira.$companyId";

const SECRET = "jira-admin-webhook-secret";

const body = JSON.stringify({
  timestamp: 1_790_000_000_000,
  webhookEvent: "jira:issue_updated",
  issue: {
    id: "10001",
    key: "QA-1",
    fields: { summary: "Fix the fixture" }
  }
});

function sign(payload: string, secret = SECRET) {
  return `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

function run(payload: string, signature?: string) {
  const headers = new Headers({ "content-type": "application/json" });
  if (signature !== undefined) headers.set("x-hub-signature", signature);
  const request = new Request("http://localhost/api/webhook/jira/company-1", {
    method: "POST",
    body: payload,
    headers
  });
  return action({ request, params: { companyId: "company-1" } } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  db.row = { active: true, metadata: {}, secretRef: "secret-ref" };
  db.vault = {
    credentials: { accessToken: "at", refreshToken: "rt" },
    webhookSigningSecret: SECRET
  };
});

describe("Jira webhook with a signing secret", () => {
  it("accepts a validly signed delivery and triggers the sync", async () => {
    expect(await run(body, sign(body))).toEqual({ success: true });
    expect(trigger).toHaveBeenCalledOnce();
    expect(vi.mocked(trigger).mock.calls[0]?.[0]).toBe("sync-issue-from-jira");
  });

  it.each([
    ["missing", undefined],
    ["signed with the wrong secret", sign(body, "wrong-secret")],
    ["missing the sha256= prefix", sign(body).slice("sha256=".length)],
    ["using an unsupported method", sign(body).replace("sha256=", "sha1=")],
    ["an empty digest", "sha256="],
    ["a valid digest with trailing junk", `${sign(body)}zz`]
  ])("rejects a signature that is %s with 401", async (_label, signature) => {
    const result = await run(body, signature);
    expect(result).toMatchObject({ init: { status: 401 } });
    expect(trigger).not.toHaveBeenCalled();
  });

  it("rejects a signature over a different body", async () => {
    const tampered = body.replace("QA-1", "QA-2");
    const result = await run(tampered, sign(body));
    expect(result).toMatchObject({ init: { status: 401 } });
    expect(trigger).not.toHaveBeenCalled();
  });

  it("fails closed with 500 when the vault cannot be read", async () => {
    db.row = { active: true, metadata: {}, secretRef: null };
    const result = await run(body, sign(body));
    expect(result).toMatchObject({ init: { status: 500 } });
    expect(trigger).not.toHaveBeenCalled();
  });
});

describe("Jira webhook without a signing secret", () => {
  it("still accepts an unsigned delivery (existing installs)", async () => {
    db.vault = { credentials: { accessToken: "at", refreshToken: "rt" } };
    expect(await run(body)).toEqual({ success: true });
    expect(trigger).toHaveBeenCalledOnce();
  });
});
