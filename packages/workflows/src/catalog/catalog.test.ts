import { describe, expect, it } from "vitest";
import {
  type WorkflowDefinition,
  workflowDefinitionSchema
} from "../definition/schema";
import { validateDefinition } from "../definition/validate";
import { createWorkflowCatalog, getActionRoute } from "./catalog";

const catalog = createWorkflowCatalog();

function need<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`missing ${what}`);
  return value;
}

function define(nodes: unknown[], edges: unknown[] = []): WorkflowDefinition {
  return workflowDefinitionSchema.parse({ nodes, edges });
}

const trigger = (events: string[]) => ({
  id: "trigger",
  name: "trigger",
  type: "trigger",
  position: { x: 0, y: 0 },
  data: { events }
});

const ref = (nodeId: string, output: string, path: string[] = []) => ({
  kind: "ref" as const,
  nodeId,
  output,
  path
});

const literal = (of: string, value: unknown) => ({
  kind: "literal" as const,
  type: { kind: "primitive" as const, of },
  value
});

const condition = (id: string, clauses: unknown[]) => ({
  id,
  name: id,
  type: "condition",
  position: { x: 0, y: 0 },
  data: {
    paths: [
      { id: "if", kind: "if", combinator: "and", clauses },
      { id: "otherwise", kind: "else", combinator: "and", clauses: [] }
    ]
  }
});

const edge = (
  id: string,
  source: string,
  sourceHandle: string,
  target: string
) => ({ id, source, sourceHandle, target, targetHandle: "in" });

describe("createWorkflowCatalog — WorkflowCatalog conformance", () => {
  it("answers for a real record event", () => {
    const event = need(
      catalog.getEvent("purchaseOrder.status.changed"),
      "purchaseOrder.status.changed"
    );
    expect(event.id).toBe("purchaseOrder.status.changed");
    expect(event.permission).toBe("purchasing");
    expect(event.match).toEqual({
      table: "purchaseOrder",
      operation: "UPDATE",
      field: "status"
    });
    expect(event.outputs).toEqual({
      record: { kind: "entity", of: "purchaseOrder" },
      before: { kind: "entity", of: "purchaseOrder" },
      after: { kind: "entity", of: "purchaseOrder" }
    });
  });

  it("answers for created and deleted, and has no generic updated event", () => {
    expect(catalog.getEvent("purchaseOrder.created")).toBeDefined();
    expect(catalog.getEvent("purchaseOrder.deleted")).toBeDefined();
    expect(catalog.getEvent("purchaseOrder.updated")).toBeUndefined();
  });

  it("answers for a moment, matching on its key", () => {
    const event = need(
      catalog.getEvent("production.jobReleased"),
      "production.jobReleased"
    );
    expect(event.match).toEqual({ moment: "production.jobReleased" });
    expect(event.outputs).toEqual({
      job: { kind: "entity", of: "job" },
      releasedBy: { kind: "entity", of: "user" }
    });
  });

  it("returns undefined for an id it does not know", () => {
    expect(catalog.getEvent("purchaseOrder.ghost.changed")).toBeUndefined();
    expect(catalog.getEntity("ghost")).toBeUndefined();
  });

  it("answers with a generated update action, record input first", () => {
    const action = need(
      catalog.getAction("purchaseOrder.update"),
      "purchaseOrder.update"
    );
    expect(action.inputs.purchaseOrder?.required).toBe(true);
    expect(action.inputs.orderDate?.required).toBe(false);
    expect(action.permission).toEqual({
      module: "purchasing",
      action: "update"
    });
  });

  it("answers with a hand-written action and its route", () => {
    expect(need(catalog.getAction("notify"), "notify").requireOneOf).toEqual([
      ["user", "role"]
    ]);
    expect(getActionRoute("job.create")).toEqual({
      call: "production_insertJob"
    });
    expect(getActionRoute("purchaseOrder.update")).toEqual({
      update: { entity: "purchaseOrder" }
    });
    expect(getActionRoute("ghost")).toBeUndefined();
  });

  it("answers with an operation and the entity it works on", () => {
    const operation = need(
      catalog.getOperation("job.totalScrapQuantity"),
      "job.totalScrapQuantity"
    );
    expect(operation.entity).toBe("job");
    expect(operation.permission).toEqual({
      module: "production",
      action: "view"
    });
  });

  it("returns undefined for an action or operation it does not know", () => {
    expect(catalog.getAction("purchaseOrder.teleport")).toBeUndefined();
    expect(catalog.getOperation("job.vibes")).toBeUndefined();
  });

  it("carries the registry permission on every entity", () => {
    expect(need(catalog.getEntity("job"), "job").permission).toEqual({
      module: "production",
      action: "view"
    });
  });
});

