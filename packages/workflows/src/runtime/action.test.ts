import { describe, expect, it } from "vitest";
import { createFixtureCatalog } from "../definition/catalog";
import type { ActionNode } from "../definition/schema";
import { t } from "../definition/types";
import { actionExecutor } from "./action";
import { createRuntimeContext } from "./fixtures";
import type { RuntimeValue, WorkflowServices } from "./types";
import { entityValue, listValue, primitiveValue } from "./values";

const catalog = createFixtureCatalog();

const title = {
  kind: "literal" as const,
  type: t.string,
  value: "Scrap is over budget"
};

const node = (
  action = "createIssue",
  inputs: ActionNode["data"]["inputs"] = { title }
): ActionNode => ({
  id: "act",
  name: "act",
  type: "action",
  position: { x: 0, y: 0 },
  data: { action, inputs }
});

const recipients = listValue({ kind: "entity", of: "user" }, [
  entityValue("user", "u1"),
  entityValue("user", "u2")
]).value;

const contextWith = (runAction: WorkflowServices["runAction"]) =>
  createRuntimeContext({
    outputs: { find: { result: recipients } },
    services: { runAction }
  });

const unreachable: WorkflowServices["runAction"] = async () => {
  throw new Error("the service should not have been called");
};

describe("actionExecutor", () => {
  it("returns the action's outputs and summary on the success handle", async () => {
    const result = await actionExecutor.execute(
      node(),
      contextWith(async () => ({
        ok: true,
        outputs: { issue: entityValue("issue", "i1") },
        summary: "Raised NCR-1."
      }))
    );
    expect(result).toEqual({
      status: "Succeeded",
      outputs: { issue: entityValue("issue", "i1") },
      handle: "success",
      summary: "Raised NCR-1."
    });
  });

  it("fails on the failure handle so a wired recovery path can run", async () => {
    const result = await actionExecutor.execute(
      node(),
      contextWith(async () => ({
        ok: false,
        error: "The issue could not be created."
      }))
    );
    expect(result).toEqual({
      status: "Failed",
      error: "The issue could not be created.",
      handle: "failure"
    });
  });

  it("skips with the resolver's own reason when an input cannot be resolved", async () => {
    const result = await actionExecutor.execute(
      node("createIssue", {
        title: { kind: "ref", nodeId: "gone", output: "result", path: [] }
      }),
      contextWith(unreachable)
    );
    expect(result).toEqual({
      status: "Skipped",
      reason: "The step that produces this value did not run."
    });
  });

  it("reports the action's declared permission", () => {
    expect(actionExecutor.permission(node(), catalog)).toEqual({
      module: "quality",
      action: "create"
    });
    expect(actionExecutor.permission(node("banish"), catalog)).toBeUndefined();
  });

  it("skips when the action is no longer in the catalog", async () => {
    const result = await actionExecutor.execute(
      node("banish"),
      contextWith(unreachable)
    );
    expect(result).toEqual({
      status: "Skipped",
      reason: "This step is no longer available."
    });
  });

  it("calls the service once even when an input is a list", async () => {
    const calls: Array<[string, Record<string, RuntimeValue>]> = [];
    const ctx = contextWith(async (actionId, inputs) => {
      calls.push([actionId, inputs]);
      return { ok: true, outputs: {} };
    });

    const result = await actionExecutor.execute(
      node("notify", {
        recipient: {
          kind: "ref",
          nodeId: "find",
          output: "result",
          path: []
        },
        message: { kind: "literal", type: t.string, value: "Please review" }
      }),
      ctx
    );

    expect(result).toEqual({
      status: "Succeeded",
      outputs: {},
      handle: "success"
    });
    expect(calls).toEqual([
      [
        "notify",
        {
          recipient: recipients,
          message: primitiveValue("string", "Please review")
        }
      ]
    ]);
  });

  it("records each resolved input as it resolves, even when the service fails", async () => {
    const recorded: Record<string, RuntimeValue> = {};
    const ctx = {
      ...contextWith(async () => ({
        ok: false as const,
        error: "The message could not be sent."
      })),
      record: (key: string, value: RuntimeValue) => {
        recorded[key] = value;
      }
    };

    const result = await actionExecutor.execute(
      node("notify", {
        recipient: { kind: "ref", nodeId: "find", output: "result", path: [] },
        message: { kind: "literal", type: t.string, value: "Please review" }
      }),
      ctx
    );

    expect(result).toEqual({
      status: "Failed",
      error: "The message could not be sent.",
      handle: "failure"
    });
    expect(recorded).toEqual({
      recipient: recipients,
      message: primitiveValue("string", "Please review")
    });
  });
});
