// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The server a self-hosted app runs on. `node` runs this file as it is, by
// stripping the types: the runtime image has no TypeScript toolchain. So
// only syntax that can be erased — no enums, no parameter properties, and
// `import type` for anything that is only a type.
//
// It replaces `react-router-serve`, which loads the build itself and so
// leaves no place to stand between a request and React Router. Two things
// need that place:
//
//  - React Router refuses a form submit whose `Origin` is not the origin of
//    `request.url`. Behind a proxy that ends TLS the app is called over
//    http, the browser says https, and every submit was a 400. The
//    deployment already says where the app lives (`siteUrl`); that host is
//    allowed, through the option React Router has for it.
//  - Static files compressed once at build (Brotli, the originals removed),
//    sent as they are instead of being compressed again on every request.

import { createReadStream, readdirSync } from "node:fs";
import path from "node:path";
import { pipeline, Readable } from "node:stream";
import { constants, createBrotliDecompress } from "node:zlib";
import fastifyCompress from "@fastify/compress";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import {
  createRequestHandler,
  RouterContextProvider,
  type ServerBuild
} from "react-router";

/**
 * The hosts whose forms React Router should accept: the app's own, read
 * from where the deployment says it lives. Nothing when that is unset or
 * unreadable — the request's own origin is then the only one accepted, as
 * it is in local development.
 */
export function allowedActionOrigins(siteUrl: string | undefined): string[] {
  if (!siteUrl) return [];
  try {
    return [new URL(siteUrl).host];
  } catch {
    return [];
  }
}

// What the build compresses, and so the only types a `.br` with no original
// beside it can be.
const TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".toml": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".xml": "application/xml; charset=utf-8",
  ".yaml": "text/plain; charset=utf-8",
  ".yml": "text/plain; charset=utf-8"
};

// Fingerprinted by the build: the name changes when the bytes do.
const IMMUTABLE = "public, max-age=31536000, immutable";
const SHORT = "public, max-age=3600";

// Paths that are a file or nothing.
const NEVER_A_PAGE = /^\/(assets|_vercel)\//;

const contentType = (file: string) =>
  TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";

const cacheControl = (urlPath: string) =>
  urlPath.startsWith("/assets/") ? IMMUTABLE : SHORT;

/**
 * Every file in the built client, by its path from the root. Read once: an
 * image's files do not change under it, and asking the disk on each request
 * is what made a directory of two thousand chunks slow to serve from.
 */
function indexFiles(root: string): Set<string> {
  const files = new Set<string>();
  for (const entry of readdirSync(root, {
    recursive: true,
    withFileTypes: true
  })) {
    if (!entry.isFile()) continue;
    const rel = path
      .relative(root, path.join(entry.parentPath, entry.name))
      .split(path.sep)
      .join("/");
    if (!rel.split("/").some((segment) => segment.startsWith(".")))
      files.add(rel);
  }
  return files;
}

/**
 * A Node request as the Fetch `Request` React Router takes. The URL is the
 * one the app was called on — host from the `Host` header, scheme from the
 * socket — exactly as `react-router-serve` built it.
 */
function toRequest(req: FastifyRequest, signal: AbortSignal): Request {
  const raw = req.raw;
  const encrypted = "encrypted" in raw.socket && raw.socket.encrypted;
  // Joined as text, never resolved against a base: a path of `//other.host/x`
  // resolved that way names another host, and React Router checks a form's
  // `Origin` against this URL.
  const url = new URL(
    `${encrypted ? "https" : "http"}://${raw.headers.host ?? "localhost"}${raw.url ?? "/"}`
  );
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const v of value) headers.append(name, v);
    else headers.set(name, value);
  }
  const hasBody = raw.method !== "GET" && raw.method !== "HEAD";
  return new Request(url, {
    method: raw.method,
    headers,
    signal,
    // Node's stream type and the DOM's disagree on a detail of byte
    // readers; at runtime they are the one class.
    ...(hasBody
      ? { body: Readable.toWeb(raw) as unknown as BodyInit, duplex: "half" }
      : {})
  } as RequestInit);
}

