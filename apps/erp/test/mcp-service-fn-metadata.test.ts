// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Project } from "ts-morph";
import { describe, expect, it } from "vitest";
import { buildServiceFnTools } from "../../../scripts/lib/service-fn-metadata";

// A stand-in for defineServiceFn: the reader keys on the call's name and reads
// the schemas from the leaf's TYPE, so only the signature matters here.
const HELPER = `
type Result<T> = { data: T; error: null } | { data: null; error: { message: string } };
export declare function defineServiceFn<I, R>(definition: {
  input: unknown;
  permission: unknown;
  run(ctx: unknown, input: I): Promise<R>;
}): (ctx: unknown, input: I) => Promise<Result<R>>;
`;

function toolsFor(files: Record<string, string>) {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile("/m/helper.ts", HELPER);
  for (const [name, text] of Object.entries(files)) {
    project.createSourceFile(name, text);
  }
  return buildServiceFnTools(project, "/m/router.ts");
}

const PRODUCTION = `
import { defineServiceFn } from "./helper";

/**
 * Cancel a job.
 *
 * @remarks
 * Returns the picked material first.
 *
 * @mcp
 */
export const cancelJob = defineServiceFn({
  input: null,
  permission: { update: "production" },
  async run(_ctx, input: { jobId: string; reason?: string }) {
    return { jobId: input.jobId };
  }
});

/**
 * Delete a job.
 *
 * @mcp destructive
 */
export const deleteJob = defineServiceFn({
  input: null,
  permission: { update: ["production", "inventory"] },
  async run(_ctx, input: { jobId: string }) {
    return null;
  }
});

/** Re-plan an item. Not published. */
export const replan = defineServiceFn({
  input: null,
  permission: "system",
  async run(_ctx, input: { itemId: string }) {
    return null;
  }
});
`;

const ROUTER = `
import * as production from "./production";
export const router = { production };
`;

describe("buildServiceFnTools", () => {
  const tools = toolsFor({ "/m/production.ts": PRODUCTION, "/m/router.ts": ROUTER });
  const cancel = tools.find((tool) => tool.name === "production_cancelJob");

  it("publishes only the leaves tagged @mcp, named module_function", () => {
    expect(tools.map((tool) => tool.name)).toEqual([
      "production_cancelJob",
      "production_deleteJob"
    ]);
    expect(cancel?.serviceFn).toEqual({ path: ["production", "cancelJob"] });
  });

  it("refuses a server file that exports anything but service functions", () => {
    expect(() =>
      toolsFor({
        "/m/production.ts": `${PRODUCTION}\nexport function helper() {}`,
        "/m/router.ts": ROUTER
      })
    ).toThrow(/export helper is not a defineServiceFn/);
  });

  it("takes the title from the summary and the description from @remarks", () => {
    expect(cancel?.title).toBe("Cancel a job");
    expect(cancel?.description).toBe(
      "Cancel a job.\n\nReturns the picked material first."
    );
  });

  it("reads the input from the type: optional fields are not required and not null", () => {
    expect(cancel?.schema).toEqual({
      type: "object",
      properties: { jobId: { type: "string" }, reason: { type: "string" } },
      required: ["jobId"]
    });
    expect(cancel?.responseSchema).toMatchObject({
      properties: { jobId: { type: "string" } }
    });
  });

  it("gates one module on the API and leaves several to the function", () => {
    expect(cancel?.permission).toEqual({ module: "production", actions: ["update"] });
    expect(cancel?.classification).toBe("WRITE");
    const remove = tools.find((tool) => tool.name === "production_deleteJob");
    expect(remove?.permission).toEqual({ module: null, actions: [] });
    expect(remove?.classification).toBe("DESTRUCTIVE");
  });

  it("publishes a paged result as a list the function pages", () => {
    const [jobs] = toolsFor({
      "/m/production.ts": `
import { defineServiceFn } from "./helper";
/**
 * List jobs.
 *
 * @mcp
 */
export const getJobs = defineServiceFn({
  input: null,
  permission: { view: "production" },
  async run(_ctx, input: { limit?: number }) {
    return { rows: [{ id: "j1" }], count: 1 as number | null };
  }
});`,
      "/m/router.ts": ROUTER
    });
    expect(jobs?.paginates).toBe(true);
    expect(jobs?.responseSchema).toMatchObject({
      type: "array",
      items: { properties: { id: { type: "string" } } }
    });
  });

  it("refuses a paged result whose rows are not a list", () => {
    expect(() =>
      toolsFor({
        "/m/production.ts": `
import { defineServiceFn } from "./helper";
/**
 * Count jobs.
 *
 * @mcp
 */
export const countJobs = defineServiceFn({
  input: null,
  permission: { view: "production" },
  async run(_ctx, input: { limit?: number }) {
    return { rows: { id: "j1" }, count: 1 as number | null };
  }
});`,
        "/m/router.ts": ROUTER
      })
    ).toThrow("a paged result's rows must be a list");
  });

  it("refuses @mcp read on a function whose permission names a write", () => {
    const read = (permission: string) =>
      toolsFor({
        "/m/production.ts": `
import { defineServiceFn } from "./helper";
/**
 * Get API keys.
 *
 * @mcp read
 */
export const getKeys = defineServiceFn({
  input: null,
  permission: ${permission},
  async run(_ctx, input: { id: string }) {
    return null;
  }
});`,
        "/m/router.ts": ROUTER
      });
    expect(() => read(`{ update: "users" }`)).toThrow(
      "@mcp read on a function whose permission names update"
    );
    expect(read(`{ view: "users" }`)[0]?.classification).toBe("READ");
  });

  it("refuses a summary that was cut off", () => {
    const tool = (summary: string) =>
      toolsFor({
        "/m/production.ts": `
import { defineServiceFn } from "./helper";
/**
 * ${summary}
 *
 * @mcp read
 */
export const getJob = defineServiceFn({
  input: null,
  permission: { view: "production" },
  async run(_ctx, input: { id: string }) {
    return null;
  }
});`,
        "/m/router.ts": ROUTER
      });
    expect(() => tool("Get the job and the operations it…")).toThrow(
      "the summary is cut off"
    );
    expect(() => tool("Get the job (with its `operations")).toThrow(
      "the summary is cut off"
    );
    expect(tool("Get the job (with its `operations`).")[0]?.title).toBe(
      "Get the job (with its `operations`)"
    );
  });

  it("reads a permission named by a constant", () => {
    const [recost] = toolsFor({
      "/m/production.ts": `
import { defineServiceFn } from "./helper";
const recostPermission = { update: "accounting" } as const;
/**
 * Recost a unit.
 *
 * @mcp
 */
export const recost = defineServiceFn({
  input: null,
  permission: recostPermission,
  async run(_ctx, input: { id: string }) {
    return null;
  }
});`,
      "/m/router.ts": ROUTER
    });
    expect(recost?.permission).toEqual({ module: "accounting", actions: ["update"] });
  });

  it("refuses to publish a system-only function", () => {
    const published = PRODUCTION.replace(
      "/** Re-plan an item. Not published. */",
      "/**\n * Re-plan an item.\n *\n * @mcp\n */"
    );
    expect(() =>
      toolsFor({ "/m/production.ts": published, "/m/router.ts": ROUTER })
    ).toThrow("names its permission");
  });
});
