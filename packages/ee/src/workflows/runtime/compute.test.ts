import { describe, expect, it } from "vitest";
import { createFixtureCatalog } from "../definition/catalog";
import type { ComputeNode } from "../definition/schema";
import { computeExecutor } from "./compute";
import { createRuntimeContext } from "./fixtures";
import type { RuntimeValue, WorkflowServices } from "./types";
import { entityValue, primitiveValue } from "./values";

const catalog = createFixtureCatalog();

const jobRef = {
  kind: "ref" as const,
  nodeId: "trigger",
  output: "record",
  path: []
};

const node = (
  operation = "job.totalScrap",
  inputs: ComputeNode["data"]["inputs"] = { job: jobRef }
): ComputeNode => ({
  id: "scrap",
  name: "scrap",
  type: "compute",
  position: { x: 0, y: 0 },
  data: { operation, inputs }
});

const contextWith = (runOperation: WorkflowServices["runOperation"]) =>
  createRuntimeContext({
    outputs: { trigger: { record: entityValue("job", "j1") } },
    services: { runOperation }
  });

const unreachable: WorkflowServices["runOperation"] = async () => {
  throw new Error("the service should not have been called");
};

describe("computeExecutor", () => {
  it("puts the operation's value on `result` and follows the out handle", async () => {
    const calls: Array<[string, Record<string, RuntimeValue>]> = [];
    const ctx = contextWith(async (operationId, inputs) => {
      calls.push([operationId, inputs]);
      return { ok: true, value: primitiveValue("number", 12) };
    });

    expect(await computeExecutor.execute(node(), ctx)).toEqual({
      status: "Succeeded",
      outputs: { result: primitiveValue("number", 12) },
      handle: "out"
    });
    expect(calls).toEqual([
      ["job.totalScrap", { job: entityValue("job", "j1") }]
    ]);
  });

  it("skips with the resolver's own reason when an input cannot be resolved", async () => {
    const result = await computeExecutor.execute(
      node("job.totalScrap", {
        job: { kind: "ref", nodeId: "gone", output: "result", path: [] }
      }),
      contextWith(unreachable)
    );
    expect(result).toEqual({
      status: "Skipped",
      reason: "The step that produces this value did not run."
    });
  });

  it("fails with the service's error", async () => {
    const result = await computeExecutor.execute(
      node(),
      contextWith(async () => ({
        ok: false,
        error: "The owner of this workflow no longer has access to Production."
      }))
    );
    expect(result).toEqual({
      status: "Failed",
      error: "The owner of this workflow no longer has access to Production."
    });
  });

  it("reports the operation's declared permission", () => {
    expect(computeExecutor.permission(node(), catalog)).toEqual({
      module: "production",
      action: "view"
    });
    expect(
      computeExecutor.permission(node("job.gone"), catalog)
    ).toBeUndefined();
  });

  it("skips when the operation is no longer in the catalog", async () => {
    const result = await computeExecutor.execute(
      node("job.gone"),
      contextWith(unreachable)
    );
    expect(result).toEqual({
      status: "Skipped",
      reason: "This calculation is no longer available."
    });
  });
});
