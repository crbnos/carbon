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
import { outputSchema, shapeHttpBody } from "./operations.server";
import { specOptions } from "./spec-options.server";

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
    paginates: false,
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
  .output(
    jsonSchema(
      // The REAL schema builder, with a list-shaped response — pins that the
      // converter carries the current { results, count } envelope into the spec.
      outputSchema(
        meta({
          responseSchema: {
            type: "array",
            items: { type: "object", properties: { id: { type: "string" } } }
          }
        })
      )
    )
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

  it("emits the response schema into the spec's 200 body", async () => {
    // Every procedure carries an `.output()`; for lists that is the
    // `{ results, count }` envelope wrapping the schema reflected from the
    // service's return type. Without the converter reaching the output side, the
    // spec documents requests only — which is what it did before responses existed.
    const generator = new OpenAPIGenerator({
      schemaConverters: [new CarbonJsonSchemaConverter()]
    });
    const spec = (await generator.generate(router, {
      info: { title: "Carbon API", version: "1.0.0" }
    })) as any;

    const body =
      spec.paths["/demo/ping"].post.responses["200"].content["application/json"]
        .schema;
    expect(body.properties.results.items.properties.id).toEqual({
      type: "string"
    });
    expect(body.properties.count.type).toEqual(["number", "null"]);
    expect(body.required).toContain("results");
  });

  it("returns single results bare and lists in the { results, count } envelope", () => {
    // Wrapping everything stacked our envelope under every generated client's own
    // result wrapper (`res.data.data.field`). Single results are now the body
    // itself; only lists carry the envelope, because `count` means something
    // there. If either assertion fails, the published schema and the runtime
    // shaping in buildProcedure's handler must change TOGETHER — both key off
    // isListOperation.
    const single = meta({
      responseSchema: { type: "object", properties: { id: { type: "string" } } }
    });
    expect(outputSchema(single)).toEqual({
      type: "object",
      properties: { id: { type: "string" } }
    });

    const list = meta({
      responseSchema: { type: "array", items: { type: "object" } }
    });
    const wrapped = outputSchema(list) as any;
    expect(wrapped.properties.results.type).toBe("array");
    expect(wrapped.properties.count.type).toEqual(["number", "null"]);
    expect(wrapped.required).toEqual(["results"]);

    // No reflected schema → bare and unconstrained, never a phantom envelope.
    expect(outputSchema(meta({ responseSchema: undefined }))).toEqual({});

    // The runtime shaping keys off the SAME bit, so it cannot disagree.
    expect(shapeHttpBody(single, { data: { id: "x" } })).toEqual({ id: "x" });
    expect(shapeHttpBody(list, { data: [1], count: 7 })).toEqual({
      results: [1],
      count: 7
    });
    expect(shapeHttpBody(list, { data: [] })).toEqual({
      results: [],
      count: null
    });
  });

  it("declares exactly ONE auth scheme: Bearer", async () => {
    // The server also accepts the internal `carbon-key` header as a compat alias
    // (authenticate.server.ts), but the spec documents the ONE recommended way so
    // every generated SDK has a single auth story. Adding a second scheme here
    // would hand "either way" to every client generator — if that ever seems
    // desirable again, it was tried and unified away on purpose.
    const generator = new OpenAPIGenerator({
      schemaConverters: [new CarbonJsonSchemaConverter()]
    });
    const spec = (await generator.generate(router, specOptions())) as any;

    expect(Object.keys(spec.components.securitySchemes)).toEqual([
      "bearerAuth"
    ]);
    expect(spec.components.securitySchemes.bearerAuth).toMatchObject({
      type: "http",
      scheme: "bearer"
    });
    expect(spec.security).toEqual([{ bearerAuth: [] }]);
  });
});
