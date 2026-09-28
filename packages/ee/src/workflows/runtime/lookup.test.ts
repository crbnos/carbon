import { describe, expect, it } from "vitest";
import { createFixtureCatalog } from "../definition/catalog";
import type { LookupNode } from "../definition/schema";
import { t } from "../definition/types";
import { createRuntimeContext } from "./fixtures";
import { lookupExecutor } from "./lookup";
import type { RuntimeValue, SearchOutcome, WorkflowServices } from "./types";
import { entityValue, listValue, nullValue, primitiveValue } from "./values";

type SearchParams = Parameters<WorkflowServices["search"]>[0];

const catalog = createFixtureCatalog();

const isOpen = {
  field: "status",
  operator: "eq" as const,
  value: { kind: "literal" as const, type: t.string, value: "Open" }
};

const node = (
  returns: "one" | "list" = "one",
  match: LookupNode["data"]["match"] = [isOpen]
): LookupNode => ({
  id: "find",
  name: "find",
  type: "lookup",
  position: { x: 0, y: 0 },
  data: { entity: "purchaseOrder", returns, match }
});

function contextWith(outcome: SearchOutcome, captured: SearchParams[] = []) {
  return createRuntimeContext({
    outputs: { trigger: { assignee: entityValue("user", "u1") } },
    services: {
      search: async (params) => {
        captured.push(params);
        return outcome;
      }
    }
  });
}

const orders = (count: number) =>
  listValue(
    { kind: "entity", of: "purchaseOrder" },
    Array.from({ length: count }, (_, i) =>
      entityValue("purchaseOrder", `po${i}`)
    )
  ).value;

describe("lookupExecutor", () => {
  it("hands a single match on `result` and follows the success handle", async () => {
    const result = await lookupExecutor.execute(
      node("one"),
      contextWith({
        ok: true,
        value: entityValue("purchaseOrder", "po1"),
        matched: 1,
        dropped: 0
      })
    );
    expect(result).toEqual({
      status: "Succeeded",
      outputs: { result: entityValue("purchaseOrder", "po1") },
      handle: "success",
      summary: "Found 1 of 1."
    });
  });

  it("fails on the failure handle when a single lookup matches nothing", async () => {
    const result = await lookupExecutor.execute(
      node("one"),
      contextWith({ ok: true, value: nullValue(), matched: 0, dropped: 0 })
    );
    expect(result).toEqual({
      status: "Failed",
      error: "Nothing matched this search.",
      handle: "failure"
    });
  });

  it("succeeds with an empty list when a list lookup matches nothing", async () => {
    const result = await lookupExecutor.execute(
      node("list"),
      contextWith({ ok: true, value: orders(0), matched: 0, dropped: 0 })
    );
    expect(result).toEqual({
      status: "Succeeded",
      outputs: { result: orders(0) },
      handle: "success",
      summary: "Found 0 of 0."
    });
  });

  it("reports how many a capped list left behind", async () => {
    const result = await lookupExecutor.execute(
      node("list"),
      contextWith({ ok: true, value: orders(100), matched: 100, dropped: 43 })
    );
    expect(result).toMatchObject({
      status: "Succeeded",
      handle: "success",
      summary: "Found 100 of 143; 43 were not used."
    });
  });

  it("skips when a match rule's value cannot be resolved", async () => {
    const result = await lookupExecutor.execute(
      node("one", [
        {
          field: "assignee",
          operator: "eq",
          value: { kind: "ref", nodeId: "gone", output: "result", path: [] }
        }
      ]),
      contextWith({
        ok: false,
        error: "the search should not have been called"
      })
    );
    expect(result).toEqual({
      status: "Skipped",
      reason: "The step that produces this value did not run."
    });
  });

  it("fails on the failure handle when the search itself fails", async () => {
    const result = await lookupExecutor.execute(
      node("list"),
      contextWith({ ok: false, error: "Purchasing could not be read." })
    );
    expect(result).toEqual({
      status: "Failed",
      error: "Purchasing could not be read.",
      handle: "failure"
    });
  });

  it("reports the target entity's permission", () => {
    expect(lookupExecutor.permission(node(), catalog)).toEqual({
      module: "purchasing",
      action: "view"
    });
  });

  it("passes the resolved criteria to the search service", async () => {
    const captured: SearchParams[] = [];
    await lookupExecutor.execute(
      node("list", [
        isOpen,
        {
          field: "assignee",
          operator: "eq",
          value: {
            kind: "ref",
            nodeId: "trigger",
            output: "assignee",
            path: []
          }
        }
      ]),
      contextWith(
        { ok: true, value: orders(1), matched: 1, dropped: 0 },
        captured
      )
    );
    expect(captured).toEqual([
      {
        entity: "purchaseOrder",
        returns: "list",
        criteria: [
          {
            field: "status",
            operator: "eq",
            value: primitiveValue("string", "Open")
          },
          {
            field: "assignee",
            operator: "eq",
            value: entityValue("user", "u1")
          }
        ]
      }
    ]);
  });

  it("records each resolved match value, disambiguating a repeated field", async () => {
    const recorded: Record<string, RuntimeValue> = {};
    const ctx = {
      ...contextWith({ ok: true, value: orders(1), matched: 1, dropped: 0 }),
      record: (key: string, value: RuntimeValue) => {
        recorded[key] = value;
      }
    };

    await lookupExecutor.execute(
      node("list", [
        isOpen,
        {
          field: "status",
          operator: "neq" as const,
          value: { kind: "literal" as const, type: t.string, value: "Closed" }
        }
      ]),
      ctx
    );

    expect(recorded).toEqual({
      status: primitiveValue("string", "Open"),
      "status #2": primitiveValue("string", "Closed")
    });
  });
});
