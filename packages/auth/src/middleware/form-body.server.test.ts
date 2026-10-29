// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { installFormBodyGuard } from "./form-body.server";

installFormBodyGuard();

const post = (type: string | null, body: string) =>
  new Request("https://app.test/x/receipt/1/post", {
    method: "POST",
    headers: type ? { "content-type": type } : {},
    body
  });

async function thrown(request: Request): Promise<unknown> {
  try {
    await request.formData();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("installFormBodyGuard", () => {
  it("reads a form body as before", async () => {
    const form = await post(
      "application/x-www-form-urlencoded",
      "a=1&b=two"
    ).formData();
    expect(form.get("b")).toBe("two");
  });

  it("answers JSON sent to a form action with a 415 that says what to send", async () => {
    const error = await thrown(post("application/json", '{"a":1}'));
    expect(error).toBeInstanceOf(Response);
    const response = error as Response;
    expect(response.status).toBe(415);
    expect(response.headers.get("Accept-Post")).toBe(
      "application/x-www-form-urlencoded, multipart/form-data"
    );
    expect(response.headers.get("Link")).toBe(
      '</api/v1/openapi.json>; rel="service-desc"'
    );
    expect((await response.json()).hint).toContain("/api/v1/openapi.json");
  });

  it("answers a form body it cannot parse with a 400", async () => {
    const error = await thrown(
      post("multipart/form-data; boundary=x", "not a multipart body")
    );
    expect((error as Response).status).toBe(400);
  });

  it("leaves a body read twice as the server bug it is", async () => {
    const request = post("application/json", "{}");
    await request.text();
    const error = await thrown(request);
    expect(error).toBeInstanceOf(TypeError);
  });
});
