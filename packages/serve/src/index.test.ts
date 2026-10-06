// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { brotliCompressSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { allowedActionOrigins, createApp, takesBrotli } from "./index.ts";

const SCRIPT = "console.log('carbon');\n".repeat(200);

describe("allowedActionOrigins", () => {
  it("is the host of the configured site URL", () => {
    expect(allowedActionOrigins("https://erp.acme.com")).toEqual([
      "erp.acme.com"
    ]);
    expect(allowedActionOrigins("https://erp.acme.com:8443/x")).toEqual([
      "erp.acme.com:8443"
    ]);
  });

  it("is nothing when the deployment does not say where the app lives", () => {
    expect(allowedActionOrigins(undefined)).toEqual([]);
    expect(allowedActionOrigins("")).toEqual([]);
    expect(allowedActionOrigins("erp.acme.com")).toEqual([]);
  });
});

describe("takesBrotli", () => {
  it("is what the header says, a refusal included", () => {
    expect(takesBrotli("gzip, deflate, br")).toBe(true);
    expect(takesBrotli("BR;q=0.5, gzip")).toBe(true);
    expect(takesBrotli("gzip, br;q=0")).toBe(false);
    expect(takesBrotli("gzip, br; q=0.0")).toBe(false);
    expect(takesBrotli("gzip, brotli")).toBe(false);
    expect(takesBrotli(undefined)).toBe(false);
  });
});

