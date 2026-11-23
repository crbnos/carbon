// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { signInternalCall } from "@carbon/api/internal-call";
import {
  type PostingHandles,
  type Postings,
  registerPostings
} from "@carbon/api/postings.server";
import { redis } from "@carbon/kv";
import { describe, expect, it } from "vitest";
import { action } from "./internal.postings.$name";

// SESSION_SECRET as vitest.config.ts sets it. Only the replay check needs a
// real Redis: without one the endpoint accepts a signed call unchecked.
const SECRET = "test";
const reachable = (await redis.ping()) === "PONG";

// The one posting the calls below may reach, registered through the app's seam.
const received: { handles: PostingHandles; input: unknown }[] = [];
registerPostings({
  issue: async (handles, input) => {
    received.push({ handles, input });
    return { data: { success: true }, error: null };
  }
} as Postings);

const jwt = `h.${Buffer.from(JSON.stringify({ sub: "u1" })).toString("base64url")}.s`;

function call(
  name: string,
  input: unknown,
  {
    authorization = "",
    headers
  }: { authorization?: string; headers?: Record<string, string> } = {}
) {
  const body = JSON.stringify(input);
  const signed =
    headers ??
    signInternalCall(
      SECRET,
      {
        name,
        companyId: "c1",
        userId: "u1",
        mode: authorization ? "caller" : "system"
      },
      body,
      authorization
    );
  return {
    headers: signed,
    run: () =>
      action({
        request: new Request(`http://erp.test/api/internal/postings/${name}`, {
          method: "POST",
          headers: signed,
          body
        }),
        params: { name },
        context: {}
      } as never)
  };
}

const issue = { type: "jobOperation", id: "op1", quantity: 2 };

describe("the internal postings endpoint", () => {
  it("runs a signed call as the system for the signed company and user", async () => {
    received.length = 0;
    const response = await call("issue", issue).run();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { success: true },
      error: null
    });
    expect(received).toHaveLength(1);
    expect(received[0]!.handles).toMatchObject({
      companyId: "c1",
      userId: "u1"
    });
    expect(received[0]!.handles.client).toBeUndefined();
    expect(received[0]!.input).toEqual(issue);
  });

  it("hands a caller-mode posting the user's client", async () => {
    received.length = 0;
    const response = await call("issue", issue, {
      authorization: `Bearer ${jwt}`
    }).run();
    expect(response.status).toBe(200);
    expect(received[0]!.handles.client).toBeDefined();
  });

  it("refuses an unsigned call", async () => {
    const response = await call("issue", issue, { headers: {} }).run();
    expect(response.status).toBe(401);
  });

  it("refuses a body too large before reading it", async () => {
    received.length = 0;
    const { headers } = call("issue", issue);
    const response = await action({
      request: new Request("http://erp.test/api/internal/postings/issue", {
        method: "POST",
        headers: { ...headers, "content-length": String(2 * 1024 * 1024) },
        body: "{}"
      }),
      params: { name: "issue" },
      context: {}
    } as never);
    expect(response.status).toBe(413);
    expect(received).toHaveLength(0);
  });

  it.skipIf(!reachable)("refuses the same call twice", async () => {
    const first = call("issue", issue);
    expect((await first.run()).status).toBe(200);
    const again = call("issue", issue, { headers: first.headers });
    expect((await again.run()).status).toBe(409);
  });

  it("refuses a posting or type MES does not send", async () => {
    received.length = 0;
    expect((await call("post-receipt", { receiptId: "r1" }).run()).status).toBe(
      404
    );
    expect(
      (
        await call("issue", {
          type: "jobCompleteMakeToOrder",
          jobId: "j1",
          quantityComplete: 1
        }).run()
      ).status
    ).toBe(404);
    expect(received).toHaveLength(0);
  });
});
