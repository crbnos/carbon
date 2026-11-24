// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The real base, converter and schema builders over one tiny inline procedure, so
// the spec can be generated from it alone; the last tests run real built procedures.

import type { ManifestEntry } from "@carbon/api";
import { CarbonJsonSchemaConverter, jsonSchema } from "@carbon/api/schema";
import { OpenAPIGenerator } from "@orpc/openapi";
import { call, type ORPCError } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { type AuthedContext, base } from "./base.server";
import { outputSchema, shapeHttpBody } from "./operations.server";
import { buildProcedure } from "./router.server";
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

  it("names the failing fields when a real procedure rejects its input", async () => {
    const procedure = buildProcedure(
      meta({
        schema: {
          type: "object",
          properties: {
            name: { type: "string" },
            quantity: { type: "number" }
          },
          required: ["name"]
        }
      })
    );

    const err: any = await call(
      procedure,
      { quantity: "three" },
      { context: {} as AuthedContext }
    ).catch((e) => e);

    expect(err.message).toBe(
      "Input validation failed — name: Invalid input: expected string, received undefined; quantity: Invalid input: expected number, received string"
    );
    expect(err.data.fields).toEqual(["name", "quantity"]);
    expect(err.data.category).toBe("validation");
  });

  // A real published read whose database call fails as `client` makes it fail.
  async function unitsOfMeasureFailing(
    cause: unknown,
    input: object = {}
  ): Promise<ORPCError<string, any>> {
    const procedure = buildProcedure(
      meta({
        name: "items_getUnitOfMeasuresList",
        module: "items",
        serviceFn: { path: ["items", "getUnitOfMeasuresList"] },
        schema: { type: "object" }
      })
    );
    const client = {
      from() {
        throw cause;
      }
    } as unknown as AuthedContext["client"];
    return call(procedure, input, {
      context: {
        client,
        userId: "u1",
        companyId: "c1",
        companyGroupId: "g1",
        authKind: "api-key",
        permissions: {
          "parts.units": { view: ["c1"], create: [], update: [], delete: [] }
        },
        role: null
      }
    }).then(
      () => {
        throw new Error("expected the call to fail");
      },
      (e: ORPCError<string, any>) => e
    );
  }

  it("sends an internal error's category and nothing of its cause", async () => {
    const err = await unitsOfMeasureFailing(
      new Error("connect ECONNREFUSED 10.0.0.5:5432")
    );

    expect(err.status).toBe(500);
    expect(err.message).toBe("Something went wrong");
    expect(err.toJSON().data).toEqual({ category: "internal" });
  });

  it("sends a refusal's reason and the field it names", async () => {
    const duplicate = Object.assign(
      new Error(
        'duplicate key value violates unique constraint "unitOfMeasure_code_key"'
      ),
      {
        code: "23505",
        detail: 'Key ("companyId", code)=(c1, EA) already exists.'
      }
    );

    const err = await unitsOfMeasureFailing(duplicate, { code: "EA" });

    expect(err.status).toBe(409);
    expect(err.toJSON().data).toEqual({
      category: "conflict",
      title: 'A record with this "code" already exists.',
      reason: { code: "duplicate", values: { columns: '"code"', value: "EA" } },
      fields: ["code"],
      field: "code",
      value: "EA"
    });
  });
});
