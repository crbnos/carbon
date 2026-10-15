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
import { cancelJob, deleteJob, replan } from "./production";
const production = { job: { cancel: cancelJob, delete: deleteJob }, item: { replan } };
export const router = { production };
`;

describe("buildServiceFnTools", () => {
  const tools = toolsFor({ "/m/production.ts": PRODUCTION, "/m/router.ts": ROUTER });
  const cancel = tools.find((tool) => tool.name === "production_job_cancel");

  it("publishes only the leaves tagged @mcp, named by their router path", () => {
    expect(tools.map((tool) => tool.name)).toEqual([
      "production_job_cancel",
      "production_job_delete"
    ]);
    expect(cancel?.serviceFn).toEqual({ path: ["production", "job", "cancel"] });
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
    const remove = tools.find((tool) => tool.name === "production_job_delete");
    expect(remove?.permission).toEqual({ module: null, actions: [] });
    expect(remove?.classification).toBe("DESTRUCTIVE");
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
