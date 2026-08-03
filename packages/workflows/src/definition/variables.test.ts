import { describe, expect, it } from "vitest";
import { createFixtureCatalog } from "./catalog";
import { type WorkflowDefinition, workflowDefinitionSchema } from "./schema";
import { availableVariables, variablesFromHandle } from "./variables";

const catalog = createFixtureCatalog();

function define(nodes: unknown[], edges: unknown[] = []): WorkflowDefinition {
  return workflowDefinitionSchema.parse({ nodes, edges });
}

const trigger = (data: Record<string, unknown> = {}) => ({
  id: "trigger",
  name: "trigger",
  type: "trigger",
  position: { x: 0, y: 0 },
  data: { events: ["purchaseOrder.status.changed"], ...data }
});

const action = (id: string, data: Record<string, unknown> = {}) => ({
  id,
  name: id,
  type: "action",
  position: { x: 0, y: 0 },
  data: { action: "createIssue", inputs: {}, ...data }
});

const lookup = (
  id: string,
  entity: string,
  returns: "one" | "list" = "one"
) => ({
  id,
  name: id,
  type: "lookup",
  position: { x: 0, y: 0 },
  data: { entity, returns, match: [] }
});

const condition = (id: string, paths: unknown[]) => ({
  id,
  name: id,
  type: "condition",
  position: { x: 0, y: 0 },
  data: { paths }
});

const edge = (
  id: string,
  source: string,
  sourceHandle: string,
  target: string
) => ({ id, source, sourceHandle, target, targetHandle: "in" });

describe("availableVariables", () => {
  it("returns trigger and lookup outputs at action, all guaranteed", () => {
    // trigger → lookup → action (linear)
    const definition = define(
      [trigger(), lookup("lkp", "part", "one"), action("act")],
      [edge("e1", "trigger", "out", "lkp"), edge("e2", "lkp", "success", "act")]
    );

    const vars = availableVariables(definition, "act", catalog);

    // trigger emits purchaseOrder + before, lookup emits result
    const nodeIds = vars.map((v) => v.nodeId);
    expect(nodeIds).toContain("trigger");
    expect(nodeIds).toContain("lkp");

    // All must be guaranteed — every path goes through both trigger and lookup
    expect(vars.every((v) => v.guaranteed)).toBe(true);

    // Lookup's output is "result"
    const lookupVar = vars.find(
      (v) => v.nodeId === "lkp" && v.output === "result"
    );
    expect(lookupVar).toBeDefined();
    expect(lookupVar?.type).toEqual({ kind: "entity", of: "part" });

    // Trigger outputs present
    const triggerOutputs = vars
      .filter((v) => v.nodeId === "trigger")
      .map((v) => v.output);
    expect(triggerOutputs).toContain("purchaseOrder");
    expect(triggerOutputs).toContain("before");
  });

  it("marks a node on one branch as not guaranteed at the reconverge point", () => {
    // trigger → condition(yes/no) → lookupA(yes) → action
    //                             → action(no) directly
    const definition = define(
      [
        trigger(),
        condition("cond", [
          { id: "yes", kind: "if", clauses: [] },
          { id: "no", kind: "else", clauses: [] }
        ]),
        lookup("lkp_a", "part", "one"),
        action("act")
      ],
      [
        edge("e1", "trigger", "out", "cond"),
        edge("e2", "cond", "yes", "lkp_a"),
        edge("e3", "cond", "no", "act"),
        edge("e4", "lkp_a", "success", "act")
      ]
    );

    const vars = availableVariables(definition, "act", catalog);

    // trigger is guaranteed — every path goes through it
    const triggerVar = vars.find(
      (v) => v.nodeId === "trigger" && v.output === "purchaseOrder"
    );
    expect(triggerVar?.guaranteed).toBe(true);

    // condition is guaranteed — every path goes through it
    const condVar = vars.find((v) => v.nodeId === "cond");
    // condition emits {} so no variables, but we can check lkpA
    expect(condVar).toBeUndefined(); // condition outputs {} → no variables emitted

    // lkpA is NOT guaranteed — the "no" path skips it
    const lkpVar = vars.find(
      (v) => v.nodeId === "lkp_a" && v.output === "result"
    );
    expect(lkpVar).toBeDefined();
    expect(lkpVar?.guaranteed).toBe(false);
  });

  it("never offers a node its own outputs or a downstream node's outputs", () => {
    // trigger → action1 → action2
    const definition = define(
      [
        trigger(),
        action("action1", { action: "createIssue", inputs: {} }),
        action("action2", { action: "updatePart", inputs: {} })
      ],
      [
        edge("e1", "trigger", "out", "action1"),
        edge("e2", "action1", "success", "action2")
      ]
    );

    // At action1: only trigger should be offered (action1 is not its own ancestor)
    const varsAtAction1 = availableVariables(definition, "action1", catalog);
    const nodeIdsAtAction1 = varsAtAction1.map((v) => v.nodeId);
    expect(nodeIdsAtAction1).not.toContain("action1");
    expect(nodeIdsAtAction1).not.toContain("action2");
    expect(nodeIdsAtAction1).toContain("trigger");

    // At action2: trigger + action1 offered, but NOT action2 itself
    const varsAtAction2 = availableVariables(definition, "action2", catalog);
    const nodeIdsAtAction2 = varsAtAction2.map((v) => v.nodeId);
    expect(nodeIdsAtAction2).not.toContain("action2");
    expect(nodeIdsAtAction2).toContain("trigger");
    expect(nodeIdsAtAction2).toContain("action1");
  });

  it("returns no variables when the trigger event is unknown in the catalog", () => {
    const thinCatalog = createFixtureCatalog({
      omitEvents: ["purchaseOrder.status.changed"]
    });

    // Single trigger node; no downstream nodes
    const _definition = define([trigger()]);

    // Querying for variables available at the trigger itself → no ancestors
    // Querying for variables at a non-existent node → also empty
    // Instead: add an action and query there; trigger outputs are undefined → no vars
    const withAction = define(
      [trigger(), action("act")],
      [edge("e1", "trigger", "out", "act")]
    );

    const vars = availableVariables(withAction, "act", thinCatalog);
    // Trigger's outputsOf returns undefined (event not found) → nothing emitted
    expect(vars).toHaveLength(0);
  });
});

