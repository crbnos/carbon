// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The server a self-hosted app runs on. `node` runs these files as they
// are, by stripping the types: the runtime image has no TypeScript
// toolchain. So only syntax that can be erased, `import type` for types,
// and `.ts` on relative imports.
//
// It replaces `react-router-serve`, which loads the build itself and leaves
// no place to stand between a request and React Router. Two things need
// that place: the app's own URL as an origin React Router accepts
// (`allowedActionOrigins`), and files sent as the build compressed them
// (`assets.ts`).

import path from "node:path";
import { constants } from "node:zlib";
import fastifyCompress from "@fastify/compress";
import fastifyStatic from "@fastify/static";
import closeWithGrace from "close-with-grace";
import Fastify, {
  type FastifyError,
  type FastifyReply,
  type FastifyRequest,
  type FastifyServerOptions,
  LogController
} from "fastify";
import Negotiator from "negotiator";
import {
  createRequestHandler,
  RouterContextProvider,
  type ServerBuild
} from "react-router";
import { type Asset, cacheControl, loadAssets } from "./assets.ts";
import { toFetchRequest } from "./request.ts";

// Longer than any proxy in front holds an idle connection (an ALB 60s,
// Traefik 90s). Shorter, and the proxy reuses a connection this side has
// just closed: an occasional 502 on a request that was never read.
const KEEP_ALIVE_MS = 100_000;
// Node's own limit on how long a request may take to arrive, which Fastify
// turns off. Without it a client that never finishes sending holds its
// connection for good.
const REQUEST_MS = 300_000;
// How long a shutdown waits for requests in flight: under the thirty
// seconds Kubernetes and ECS wait before they kill the process.
const SHUTDOWN_MS = 20_000;

const PLAIN = "text/plain; charset=utf-8";

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

/** The server, not yet listening — which is what a test wants. */
export async function createApp({
  handleRequest,
  clientDirectory,
  logger = { level: "info" }
}: {
  /** Everything that is not a file: React Router, usually. */
  handleRequest: (request: Request) => Promise<Response> | Response;
  /** The built client, served at `/`. */
  clientDirectory: string;
  logger?: FastifyServerOptions["logger"];
}) {
  const root = path.resolve(clientDirectory);
  const assets = loadAssets(root);

  const app = Fastify({
    logger,
    // The apps log their own requests, with the request id.
    logController: new LogController({ disableRequestLogging: true }),
    keepAliveTimeout: KEEP_ALIVE_MS,
    requestTimeout: REQUEST_MS,
    // A URL the router cannot decode. Fastify's own answer names its
    // error code.
    frameworkErrors: (_error, _req, reply) =>
      (reply as FastifyReply).code(400).type(PLAIN).send("Bad Request")
  });

  // Bodies are React Router's to read. Parsed here, the stream it is
  // handed would already be empty.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", (_req, _payload, done) => done(null));

  // For what is rendered per request; a file compressed at build carries
  // its encoding and is left alone. Flushed as it is written: React
  // streams a page in pieces, and a compressor waiting for a full buffer
  // holds the first of them back.
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

  // For the files left on disk: `reply.sendFile`, which answers ranges.
  // It serves nothing by itself — left to find files, it lists their
  // directory on every request.
  await app.register(fastifyStatic, {
    root,
    serve: false,
    cacheControl: false,
    setHeaders: (reply, file) => {
      reply.header("cache-control", cacheControl(path.relative(root, file)));
    }
  });

  function held(req: FastifyRequest, reply: FastifyReply, asset: Asset) {
    reply.headers(asset.headers);
    if (req.headers["if-none-match"] === asset.headers.etag) {
      return reply.code(304).send();
    }
    if (req.method === "HEAD") {
      return reply.header("content-length", asset.body.length).send();
    }
    return reply.send(asset.body);
  }

  /** The file `name`, sent; or nothing when there is no such file. */
  function file(req: FastifyRequest, reply: FastifyReply, name: string) {
    const asset = assets.get(name);
    if (!asset) return undefined;
    // Every browser accepts Brotli; a monitor or a script may not, and
    // `br;q=0` is one saying so.
    if (asset.brotli) {
      const [accepted] = new Negotiator(req.raw).encodings(["br"]);
      if (accepted === "br") return held(req, reply, asset.brotli);
      // Which copy is sent depends on the caller: a cache in between has
      // to know that of this one too.
      reply.header("vary", "Accept-Encoding");
    }
    return asset.plain ? held(req, reply, asset.plain) : reply.sendFile(name);
  }

  // A chunk from before the last deploy, or Vercel's analytics script off
  // Vercel. There is no page for these, and rendering the app's 404 for
  // each cost a pass through React Router.
  const gone = (reply: FastifyReply) =>
    reply
      .code(404)
      .header("cache-control", "no-store")
      .type(PLAIN)
      .send("Not found");

  type Path = { Params: { "*": string } };

  app.route<Path>({
    method: ["GET", "HEAD"],
    url: "/assets/*",
    handler: (req, reply) =>
      file(req, reply, `assets/${req.params["*"]}`) ?? gone(reply)
  });

  app.route({
    method: ["GET", "HEAD"],
    url: "/_vercel/*",
    handler: (_req, reply) => gone(reply)
  });

  // A route, not the not-found handler: compression attaches to routes.
  app.all<Path>("/*", async (req, reply) => {
    if (req.method === "GET" || req.method === "HEAD") {
      const sent = file(req, reply, req.params["*"]);
      if (sent) return sent;
    }

    // Stops the render when the browser goes away.
    const controller = new AbortController();
    reply.raw.once("close", () => {
      if (!reply.raw.writableFinished) controller.abort();
    });
    const response = await handleRequest(
      toFetchRequest(req.raw, controller.signal)
    );
    // The stock server named the charset on text handed to it without one.
    const type = response.headers.get("content-type");
    if (type?.startsWith("text/") && !type.includes(";")) {
      response.headers.set("content-type", `${type}; charset=utf-8`);
    }
    return reply.send(response);
  });

  // What failed is for the log. Fastify's own answer hands the caller the
  // error's message.
  app.setErrorHandler((error: FastifyError, req, reply) => {
    const status = error.statusCode ?? 500;
    if (status < 500) return reply.code(status).type(PLAIN).send("Bad Request");
    req.log.error({ err: error }, "request failed");
    return reply.code(500).type(PLAIN).send("Internal Server Error");
  });

  return app;
}

/** Starts a built React Router app. */
export async function serve({
  build,
  clientDirectory,
  siteUrl,
  port = Number(process.env.PORT ?? 3000),
  host = process.env.HOST ?? "0.0.0.0"
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

  // On a signal, or an error nothing caught: stop taking requests, let
  // those in flight finish, exit.
  closeWithGrace({ delay: SHUTDOWN_MS }, async ({ err }) => {
    if (err) app.log.error({ err }, "shutting down after an error");
    await app.close();
  });

  await app.listen({ port, host });
  return app;
}