describe("createWorkflowCatalog — entity properties", () => {
  const purchaseOrder = need(
    catalog.getEntity("purchaseOrder"),
    "purchaseOrder entity"
  );

  it("turns a foreign key into a registry entity ref", () => {
    expect(purchaseOrder.properties.supplierId).toEqual({
      kind: "entity",
      of: "supplier"
    });
    expect(purchaseOrder.properties.assignee).toEqual({
      kind: "entity",
      of: "user"
    });
  });

  it("leaves a foreign key outside the registry as a plain string", () => {
    expect(purchaseOrder.properties.supplierLocationId).toEqual({
      kind: "primitive",
      of: "string"
    });
  });

  it("drops tenancy, extensibility and audit columns", () => {
    expect(purchaseOrder.properties.companyId).toBeUndefined();
    expect(purchaseOrder.properties.customFields).toBeUndefined();
    expect(purchaseOrder.properties.updatedAt).toBeUndefined();
    expect(purchaseOrder.properties.updatedBy).toBeUndefined();
  });

  it("omits a view-only stored total", () => {
    expect(purchaseOrder.properties.orderTotal).toBeUndefined();
  });

  it("describes reference-only entities", () => {
    const user = need(catalog.getEntity("user"), "user entity");
    expect(user.properties.email).toEqual({ kind: "primitive", of: "string" });
    expect(catalog.getEntity("jobOperation")).toBeDefined();
    expect(catalog.getEntity("location")).toBeDefined();
  });
});

describe("validateDefinition against the real catalog", () => {
  // Property paths use column names: record.supplierId.name, not record.supplier.name.
  function withPath(path: string[]): WorkflowDefinition {
    return define(
      [
        trigger(["purchaseOrder.status.changed"]),
        condition("check", [
          {
            left: ref("trigger", "record", path),
            operator: "eq",
            right: literal("string", "Acme")
          }
        ])
      ],
      [edge("e1", "trigger", "out", "check")]
    );
  }

  it("accepts a dotted path through a real foreign key", () => {
    expect(
      validateDefinition(withPath(["supplierId", "name"]), catalog)
    ).toEqual([]);
  });

  it("reports UNKNOWN_VARIABLE for a property the target does not have", () => {
    expect(
      validateDefinition(withPath(["supplierId", "notAColumn"]), catalog).map(
        (issue) => issue.code
      )
    ).toEqual(["UNKNOWN_VARIABLE"]);
  });

  it("accepts a trigger-only workflow on a real moment", () => {
    expect(
      validateDefinition(define([trigger(["production.jobReleased"])]), catalog)
    ).toEqual([]);
  });

  it("rejects a trigger that lists more than one event", () => {
    // A trigger with two events is now invalid — the variables it would expose
    // depend on which event fired, so downstream nodes cannot be typed safely.
    const definition = define(
      [
        trigger(["production.jobReleased", "production.jobHeld"]),
        condition("check", [
          {
            left: ref("trigger", "job", ["status"]),
            operator: "eq",
            right: literal("string", "Ready")
          }
        ])
      ],
      [edge("e1", "trigger", "out", "check")]
    );
    expect(
      validateDefinition(definition, catalog).map((i) => i.code)
    ).toContain("MULTIPLE_TRIGGER_EVENTS");
  });
});
