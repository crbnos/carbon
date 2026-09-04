// Validates the oRPC wiring the Carbon API v1 surface depends on, without booting the
// app: a runtime-built router of procedures, the OpenAPIHandler matching a prefixed
// POST path, server-side call(), the scope gate, and the custom JSON-Schema converter
// feeding OpenAPIGenerator. Uses the REAL base/gate/jsonSchema/converter with tiny
// inline handlers (so it never pulls the full service registry).

import type { ManifestEntry } from "@carbon/api";
import { CarbonJsonSchemaConverter, jsonSchema } from "@carbon/api/schema";
import { OpenAPIGenerator } from "@orpc/openapi";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { call } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { type AuthedContext, base, gate } from "./base.server";

const PREFIX = "/api/v1";

function meta(overrides: Partial<ManifestEntry>): ManifestEntry {
  return {
    name: "demo_ping",
    module: "demo",
    classification: "READ",
    description: "demo ping",
    paramCount: 1,
    serviceParams: ["client", "args"],
    injectAuth: [],
    permission: { module: null, actions: [] },
    schema: { type: "object", properties: { name: { type: "string" } } },
    ...overrides
  };
}

const ping = base
  .use(gate(meta({})))
  .route({
    method: "POST",
    path: "/demo/ping",
    tags: ["demo"],
    summary: "demo ping"
  })
  .input(
    jsonSchema({ type: "object", properties: { name: { type: "string" } } })
  )
  .handler(({ input }) => ({ data: input }));

const gatedMeta = meta({
  name: "parts_getParts",
  module: "parts",
  permission: { module: "parts", actions: ["view"] }
});
const gated = base
  .use(gate(gatedMeta))
  .route({ method: "POST", path: "/parts/getParts", summary: "gated" })
  .input(jsonSchema({ type: "object", properties: {} }))
  .handler(() => ({ data: "ok" }));

const router = { demo: { ping }, parts: { getParts: gated } };
const handler = new OpenAPIHandler(router);

function ctx(overrides: Partial<AuthedContext> = {}): AuthedContext {
  return {
    client: {} as AuthedContext["client"],
    userId: "u1",
    companyId: "c1",
    companyGroupId: "g1",
    authKind: "oauth",
    scopes: {},
    ...overrides
  };
}

describe("oRPC mechanics for the Carbon API v1 surface", () => {
  it("matches a prefixed POST path and returns the handler result over HTTP", async () => {
    const request = new Request(`https://x.test${PREFIX}/demo/ping`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "hello" })
    });
    const { matched, response } = await handler.handle(request, {
      prefix: PREFIX,
      context: ctx()
    });
    expect(matched).toBe(true);
    expect(response?.status).toBe(200);
    const body = (await response?.json()) as { data?: { name?: string } };
    expect(body.data?.name).toBe("hello");
  });

  it("does not match an unknown operation path", async () => {
    const request = new Request(`https://x.test${PREFIX}/demo/nope`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    const { matched } = await handler.handle(request, {
      prefix: PREFIX,
      context: ctx()
    });
    expect(matched).toBe(false);
  });

  it("runs the middleware chain via server-side call()", async () => {
    const result = await call(
      router.demo.ping,
      { name: "y" },
      { context: ctx() }
    );
    expect(result).toEqual({ data: { name: "y" } });
  });

  it("403s an API-key caller missing the required scope", async () => {
    const request = new Request(`https://x.test${PREFIX}/parts/getParts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    const { matched, response } = await handler.handle(request, {
      prefix: PREFIX,
      context: ctx({ authKind: "api-key", scopes: {} })
    });
    expect(matched).toBe(true);
    expect(response?.status).toBe(403);
  });

  it("allows an API-key caller holding the scope for the active company", async () => {
    const result = await call(
      router.parts.getParts,
      {},
      { context: ctx({ authKind: "api-key", scopes: { parts_view: ["c1"] } }) }
    );
    expect(result).toEqual({ data: "ok" });
  });

  it("skips the scope gate for oauth (connector) callers", async () => {
    const result = await call(
      router.parts.getParts,
      {},
      { context: ctx({ authKind: "oauth" }) }
    );
    expect(result).toEqual({ data: "ok" });
  });

  it("emits the precomputed JSON Schema into the OpenAPI spec via the custom converter", async () => {
    const generator = new OpenAPIGenerator({
      schemaConverters: [new CarbonJsonSchemaConverter()]
    });
    const spec = (await generator.generate(router, {
      info: { title: "Carbon API", version: "1.0.0" }
    })) as {
      paths?: Record<string, unknown>;
    };
    expect(Object.keys(spec.paths ?? {})).toContain("/demo/ping");
  });
});