describe("multiple triggers", () => {
  // t1 watches purchaseOrder.status.changed, t2 watches part.created
  const t1 = trigger();
  const t2 = {
    ...trigger(),
    id: "trigger2",
    name: "trigger2",
    data: { events: ["part.created"] }
  };

  it("offers both triggers outputs when both can reach the node", () => {
    const definition = define(
      [t1, t2, action("act")],
      [
        edge("e1", "trigger", "out", "act"),
        edge("e2", "trigger2", "out", "act")
      ]
    );
    const vars = availableVariables(definition, "act", catalog);
    expect(vars.some((v) => v.nodeId === "trigger")).toBe(true);
    expect(vars.some((v) => v.nodeId === "trigger2")).toBe(true);
  });

  it("marks both trigger outputs non-guaranteed when both can reach the node", () => {
    const definition = define(
      [t1, t2, action("act")],
      [
        edge("e1", "trigger", "out", "act"),
        edge("e2", "trigger2", "out", "act")
      ]
    );
    const vars = availableVariables(definition, "act", catalog);
    const triggerVars = vars.filter(
      (v) => v.nodeId === "trigger" || v.nodeId === "trigger2"
    );
    expect(triggerVars.every((v) => v.guaranteed === false)).toBe(true);
  });

  it("marks the only reachable trigger guaranteed and excludes the other", () => {
    // t1 → act1, t2 → act2 (no fan-in)
    const definition = define(
      [t1, t2, action("act1"), action("act2")],
      [
        edge("e1", "trigger", "out", "act1"),
        edge("e2", "trigger2", "out", "act2")
      ]
    );
    const vars = availableVariables(definition, "act1", catalog);
    expect(
      vars.some((v) => v.nodeId === "trigger" && v.guaranteed === true)
    ).toBe(true);
    expect(vars.some((v) => v.nodeId === "trigger2")).toBe(false);
  });
});

describe("variablesFromHandle", () => {
  it("includes the node's own outputs, unlike the view from that node", () => {
    const definition = define(
      [trigger(), lookup("lkp", "part", "one")],
      [edge("e1", "trigger", "out", "lkp")]
    );

    const atNode = availableVariables(definition, "lkp", catalog);
    expect(atNode.some((v) => v.nodeId === "lkp")).toBe(false);

    const afterHandle = variablesFromHandle(
      definition,
      "lkp",
      "success",
      catalog
    );
    expect(
      afterHandle.some((v) => v.nodeId === "lkp" && v.output === "result")
    ).toBe(true);
    expect(afterHandle.some((v) => v.nodeId === "trigger")).toBe(true);
  });

  it("hides what only the other branch of a condition produces", () => {
    // trigger → cond, cond:yes → lkp_a, cond:no → act
    const definition = define(
      [
        trigger(),
        condition("cond", [
          { id: "yes", kind: "if", combinator: "and", clauses: [] },
          { id: "no", kind: "else", combinator: "and", clauses: [] }
        ]),
        lookup("lkp_a", "part", "one"),
        action("act")
      ],
      [
        edge("e1", "trigger", "out", "cond"),
        edge("e2", "cond", "yes", "lkp_a"),
        edge("e3", "cond", "no", "act")
      ]
    );

    const fromNo = variablesFromHandle(definition, "cond", "no", catalog);
    expect(fromNo.some((v) => v.nodeId === "lkp_a")).toBe(false);
    expect(fromNo.some((v) => v.nodeId === "trigger" && v.guaranteed)).toBe(
      true
    );
  });
});
