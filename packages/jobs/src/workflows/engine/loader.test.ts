import {
  createWorkflowCatalog,
  type RuntimeContext,
  type RuntimeValue,
  resolveRef
} from "@carbon/workflows";
import { describe, expect, it } from "vitest";
import { type EntityCache, triggerOutputs } from "./loader";

const catalog = createWorkflowCatalog();

const trigger = {
  kind: "record" as const,
  table: "customer",
  recordId: "c1",
  operation: "UPDATE" as const,
  record: { id: "c1", name: "Acme Two" },
  before: { id: "c1", name: "Acme One" },
  after: { id: "c1", name: "Acme Two" }
};

const noServices = {
  runAction: async () => ({ ok: false as const, error: "not stubbed" }),
  runOperation: async () => ({ ok: false as const, error: "not stubbed" }),
  search: async () => ({ ok: false as const, error: "not stubbed" })
};

function contextFor(outputs: Record<string, RuntimeValue>): RuntimeContext {
  return {
    catalog,
    loader: { load: async () => null },
    services: noServices,
    outputs: { trigger: outputs }
  };
}

describe("triggerOutputs", () => {
  it("keeps the before and after sides of a change apart", async () => {
    const cache: EntityCache = new Map();
    const outputs = triggerOutputs({
      eventId: "customer.name.changed",
      trigger,
      catalog,
      cache
    });
    const ctx = contextFor(outputs);

    const before = await resolveRef(
      { kind: "ref", nodeId: "trigger", output: "before", path: ["name"] },
      ctx
    );
    const after = await resolveRef(
      { kind: "ref", nodeId: "trigger", output: "after", path: ["name"] },
      ctx
    );

    expect(before).toEqual({
      ok: true,
      value: { kind: "primitive", of: "string", value: "Acme One" }
    });
    expect(after).toEqual({
      ok: true,
      value: { kind: "primitive", of: "string", value: "Acme Two" }
    });
  });

  it("seeds the shared cache with the current state, never the old one", () => {
    const cache: EntityCache = new Map();
    triggerOutputs({
      eventId: "customer.name.changed",
      trigger,
      catalog,
      cache
    });
    expect(cache.get("customer:c1")).toEqual({ id: "c1", name: "Acme Two" });
  });

  it("hands out one record per declared output of a moment", () => {
    const outputs = triggerOutputs({
      eventId: "production.jobReleased",
      trigger: {
        kind: "moment",
        moment: "production.jobReleased",
        outputs: { job: { id: "j1" } }
      },
      catalog,
      cache: new Map()
    });
    expect(outputs.job).toEqual({ kind: "entity", of: "job", id: "j1" });
  });
});
