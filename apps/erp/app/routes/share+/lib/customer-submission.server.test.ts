// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { context, validate, submitRfq } = vi.hoisted(() => ({
  context: vi.fn(),
  validate: vi.fn(),
  submitRfq: vi.fn()
}));

vi.mock("@carbon/kv", () => ({
  redis: {},
  Ratelimit: Object.assign(
    class {
      limit = async () => ({ success: true });
    },
    { slidingWindow: () => "window" }
  )
}));
vi.mock("@carbon/form", () => ({ validator: () => ({ validate }) }));
vi.mock("~/modules/sales/sales.models", () => ({
  customerPortalPoValidator: {},
  customerPortalRfqValidator: {}
}));
vi.mock("~/modules/sales/sales.server", () => ({
  submitCustomerPortalPo: vi.fn(),
  submitCustomerPortalRfq: submitRfq
}));
vi.mock("~/modules/sales/sales.service", () => ({
  customerPortalSubmissionContext: context
}));

import { handleCustomerPortalSubmission } from "./customer-submission.server";

type RouteResult = { data: { code?: string }; init: { status: number } };

describe("customer portal submission body limit", () => {
  beforeEach(() => {
    context.mockReset().mockResolvedValue({ ctx: {}, customerId: "customer" });
    validate.mockReset().mockResolvedValue({ data: { lines: [] } });
    submitRfq.mockReset().mockResolvedValue({
      data: { submissionId: "submission", salesRfqId: "rfq" }
    });
  });

  it("accepts a form without a declared length when its actual body is small", async () => {
    const form = new FormData();
    form.set("lines", "[]");
    const request = new Request("https://example.test/share/customer/id/rfq", {
      method: "POST",
      body: form
    });
    expect(request.headers.has("content-length")).toBe(false);

    const result = (await handleCustomerPortalSubmission(
      request,
      "portal",
      "rfq"
    )) as RouteResult;
    expect(result.init.status).toBe(201);
    expect(submitRfq).toHaveBeenCalledOnce();
  });

  it("stops an oversized multipart stream without a declared length", async () => {
    const prefix = new TextEncoder().encode(
      '--limit\r\nContent-Disposition: form-data; name="lines"\r\n\r\n'
    );
    const chunk = new Uint8Array(64 * 1024).fill(65);
    let chunksRead = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (chunksRead === 0) controller.enqueue(prefix);
        else controller.enqueue(chunk);
        chunksRead++;
      },
      cancel() {
        cancelled = true;
      }
    });
    const request = new Request("https://example.test/share/customer/id/po", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=limit" },
      body,
      duplex: "half"
    } as RequestInit);
    expect(request.headers.has("content-length")).toBe(false);

    const result = (await handleCustomerPortalSubmission(
      request,
      "portal",
      "po"
    )) as RouteResult;
    expect(result.init.status).toBe(413);
    expect(result.data.code).toBe("payload_too_large");
    expect(cancelled).toBe(true);
    expect(chunksRead).toBeLessThan(200);
    expect(validate).not.toHaveBeenCalled();
  });
});
