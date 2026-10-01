// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: () => ({})
}));
vi.mock("@carbon/jobs", () => ({ trigger: vi.fn() }));
// Mirror the real logger surface. A partial mock turns "this route logs a
// rejection" into "this route throws", which is strictly worse than the 401 the
// log exists to explain. Hoisted so the rejection payload can be inspected —
// this endpoint is unauthenticated, so what it logs is part of its contract.
const log = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  warning: vi.fn(),
  error: vi.fn()
}));
vi.mock("@carbon/logger", () => ({ getLogger: () => log }));
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

describe("Ramp webhook rejection logging", () => {
  /**
   * The route rejects before any signature check, on a PUBLIC URL. A diagnostic
   * block here used to emit the full sorted list of request header names on every
   * rejection, so an anonymous caller could choose both the volume and the
   * content of the log by POSTing in a loop.
   */
  it("logs nothing the caller controls when rejecting an unsigned delivery", async () => {
    const delivery = new Request(
      "http://localhost/api/webhook/ramp/company-1",
      {
        method: "POST",
        body: "{}",
        headers: { "x-attacker-chosen-header": "a".repeat(2048) }
      }
    );

    expect(await run(delivery)).toMatchObject({ init: { status: 401 } });
    expect(log.warn).toHaveBeenCalledTimes(1);

    const [, context] = log.warn.mock.calls[0] ?? [];
    expect(context).toEqual({
      companyId: "company-1",
      reason: "no-signature-header"
    });
    expect(JSON.stringify(context)).not.toContain("x-attacker-chosen-header");
  });

  it("logs only the company when a signature does not verify", async () => {
    expect(await run(request("{}", "invalid"))).toMatchObject({
      init: { status: 401 }
    });
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0]?.[1]).toEqual({ companyId: "company-1" });
  });
});
