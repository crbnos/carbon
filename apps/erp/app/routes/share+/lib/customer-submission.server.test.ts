// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  limitedFormData,
  SubmissionTooLargeError
} from "./customer-submission-body.server";

describe("customer portal submission body limit", () => {
  it("parses a small form without a declared length", async () => {
    const form = new FormData();
    form.set("lines", "[]");
    const request = new Request("https://example.test/share/customer/id/rfq", {
      method: "POST",
      body: form
    });
    expect(request.headers.has("content-length")).toBe(false);

    const parsed = await limitedFormData(request, 11 * 1024 * 1024);
    expect(parsed.get("lines")).toBe("[]");
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

    await expect(
      limitedFormData(request, 11 * 1024 * 1024)
    ).rejects.toBeInstanceOf(SubmissionTooLargeError);
    expect(cancelled).toBe(true);
    expect(chunksRead).toBeLessThan(200);
  });
});
