// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The real base, converter and schema builders over one tiny inline procedure, so
// the spec can be generated without the full service registry.

import type { ManifestEntry } from "@carbon/api";
import { CarbonJsonSchemaConverter, jsonSchema } from "@carbon/api/schema";
import { OpenAPIGenerator } from "@orpc/openapi";
import { describe, expect, it } from "vitest";
import { base, scopesFromPermissions } from "./base.server";
import { outputSchema, shapeHttpBody } from "./operations.server";
import { specOptions, withErrorResponses } from "./spec-options.server";

function meta(overrides: Partial<ManifestEntry>): ManifestEntry {
  return {
    name: "demo_ping",
    module: "demo",
    classification: "READ",
    description: "demo ping",
    permission: { module: null, actions: [] },
    paginates: false,
    serviceFn: { path: ["demo", "ping"] },
    schema: { type: "object", properties: { name: { type: "string" } } },
    ...overrides
  };
}

const ping = base
  .route({ method: "POST", path: "/demo/ping", tags: ["demo"] })
  .input(
    jsonSchema({ type: "object", properties: { name: { type: "string" } } })
  )
  .output(
    jsonSchema(
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

const router = { demo: { ping } };

async function generateSpec(): Promise<any> {
  const generator = new OpenAPIGenerator({
    schemaConverters: [new CarbonJsonSchemaConverter()]
  });
  return generator.generate(router, specOptions());
}

describe("Carbon API v1 spec and response shaping", () => {
  it("scopes an OAuth caller to the token's company only", () => {
    const none = { create: [], update: [], delete: [] };
    expect(
      scopesFromPermissions(
        {
          parts: { view: ["c1", "c2"], ...none },
          sales: { view: ["c2"], ...none }
        },
        "c1"
      )
    ).toEqual({ parts_view: ["c1"] });
  });

  it("emits a list's { results, count } envelope as the 200 body", async () => {
    const spec = await generateSpec();

    const body =
      spec.paths["/demo/ping"].post.responses["200"].content["application/json"]
        .schema;
    expect(body.properties.results.items.properties.id).toEqual({
      type: "string"
    });
    expect(body.properties.count.type).toEqual(["number", "null"]);
    expect(body.required).toContain("results");
  });

  it("documents every refusal beside the 200 body", async () => {
    const spec = withErrorResponses(await generateSpec()) as any;
    const responses = spec.paths["/demo/ping"].post.responses;

    expect(Object.keys(responses)).toEqual(
      expect.arrayContaining([
        "200",
        "400",
        "401",
        "403",
        "404",
        "422",
        "429",
        "500"
      ])
    );
    expect(responses["404"].content["application/json"].schema).toEqual({
      $ref: "#/components/schemas/Error"
    });
    expect(responses["401"].content["text/plain"]).toBeDefined();
    expect(spec.components.schemas.Error.required).toEqual([
      "code",
      "status",
      "message"
    ]);
  });

  it("returns single results bare and lists in the { results, count } envelope", () => {
    // Schema and runtime shaping both key off isListOperation; they must agree.
    const single = meta({
      responseSchema: { type: "object", properties: { id: { type: "string" } } }
    });
    const list = meta({
      responseSchema: { type: "array", items: { type: "object" } }
    });

    expect(outputSchema(single)).toEqual({
      type: "object",
      properties: { id: { type: "string" } }
    });
    const wrapped = outputSchema(list) as any;
    expect(wrapped.properties.results.type).toBe("array");
    expect(wrapped.properties.count.type).toEqual(["number", "null"]);
    expect(wrapped.required).toEqual(["results"]);
    expect(outputSchema(meta({ responseSchema: undefined }))).toEqual({});

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

  it("declares Bearer as the only auth scheme", async () => {
    // The carbon-key header is a compat alias; generated SDKs get one auth story.
    const spec = await generateSpec();

    expect(spec.components.securitySchemes).toEqual({
      bearerAuth: expect.objectContaining({ type: "http", scheme: "bearer" })
    });
    expect(spec.security).toEqual([{ bearerAuth: [] }]);
  });
});
