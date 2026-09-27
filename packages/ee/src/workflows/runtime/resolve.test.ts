import { describe, expect, it } from "vitest";
import { createRuntimeContext } from "./fixtures";
import { resolveItem, resolveRef, resolveValue } from "./resolve";
import { entityValue, pairsValue, primitiveValue } from "./values";

const po = entityValue("purchaseOrder", "po1");

describe("resolveRef", () => {
  it("reads a property off a record the run holds", async () => {
    const ctx = createRuntimeContext({
      outputs: { trigger: { record: po } },
      rows: { "purchaseOrder:po1": { amount: 15000 } }
    });
    const result = await resolveRef(
      { kind: "ref", nodeId: "trigger", output: "record", path: ["amount"] },
      ctx
    );
    expect(result).toEqual({
      ok: true,
      value: primitiveValue("number", 15000)
    });
  });

  it("follows a path across two records", async () => {
    const ctx = createRuntimeContext({
      outputs: { trigger: { record: po } },
      rows: {
        "purchaseOrder:po1": { assignee: "u1" },
        "user:u1": { email: "buyer@example.com" }
      }
    });
    const result = await resolveRef(
      {
        kind: "ref",
        nodeId: "trigger",
        output: "record",
        path: ["assignee", "email"]
      },
      ctx
    );
    expect(result).toEqual({
      ok: true,
      value: primitiveValue("string", "buyer@example.com")
    });
  });

  it("stops at nothing rather than failing", async () => {
    const ctx = createRuntimeContext({
      outputs: { trigger: { record: po } },
      rows: { "purchaseOrder:po1": { assignee: null } }
    });
    const result = await resolveRef(
      {
        kind: "ref",
        nodeId: "trigger",
        output: "record",
        path: ["assignee", "email"]
      },
      ctx
    );
    expect(result).toEqual({ ok: true, value: primitiveValue("null", null) });
  });

  it("reports a record it cannot read", async () => {
    const ctx = createRuntimeContext({ outputs: { trigger: { record: po } } });
    const result = await resolveRef(
      { kind: "ref", nodeId: "trigger", output: "record", path: ["amount"] },
      ctx
    );
    expect(result).toEqual({
      ok: false,
      reason: "The purchaseOrder this refers to could not be read."
    });
  });

  it("reports a step that never ran", async () => {
    const ctx = createRuntimeContext();
    const result = await resolveRef(
      { kind: "ref", nodeId: "find", output: "result", path: [] },
      ctx
    );
    expect(result).toEqual({
      ok: false,
      reason: "The step that produces this value did not run."
    });
  });

  it("reports an output that step does not hand out", async () => {
    const ctx = createRuntimeContext({ outputs: { trigger: { record: po } } });
    const result = await resolveRef(
      { kind: "ref", nodeId: "trigger", output: "before", path: [] },
      ctx
    );
    expect(result).toEqual({
      ok: false,
      reason: 'This step did not produce "before".'
    });
  });
});

describe("resolveItem", () => {
  it("reads a property of the item the node is on", async () => {
    const ctx = createRuntimeContext({
      item: entityValue("job", "j1"),
      rows: { "job:j1": { name: "Widget run" } }
    });
    const result = await resolveItem({ kind: "item", path: ["name"] }, ctx);
    expect(result).toEqual({
      ok: true,
      value: primitiveValue("string", "Widget run")
    });
  });

  it("reports having no current item", async () => {
    const result = await resolveItem(
      { kind: "item", path: ["name"] },
      createRuntimeContext()
    );
    expect(result).toEqual({
      ok: false,
      reason: "There is no current item here."
    });
  });
});

describe("resolveValue", () => {
  it("reads a literal without touching the loader", async () => {
    const result = await resolveValue(
      {
        kind: "literal",
        type: { kind: "primitive", of: "number" },
        value: 10000
      },
      createRuntimeContext()
    );
    expect(result).toEqual({
      ok: true,
      value: primitiveValue("number", 10000)
    });
  });
});

describe("resolvePairs", () => {
  it("resolves every row, literal and reference alike", async () => {
    const ctx = createRuntimeContext({
      outputs: { trigger: { record: po } },
      rows: { "purchaseOrder:po1": { status: "Planned" } }
    });
    const result = await resolveValue(
      {
        kind: "pairs",
        entries: [
          {
            name: "Content-Type",
            value: {
              kind: "literal",
              type: { kind: "primitive", of: "string" },
              value: "application/json"
            }
          },
          {
            name: "X-Order-Status",
            value: {
              kind: "ref",
              nodeId: "trigger",
              output: "record",
              path: ["status"]
            }
          }
        ]
      },
      ctx
    );
    expect(result).toEqual({
      ok: true,
      value: pairsValue([
        {
          name: "Content-Type",
          value: primitiveValue("string", "application/json")
        },
        { name: "X-Order-Status", value: primitiveValue("string", "Planned") }
      ])
    });
  });

  it("fails the whole set when one row cannot be resolved", async () => {
    const result = await resolveValue(
      {
        kind: "pairs",
        entries: [
          {
            name: "Content-Type",
            value: {
              kind: "literal",
              type: { kind: "primitive", of: "string" },
              value: "application/json"
            }
          },
          {
            name: "Authorization",
            value: {
              kind: "ref",
              nodeId: "find",
              output: "token",
              path: []
            }
          }
        ]
      },
      createRuntimeContext()
    );
    expect(result).toEqual({
      ok: false,
      reason: "The step that produces this value did not run."
    });
  });

  it("drops a row that was never named", async () => {
    const result = await resolveValue(
      {
        kind: "pairs",
        entries: [
          {
            name: "  ",
            value: {
              kind: "ref",
              nodeId: "find",
              output: "token",
              path: []
            }
          },
          {
            name: "  X-Kept  ",
            value: {
              kind: "literal",
              type: { kind: "primitive", of: "string" },
              value: "yes"
            }
          }
        ]
      },
      createRuntimeContext()
    );
    expect(result).toEqual({
      ok: true,
      value: pairsValue([
        { name: "X-Kept", value: primitiveValue("string", "yes") }
      ])
    });
  });
});
