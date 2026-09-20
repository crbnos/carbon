import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: () => ({})
}));
vi.mock("@carbon/jobs", () => ({ trigger: vi.fn() }));
vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ info: vi.fn(), error: vi.fn() })
}));
vi.mock("@carbon/ee/ramp.server", async (original) => ({
  ...(await original<typeof import("@carbon/ee/ramp.server")>()),
  getRampIntegration: vi.fn(),
  completeWebhookVerification: vi.fn()
}));

import {
  completeWebhookVerification,
  getRampIntegration
} from "@carbon/ee/ramp.server";
import { trigger } from "@carbon/jobs";
import { action } from "./webhook.ramp.$companyId";

const secret = "test-webhook-secret";
const challenge = "ownership-challenge";

function request(
  body: string,
  signature: "valid" | "invalid" | "missing",
  query = ""
) {
  const headers = new Headers();
  if (signature !== "missing") {
    headers.set(
      "x-ramp-signature",
      createHmac("sha256", signature === "valid" ? secret : "wrong-secret")
        .update(body)
        .digest("base64")
    );
  }
  return new Request(`http://localhost/api/webhook/ramp/company-1${query}`, {
    method: "POST",
    body,
    headers
  });
}

function run(delivery: Request) {
  return action({
    request: delivery,
    params: { companyId: "company-1" }
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getRampIntegration).mockResolvedValue({
    metadata: { webhookSecret: secret }
  } as Awaited<ReturnType<typeof getRampIntegration>>);
});

describe("Ramp webhook challenge authentication", () => {
  it.each([
    "missing",
    "invalid"
  ] as const)("rejects a body challenge with %s signature without callback or echo", async (signature) => {
    const result = await run(request(JSON.stringify({ challenge }), signature));
    expect(result).toMatchObject({ init: { status: 401 } });
    expect(result).not.toHaveProperty("challenge");
    expect(completeWebhookVerification).not.toHaveBeenCalled();
    expect(trigger).not.toHaveBeenCalled();
  });

  it("rejects a challenge when no webhook secret is configured", async () => {
    vi.mocked(getRampIntegration).mockResolvedValue({
      metadata: {}
    } as Awaited<ReturnType<typeof getRampIntegration>>);
    const result = await run(request(JSON.stringify({ challenge }), "valid"));
    expect(result).toMatchObject({ init: { status: 401 } });
    expect(completeWebhookVerification).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("challenge");
  });

  it("verifies and echoes a validly signed body challenge", async () => {
    const result = await run(request(JSON.stringify({ challenge }), "valid"));
    expect(result).toEqual({ challenge });
    expect(completeWebhookVerification).toHaveBeenCalledExactlyOnceWith(
      {},
      "company-1",
      challenge
    );
    expect(trigger).not.toHaveBeenCalled();
  });

  it("does not authenticate a query-only challenge with a signature over another body", async () => {
    const result = await run(request("{}", "valid", `?challenge=${challenge}`));
    expect(result).not.toHaveProperty("challenge");
    expect(completeWebhookVerification).not.toHaveBeenCalled();
  });

  it("does not let an unsigned query override a signed body challenge", async () => {
    const result = await run(
      request(JSON.stringify({ challenge }), "valid", "?challenge=attacker")
    );
    expect(result).toEqual({ challenge });
    expect(completeWebhookVerification).toHaveBeenCalledExactlyOnceWith(
      {},
      "company-1",
      challenge
    );
  });
});
