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
  permission: { "production.jobs": "Edit" },
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
  permission: { "production.jobs": "Edit", "inventory.quantities": "Edit" },
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
    // A level lists every action it holds; a gate of one page names it.
    expect(cancel?.permission).toEqual({
      module: "production",
      page: "production.jobs",
      actions: ["view", "create", "update"]
    });
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
  permission: { "production.jobs": "View" },
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
  permission: { "production.jobs": "View" },
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
    expect(() => read(`{ "settings.apiKeys": "Edit" }`)).toThrow(
      "@mcp read on a function whose permission names create, update"
    );
    expect(read(`{ "settings.apiKeys": "View" }`)[0]?.classification).toBe(
      "READ"
    );
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
  permission: { "production.jobs": "View" },
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
const recostPermission = { "accounting.reporting": "Edit" } as const;
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
    expect(recost?.permission).toEqual({
      module: "accounting",
      page: "accounting.reporting",
      actions: ["view", "create", "update"]
    });
  });

  const published = (permission: string) =>
    toolsFor({
      "/m/production.ts": `
import { defineServiceFn } from "./helper";
/**
 * Post a run.
 *
 * @mcp
 */
export const postRun = defineServiceFn({
  input: null,
  permission: ${permission},
  async run(_ctx, input: { type: string }) {
    return null;
  }
});`,
      "/m/router.ts": ROUTER
    });

  it("refuses a page the registry does not have, and a level that is not one", () => {
    expect(() => published(`{ production: "Edit" }`)).toThrow(
      "permission names a page of the registry"
    );
    expect(() => published(`{ update: "production" }`)).toThrow(
      "permission names a page of the registry"
    );
    expect(() => published(`{ "production.jobs": "update" }`)).toThrow(
      "permission.production.jobs must be one of View, Create, Edit, Full"
    );
    expect(() => published(`{ "production.jobs": "None" }`)).toThrow(
      "must be one of View, Create, Edit, Full"
    );
  });

  it("publishes a keyed rule as every page and action its rules name", () => {
    const [run] = published(
      `{ by: "type", rules: { revenue: { "accounting.revenueRecognition": "Create" }, lease: { "accounting.leases": "Edit" } } }`
    );
    expect(run?.permission).toEqual({
      module: "accounting",
      actions: ["view", "create", "update"]
    });
    const [split] = published(
      `{ by: "type", rules: { a: { "accounting.leases": "View" }, b: { "sales.quotes": "View" } } }`
    );
    expect(split?.permission).toEqual({ module: null, actions: [] });
    expect(() =>
      published(`{ by: "type", rules: { a: "system" } }`)
    ).toThrow("a published keyed permission names a literal page gate");
  });

  // A row rule comes from a helper call: the reader takes the pages from
  // the call's TYPE, as `rowRule` (`@carbon/api/permissions`) types it.
  const ITEM_RULE = `
declare function itemRule<const L extends string>(level: L): {
  row: {
    id: "itemId";
    from: string;
    cases: { column: string; then: { "parts.tools": L } | { "parts.parts": L } }[];
  };
};`;

  it("publishes a row rule as one of its pages, and what picks it", () => {
    const [run] = toolsFor({
      "/m/production.ts": `
import { defineServiceFn } from "./helper";
${ITEM_RULE}
/**
 * Set a cost.
 *
 * @mcp
 */
export const setCost = defineServiceFn({
  input: null,
  permission: itemRule("Edit"),
  async run(_ctx, input: { itemId: string }) {
    return null;
  }
});`,
      "/m/router.ts": ROUTER
    });
    expect(run?.permission).toEqual({
      module: "parts",
      actions: ["view", "create", "update"],
      oneOf: {
        pages: ["parts.parts", "parts.tools"],
        level: "Edit",
        by: ["item.type"]
      }
    });
    expect(run?.classification).toBe("WRITE");
  });

  it("publishes an anyOf rule as one of its pages, picked by nothing", () => {
    const [list] = published(
      `{ anyOf: [{ "parts.tools": "View" }, { "parts.parts": "View" }] } as const`
    );
    expect(list?.permission).toEqual({
      module: "parts",
      actions: ["view"],
      oneOf: { pages: ["parts.parts", "parts.tools"], level: "View", by: [] }
    });
    expect(list?.classification).toBe("READ");
  });

  it("refuses an anyOf rule whose pages have different levels", () => {
    expect(() =>
      published(
        `{ anyOf: [{ "parts.tools": "View" }, { "parts.parts": "Edit" }] } as const`
      )
    ).toThrow("a published anyOf rule names its pages at one level");
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