/** The server, not yet listening — which is what a test wants. */
export async function createApp({
  handleRequest,
  clientDirectory
}: {
  /** Everything that is not a file: React Router, usually. */
  handleRequest: (request: Request) => Promise<Response> | Response;
  /** The built client, served at `/`. */
  clientDirectory: string;
}) {
  const root = path.resolve(clientDirectory);
  // The apps log their own requests, with the request id; a second line
  // from here said the same thing without one.
  const app = Fastify({
    logger: false,
    // Longer than any proxy in front holds an idle connection (an ALB 60s,
    // Traefik 90s). Shorter, and the proxy reuses a connection this side
    // has just closed: an occasional 502 on a request that was never read.
    keepAliveTimeout: 100_000,
    // Node's own limit on how long a request may take to arrive, which
    // Fastify turns off. Without it a client that never finishes sending
    // holds its connection for good.
    requestTimeout: 300_000,
    // A URL the router cannot decode. Fastify's own answer is JSON naming
    // its error code.
    frameworkErrors: (_error, _req, reply) =>
      (reply as FastifyReply)
        .code(400)
        .type("text/plain; charset=utf-8")
        .send("Bad Request")
  });

  // Bodies are React Router's to read. Parsed here, the stream it is handed
  // would already be empty.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", (_req, _payload, done) => done(null));

  // For what is rendered per request. A file compressed at build already
  // carries its encoding and is left alone. Flushed as it is written:
  // React streams a page in pieces, and a compressor that waits for a full
  // buffer holds the first of them back.
  await app.register(fastifyCompress, {
    global: true,
    encodings: ["br", "gzip"],
    threshold: 1024,
    brotliOptions: {
      flush: constants.BROTLI_OPERATION_FLUSH,
      params: { [constants.BROTLI_PARAM_QUALITY]: 4 }
    },
    zlibOptions: { flush: constants.Z_SYNC_FLUSH }
  });

  // Only for `reply.sendFile`, which answers ranges and conditional
  // requests. Which file is ours to say, from the index: left to find it
  // itself, the plugin lists the directory on every request.
  const files = indexFiles(root);
  await app.register(fastifyStatic, {
    root,
    serve: false,
    cacheControl: false,
    setHeaders(reply, filePath) {
      const urlPath = `/${path.relative(root, filePath).split(path.sep).join("/")}`;
      reply.header("Cache-Control", cacheControl(urlPath));
      if (!filePath.endsWith(".br")) return;
      // The build left only the Brotli file; say what it is a file of.
      reply
        .header("Content-Type", contentType(filePath.slice(0, -3)))
        .header("Content-Encoding", "br")
        .header("Vary", "Accept-Encoding");
    }
  });

  // A route, not the not-found handler: the compression above attaches to
  // routes, and pages rendered from the not-found handler went out as they
  // were.
  app.all("/*", async (req, reply) => {
    const { method } = req.raw;
    const urlPath = (req.raw.url ?? "/").split("?")[0] ?? "/";

    if (method === "GET" || method === "HEAD") {
      let rel = "";
      try {
        rel = decodeURIComponent(urlPath).slice(1);
      } catch {
        // Not a path at all: React Router's to refuse.
      }
      if (files.has(rel)) return reply.sendFile(rel);
      if (files.has(`${rel}.br`)) {
        if (/\bbr\b/.test(String(req.headers["accept-encoding"] ?? "")))
          return reply.sendFile(`${rel}.br`);
        // Every browser takes Brotli; a monitor or a script may not.
        reply
          .header("Content-Type", contentType(rel))
          .header("Cache-Control", cacheControl(urlPath))
          .header("Vary", "Accept-Encoding");
        if (method === "HEAD") return reply.send();
        // `pipeline`, so a failed read ends the response instead of the
        // process.
        return reply.send(
          pipeline(
            createReadStream(path.join(root, `${rel}.br`)),
            createBrotliDecompress(),
            () => {}
          )
        );
      }
      // A chunk from before the last deploy, or Vercel's analytics script
      // off Vercel: there is no page to render for these, and rendering the
      // app's 404 for each cost a full pass through React Router.
      if (NEVER_A_PAGE.test(urlPath))
        return reply
          .code(404)
          .header("Cache-Control", "no-store")
          .type("text/plain; charset=utf-8")
          .send("Not found");
    }

    // Stops the render when the browser goes away, as the stock server did.
    const controller = new AbortController();
    reply.raw.on("close", () => {
      if (!reply.raw.writableFinished) controller.abort();
    });
    const response = await handleRequest(toRequest(req, controller.signal));
    // The stock server named the charset on text it was handed without one.
    const type = response.headers.get("content-type");
    if (type && /^text\/[^;]+$/.test(type))
      response.headers.set("content-type", `${type}; charset=utf-8`);
    return reply.send(response);
  });

  // Fastify's own answer carries the error's message; what failed is for
  // the log, not the caller.
  app.setErrorHandler((error: { statusCode?: unknown }, _req, reply) => {
    const status =
      typeof error.statusCode === "number" && error.statusCode >= 400
        ? error.statusCode
        : 500;
    if (status >= 500) console.error("[carbon] request failed", error);
    reply
      .code(status)
      .type("text/plain; charset=utf-8")
      .send(status >= 500 ? "Internal Server Error" : "Bad Request");
  });

  return app;
}

/**
 * Starts a built React Router app.
 */
export async function serve({
  build,
  clientDirectory,
  siteUrl,
  port,
  host
}: {
  build: ServerBuild;
  clientDirectory: string;
  /** Where the deployment says this app lives. */
  siteUrl?: string;
  port?: number;
  host?: string;
}) {
  const handler = createRequestHandler(
    {
      ...build,
      allowedActionOrigins: [
        ...(Array.isArray(build.allowedActionOrigins)
          ? build.allowedActionOrigins
          : []),
        ...allowedActionOrigins(siteUrl)
      ]
    },
    process.env.NODE_ENV
  );
  const app = await createApp({
    clientDirectory,
    handleRequest: (request) =>
      // @ts-expect-error RouterContextProvider matches runtime loadContext; types drift vs AppLoadContext
      handler(request, new RouterContextProvider())
  });

  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.once(signal, () => {
      app.close().finally(() => process.exit(0));
    });
  }

  const address = await app.listen({
    port: port ?? Number(process.env.PORT ?? 3000),
    host: host ?? process.env.HOST ?? "0.0.0.0"
  });
  console.log(`[carbon] ${address}`);
  return app;
}
