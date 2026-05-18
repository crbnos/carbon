import { describe, expect, it } from "vitest";
import { z } from "zod";
import { mcpTool } from "./mcpTool";
import { McpToolRegistry } from "./registry";
import { MCP_TOOL_ANNOTATION, type McpToolAnnotation } from "./types";

describe("mcpTool (tagger)", () => {
  it("tags the function with its (normalized) slim annotation via a non-enumerable symbol", () => {
    const annotation: McpToolAnnotation = {
      classification: "READ",
      description: "do the thing",
      injectAuth: ["companyId"],
      paramSchema: z.unknown()
    };
    const fn = mcpTool(
      annotation,
      async function doThing(_client: unknown, _id: string) {
        return null;
      }
    );

    const tag = (fn as unknown as Record<symbol, unknown>)[
      MCP_TOOL_ANNOTATION
    ] as McpToolAnnotation;
    // The wrapper normalizes (resolves `schema` alias, defaults the schema),
    // so it stores a copy, not the caller's object. The human-authored
    // fields must survive verbatim and the schema must be populated.
    expect(tag).not.toBe(annotation);
    expect(tag.classification).toBe("READ");
    expect(tag.description).toBe("do the thing");
    expect(tag.injectAuth).toEqual(["companyId"]);
    expect(tag.paramSchema).toBeDefined();
    expect(Object.keys(fn)).not.toContain(
      MCP_TOOL_ANNOTATION as unknown as string
    );
    expect(fn.name).toBe("doThing");
  });

  it("defaults schema to z.unknown() when the annotation omits it", () => {
    const fn = mcpTool(
      { classification: "READ" },
      async function minimal(_client: unknown) {
        return null;
      }
    );
    const tag = (fn as unknown as Record<symbol, unknown>)[
      MCP_TOOL_ANNOTATION
    ] as McpToolAnnotation;
    expect(tag.paramSchema).toBeDefined();
    // A z.unknown() schema accepts anything.
    expect(tag.paramSchema!.safeParse({ any: "thing" }).success).toBe(true);
  });

  it("resolves the `schema` alias into paramSchema", () => {
    const realSchema = z.object({ name: z.string() });
    const fn = mcpTool(
      { classification: "WRITE", schema: realSchema },
      async function withSchema(_client: unknown, _p: unknown) {
        return null;
      }
    );
    const tag = (fn as unknown as Record<symbol, unknown>)[
      MCP_TOOL_ANNOTATION
    ] as McpToolAnnotation;
    expect(tag.paramSchema).toBe(realSchema);
    expect(tag.paramSchema!.safeParse({}).success).toBe(false);
  });

  it("does not register eagerly — registry stays empty until registerParsed runs", () => {
    const registry = new McpToolRegistry({ warn: () => undefined });
    mcpTool(
      {
        classification: "READ",
        description: "x",
        injectAuth: [],
        paramSchema: z.unknown()
      },
      async function neverRegistered(_client: unknown) {
        return null;
      }
    );
    expect(registry.size()).toBe(0);
  });
});

describe("registry.registerParsed", () => {
  it("merges the SLIM symbol-tagged annotation with build-derived parsed metadata", async () => {
    const registry = new McpToolRegistry({ warn: () => undefined });
    // Models the real runtime contract: the annotation literal is slim
    // (classification only). `description` and the resolved identity set
    // are derived by the manifest generator and travel via McpToolParsed —
    // NOT via the runtime annotation. Regression guard for the bug where
    // registerParsed spread a slim annotation and left description
    // undefined / dropped identity injection on every tool.
    const fn = mcpTool(
      { classification: "READ" },
      async function getWidget(_client: unknown, _id: string) {
        return { ok: true };
      }
    );
    registry.registerParsed(fn, {
      module: "widgets",
      name: "getWidget",
      argOrder: ["client", "id"],
      description: "get widget",
      inject: [{ as: "companyId" }]
    });
    const tool = registry.get("widgets_getWidget");
    expect(tool).toBeDefined();
    expect(tool!.module).toBe("widgets");
    expect(tool!.name).toBe("getWidget");
    expect(tool!.argOrder).toEqual(["client", "id"]);
    expect(tool!.classification).toBe("READ");
    expect(tool!.description).toBe("get widget");
    expect(tool!.auth.companyId).toBe(true);
  });

  it("throws when the function lacks the annotation tag", () => {
    const registry = new McpToolRegistry({ warn: () => undefined });
    const bareFn = async function bare(_client: unknown) {
      return null;
    };
    expect(() =>
      registry.registerParsed(bareFn, {
        module: "x",
        name: "bare",
        argOrder: ["client"],
        description: "bare",
        inject: []
      })
    ).toThrow(/missing its annotation tag/);
  });
});