describe("createApp", () => {
  let root: string;
  let app: Awaited<ReturnType<typeof createApp>>;
  const seen: Request[] = [];

  beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), "carbon-serve-"));
    mkdirSync(path.join(root, "assets"));
    // As the build leaves it: the file, and a Brotli copy beside it.
    writeFileSync(path.join(root, "assets", "entry-abc123.js"), SCRIPT);
    writeFileSync(
      path.join(root, "assets", "entry-abc123.js.br"),
      brotliCompressSync(SCRIPT)
    );
    // Too small to be worth compressing, so it stays as it is.
    writeFileSync(path.join(root, "robots.txt"), "User-agent: *\n");

    app = await createApp({
      clientDirectory: root,
      handleRequest: async (request: Request) => {
        seen.push(request);
        const headers = new Headers({ "content-type": "text/plain" });
        headers.append("set-cookie", "a=1; Path=/");
        headers.append("set-cookie", "b=2; Path=/");
        if (new URL(request.url).pathname === "/upload")
          return new Response(String((await request.arrayBuffer()).byteLength));
        const body = request.body ? await request.text() : "";
        if (new URL(request.url).pathname === "/boom")
          throw new Error("postgres://user:secret@db/carbon");
        const type = new URL(request.url).searchParams.get("type");
        if (type)
          return new Response("carbon ".repeat(1000), {
            headers: { "content-type": type }
          });
        if (new URL(request.url).pathname === "/page")
          return new Response("<p>carbon</p>".repeat(500), {
            headers: { "content-type": "text/html; charset=utf-8" }
          });
        return new Response(`${request.method} ${request.url} ${body}`, {
          status: 201,
          headers
        });
      }
    });
  });

  afterAll(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("sends the Brotli file as it is to a browser", async () => {
    const res = await app.inject({
      url: "/assets/entry-abc123.js",
      headers: { "accept-encoding": "gzip, deflate, br" }
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-encoding"]).toBe("br");
    expect(res.headers["cache-control"]).toContain("immutable");
    expect(res.headers["content-type"]).toContain("text/javascript");
    expect(res.headers.vary).toContain("Accept-Encoding");
    expect(res.rawPayload.length).toBeLessThan(SCRIPT.length / 10);
  });

  it("sends the file itself to a caller that refuses Brotli", async () => {
    const res = await app.inject({
      url: "/assets/entry-abc123.js",
      headers: { "accept-encoding": "br;q=0" }
    });
    expect(res.headers["content-encoding"]).toBeUndefined();
    expect(res.payload).toBe(SCRIPT);
  });

  it("sends the file itself to a caller that cannot take Brotli", async () => {
    const res = await app.inject({ url: "/assets/entry-abc123.js" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-encoding"]).toBeUndefined();
    expect(res.headers["content-type"]).toContain("javascript");
    expect(res.headers["cache-control"]).toContain("immutable");
    // A cache in between must not hand this copy to a browser, or the
    // other way round.
    expect(res.headers.vary).toContain("Accept-Encoding");
    expect(res.payload).toBe(SCRIPT);
  });

  it("serves a file the build left uncompressed, cached for less", async () => {
    const res = await app.inject({ url: "/robots.txt" });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toBe("User-agent: *\n");
    expect(res.headers["cache-control"]).toBe("public, max-age=3600");
  });

  it("compresses what the handler renders", async () => {
    const res = await app.inject({
      url: "/page",
      headers: { "accept-encoding": "gzip, deflate, br" }
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-encoding"]).toBe("br");
    expect(res.rawPayload.length).toBeLessThan(1000);
  });

  it("names the charset of a page", async () => {
    const res = await app.inject({ url: "/page" });
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
  });

  it("answers a missing asset itself", async () => {
    seen.length = 0;
    for (const url of [
      "/assets/gone-abc123.js",
      "/_vercel/insights/script.js"
    ]) {
      const res = await app.inject({ url });
      expect(res.statusCode).toBe(404);
      expect(res.headers["cache-control"]).toBe("no-store");
    }
    expect(seen).toHaveLength(0);
  });

  it("keeps the host it was called on, whatever the path says", async () => {
    seen.length = 0;
    await app.inject({
      method: "POST",
      url: "//evil.test/login.data",
      headers: { host: "erp.acme.com" }
    });
    expect(new URL(seen[0]?.url ?? "").host).toBe("erp.acme.com");
  });

  it("passes on a body larger than Fastify's own limit", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/upload",
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.alloc(5 * 1024 * 1024, 1)
    });
    expect(res.payload).toBe(String(5 * 1024 * 1024));
  });

  it("does not tell the caller what failed", async () => {
    const res = await app.inject({ url: "/boom" });
    expect(res.statusCode).toBe(500);
    expect(res.payload).toBe("Internal Server Error");
  });

  it("compresses text and leaves an event stream alone", async () => {
    const encoding = async (type: string) =>
      (
        await app.inject({
          url: `/data?type=${encodeURIComponent(type)}`,
          headers: { "accept-encoding": "br" }
        })
      ).headers["content-encoding"];
    expect(await encoding("application/json")).toBe("br");
    expect(await encoding("text/x-component")).toBe("br");
    expect(await encoding("text/event-stream")).toBeUndefined();
  });

  it("answers a URL it cannot decode plainly", async () => {
    const res = await app.inject({ url: "/%E0%A4%A" });
    expect(res.statusCode).toBe(400);
    expect(res.payload).toBe("Bad Request");
  });

  it("outlives a proxy's idle connections and bounds a slow request", () => {
    expect(app.server.keepAliveTimeout).toBeGreaterThan(90_000);
    expect(app.server.requestTimeout).toBe(300_000);
  });

  it("does not climb out of the client directory", async () => {
    // Not in the index, so never the filesystem's to answer.
    const res = await app.inject({ url: "/assets/..%2F..%2Fetc%2Fpasswd.txt" });
    expect(res.statusCode).toBe(404);
    const other = await app.inject({ url: "/..%2F..%2Fetc%2Fpasswd.txt" });
    expect(other.statusCode).toBe(201);
  });

  it("hands everything else to the handler, body and headers intact", async () => {
    seen.length = 0;
    const res = await app.inject({
      method: "POST",
      url: "/login.data?redirectTo=%2F",
      headers: {
        host: "erp.acme.com",
        origin: "https://erp.acme.com",
        "content-type": "application/x-www-form-urlencoded"
      },
      payload: "email=ada%40acme.com"
    });
    expect(res.statusCode).toBe(201);
    expect(res.payload).toBe(
      "POST http://erp.acme.com/login.data?redirectTo=%2F email=ada%40acme.com"
    );
    expect(seen[0]?.headers.get("origin")).toBe("https://erp.acme.com");
    // Both cookies, not the last one.
    expect(res.headers["set-cookie"]).toEqual(["a=1; Path=/", "b=2; Path=/"]);
  });
});
