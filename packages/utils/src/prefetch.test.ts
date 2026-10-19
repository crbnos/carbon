// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { prefetchCacheMiddleware } from "./prefetch";

const run = (
  headers: Record<string, string>,
  response: Response,
  method = "GET"
) =>
  prefetchCacheMiddleware(
    {
      request: new Request("https://app.test/x/parts.data", { method, headers })
    },
    async () => response
  );

describe("prefetchCacheMiddleware", () => {
  it("caches a prefetch for a few seconds, privately", async () => {
    const res = await run({ "Sec-Purpose": "prefetch" }, new Response("ok"));
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=5");
  });

  it("recognises the older Purpose header", async () => {
    const res = await run({ Purpose: "prefetch" }, new Response("ok"));
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=5");
  });

  it("leaves a navigation uncached", async () => {
    const res = await run({}, new Response("ok"));
    expect(res.headers.get("Cache-Control")).toBeNull();
  });

  it("keeps a Cache-Control the route set", async () => {
    const res = await run(
      { "Sec-Purpose": "prefetch" },
      new Response("ok", { headers: { "Cache-Control": "no-store" } })
    );
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("does not cache a redirect or an error", async () => {
    const redirect = await run(
      { "Sec-Purpose": "prefetch" },
      new Response(null, { status: 302, headers: { Location: "/x" } })
    );
    const failed = await run(
      { "Sec-Purpose": "prefetch" },
      new Response("no", { status: 500 })
    );
    expect(redirect.headers.get("Cache-Control")).toBeNull();
    expect(failed.headers.get("Cache-Control")).toBeNull();
  });

  it("sets the header on a response whose headers are immutable", async () => {
    const immutable = Response.redirect("https://app.test/", 302);
    const ok = new Response("ok");
    Object.defineProperty(ok, "headers", { value: immutable.headers });
    const res = await run({ "Sec-Purpose": "prefetch" }, ok);
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=5");
  });
});
