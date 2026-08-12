import { describe, expect, it } from "vitest";
import { createFixtureCatalog } from "./catalog";
import type { WorkflowIssueCode } from "./issues";
import { NODE_KINDS } from "./nodes";
import {
  nodeSchema,
  type WorkflowDefinition,
  workflowDefinitionSchema
} from "./schema";
import { referenceIssues, validateDefinition } from "./validate";

const catalog = createFixtureCatalog();

function define(nodes: unknown[], edges: unknown[] = []): WorkflowDefinition {
  return workflowDefinitionSchema.parse({ nodes, edges });
}

function codes(definition: WorkflowDefinition): WorkflowIssueCode[] {
  return validateDefinition(definition, catalog).map((issue) => issue.code);
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

const edge = (
  id: string,
  source: string,
  sourceHandle: string,
  target: string
) => ({ id, source, sourceHandle, target, targetHandle: "in" });

describe("shape", () => {
  it("accepts a trigger-only workflow", () => {
    expect(validateDefinition(define([trigger()]), catalog)).toEqual([]);
  });

  it("rejects two nodes sharing an id", () => {
    const definition = define([trigger(), { ...trigger(), type: "trigger" }]);
    expect(codes(definition)).toContain("MALFORMED_DEFINITION");
  });

  it("reports DUPLICATE_NODE_NAME for two nodes with the same name", () => {
    const definition = define(
      [
        trigger(),
        {
          ...condition("cond_a", [{ id: "p1", kind: "if", clauses: [] }]),
          name: "shared"
        },
        { ...action("cond_b"), name: "shared" }
      ],
      [
        edge("e1", "trigger", "out", "cond_a"),
        edge("e2", "trigger", "out", "cond_b")
      ]
    );
    const issues = validateDefinition(definition, catalog);
    expect(issues.map((i) => i.code)).toEqual([
      "DUPLICATE_NODE_NAME",
      "DUPLICATE_NODE_NAME"
    ]);
  });

  it("does not report DUPLICATE_NODE_NAME when all names are unique", () => {
    const definition = define([
      trigger(),
      condition("condition_0", [{ id: "p1", kind: "if", clauses: [] }]),
      condition("condition_1", [{ id: "p2", kind: "if", clauses: [] }])
    ]);
    expect(codes(definition)).not.toContain("DUPLICATE_NODE_NAME");
  });
});

describe("trigger", () => {
  it("reports NO_TRIGGER when nothing can start the workflow", () => {
    expect(codes(define([action("a1")]))).toEqual(["NO_TRIGGER"]);
  });

  it("accepts two triggers watching different events", () => {
    const definition = define([
      trigger(),
      {
        ...trigger(),
        id: "trigger2",
        name: "trigger2",
        data: { events: ["part.created"] }
      }
    ]);
    expect(codes(definition)).toEqual([]);
  });

  it("reports DUPLICATE_TRIGGER_EVENT when two triggers share an event", () => {
    const definition = define([
      trigger(),
      { ...trigger(), id: "trigger2", name: "trigger2" }
    ]);
    expect(codes(definition)).toEqual(["DUPLICATE_TRIGGER_EVENT"]);
  });

  it("reports CONFLICTING_TRIGGER for a schedule alongside another trigger", () => {
    const definition = define([
      trigger({
        events: [],
        schedule: { freq: "Daily", hour: 9, minute: 0, tz: "America/Chicago" }
      }),
      { ...trigger(), id: "trigger2", name: "trigger2" }
    ]);
    expect(codes(definition)).toEqual(["CONFLICTING_TRIGGER"]);
  });

  it("reports EMPTY_TRIGGER naming the unconfigured trigger of two", () => {
    const definition = define([
      trigger(),
      { ...trigger(), id: "trigger2", name: "trigger2", data: { events: [] } }
    ]);
    const issues = validateDefinition(definition, catalog);
    expect(issues.map((issue) => issue.code)).toEqual(["EMPTY_TRIGGER"]);
    expect(issues[0]?.nodeId).toBe("trigger2");
  });

  it("reports EMPTY_TRIGGER for neither events nor a schedule", () => {
    expect(codes(define([trigger({ events: [] })]))).toEqual(["EMPTY_TRIGGER"]);
  });

  it("reports CONFLICTING_TRIGGER for both events and a schedule", () => {
    const definition = define([
      trigger({
        schedule: { freq: "Daily", hour: 9, minute: 0, tz: "America/Chicago" }
      })
    ]);
    expect(codes(definition)).toEqual(["CONFLICTING_TRIGGER"]);
  });

  it("accepts a well-formed schedule", () => {
    const definition = define([
      trigger({
        events: [],
        schedule: { freq: "Daily", hour: 9, minute: 0, tz: "America/Chicago" }
      })
    ]);
    expect(validateDefinition(definition, catalog)).toEqual([]);
  });

  it("reports INVALID_SCHEDULE for a weekly schedule with no weekdays", () => {
    const definition = define([
      trigger({
        events: [],
        schedule: { freq: "Weekly", hour: 9, minute: 0, tz: "America/Chicago" }
      })
    ]);
    const issues = validateDefinition(definition, catalog);
    expect(issues.map((i) => i.code)).toEqual(["INVALID_SCHEDULE"]);
    expect(issues[0]?.field).toBe("weekdays");
  });

  it("reports INVALID_SCHEDULE for a daily schedule carrying a day", () => {
    const definition = define([
      trigger({
        events: [],
        schedule: {
          freq: "Daily",
          hour: 9,
          minute: 0,
          day: 5,
          tz: "America/Chicago"
        }
      })
    ]);
    const issues = validateDefinition(definition, catalog);
    expect(issues.map((i) => i.code)).toEqual(["INVALID_SCHEDULE"]);
    expect(issues[0]?.field).toBe("day");
  });

  it("reports INVALID_SCHEDULE for an unrecognised time zone", () => {
    const definition = define([
      trigger({
        events: [],
        schedule: { freq: "Daily", hour: 9, minute: 0, tz: "Mars/Olympus" }
      })
    ]);
    const issues = validateDefinition(definition, catalog);
    expect(issues.map((i) => i.code)).toEqual(["INVALID_SCHEDULE"]);
    expect(issues[0]?.field).toBe("tz");
  });
});

describe("edges", () => {
  it("reports DANGLING_EDGE for an edge naming a node that does not exist", () => {
    const definition = define(
      [trigger(), action("a1")],
      [edge("e1", "trigger", "out", "ghost")]
    );
    const issues = validateDefinition(definition, catalog);
    expect(issues.map((i) => i.code)).toEqual(["DANGLING_EDGE"]);
    expect(issues[0]?.edgeId).toBe("e1");
  });

  it("reports UNKNOWN_HANDLE for a condition path the node does not declare", () => {
    const condition = {
      id: "c1",
      name: "c1",
      type: "condition",
      position: { x: 0, y: 0 },
      data: { paths: [{ id: "p1", kind: "if", clauses: [] }] }
    };
    const definition = define(
      [trigger(), condition, action("a1")],
      [edge("e1", "trigger", "out", "c1"), edge("e2", "c1", "p2", "a1")]
    );
    const issues = validateDefinition(definition, catalog);
    expect(issues.map((i) => i.code)).toEqual(["UNKNOWN_HANDLE"]);
    expect(issues[0]?.edgeId).toBe("e2");
  });

  it("accepts an action's failure handle", () => {
    const definition = define(
      [trigger(), action("a1"), action("a2")],
      [edge("e1", "trigger", "out", "a1"), edge("e2", "a1", "failure", "a2")]
    );
    expect(
      validateDefinition(definition, catalog).map((i) => i.code)
    ).not.toContain("UNKNOWN_HANDLE");
  });
});

describe("graph", () => {
  it("reports CYCLE when steps loop back on each other", () => {
    const definition = define(
      [trigger(), action("a1"), action("a2")],
      [
        edge("e1", "trigger", "out", "a1"),
        edge("e2", "a1", "success", "a2"),
        edge("e3", "a2", "success", "a1")
      ]
    );
    expect(codes(definition)).toEqual(["CYCLE"]);
  });

  // A step parked on the canvas is not part of the workflow — the engine never runs it.
  it("ignores a step with no path from the trigger, however broken", () => {
    const definition = define([
      trigger(),
      action("a1", { action: "createIssue", inputs: {} })
    ]);
    expect(validateDefinition(definition, catalog)).toEqual([]);
  });

  it("accepts a fan-out of two actions off one handle", () => {
    const definition = define(
      [trigger(), action("a1"), action("a2")],
      [edge("e1", "trigger", "out", "a1"), edge("e2", "trigger", "out", "a2")]
    );
    expect(codes(definition)).not.toContain("UNREACHABLE_NODE");
  });

  it("does not call a node unreachable when a second trigger feeds it", () => {
    const definition = define(
      [
        trigger(),
        {
          ...trigger(),
          id: "trigger2",
          name: "trigger2",
          data: { events: ["part.created"] }
        },
        action("a1")
      ],
      [edge("e1", "trigger2", "out", "a1")]
    );
    expect(codes(definition)).not.toContain("UNREACHABLE_NODE");
  });
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

const condition = (id: string, paths: unknown[]) => ({
  id,
  name: id,
  type: "condition",
  position: { x: 0, y: 0 },
  data: { paths }
});

const lookup = (id: string, entity: string, returns: "one" | "list") => ({
  id,
  name: id,
  type: "lookup",
  position: { x: 0, y: 0 },
  data: { entity, returns, match: [] }
});

/** "When a purchase order over $10,000 is sent, tell the buyer's manager." */
function purchaseOrderWorkflow(): WorkflowDefinition {
  return define(
    [
      trigger(),
      condition("check", [
        {
          id: "over",
          kind: "if",
          combinator: "and",
          clauses: [
            {
              left: ref("trigger", "purchaseOrder", ["amount"]),
              operator: "gt",
              right: literal("number", 10000)
            }
          ]
        },
        { id: "otherwise", kind: "else", combinator: "and", clauses: [] }
      ]),
      action("notify", {
        action: "notify",
        inputs: {
          recipient: ref("trigger", "purchaseOrder", ["assignee", "manager"]),
          message: literal("string", "This order is over $10,000.")
        }
      })
    ],
    [
      edge("e1", "trigger", "out", "check"),
      edge("e2", "check", "over", "notify")
    ]
  );
}

describe("references", () => {
  it("accepts a property path through two entities", () => {
    expect(validateDefinition(purchaseOrderWorkflow(), catalog)).toEqual([]);
  });

  it("reports UNKNOWN_VARIABLE for a step that does not exist", () => {
    const definition = define(
      [
        trigger(),
        action("a1", {
          action: "createIssue",
          inputs: { title: ref("ghost", "result") }
        })
      ],
      [edge("e1", "trigger", "out", "a1")]
    );
    expect(codes(definition)).toEqual(["UNKNOWN_VARIABLE"]);
  });

  it("reports UNKNOWN_VARIABLE for a property the record does not have", () => {
    const definition = define(
      [
        trigger(),
        action("a1", {
          action: "createIssue",
          inputs: { title: ref("trigger", "purchaseOrder", ["nickname"]) }
        })
      ],
      [edge("e1", "trigger", "out", "a1")]
    );
    expect(codes(definition)).toEqual(["UNKNOWN_VARIABLE"]);
  });

  it("referenceIssues reports a broken variable the layers above would hide", () => {
    // A cycle, so `validateDefinition` stops at layer 4 and never looks at values.
    const definition = define(
      [
        trigger(),
        action("a1", {
          action: "createIssue",
          inputs: { title: ref("ghost", "result") }
        }),
        action("a2")
      ],
      [
        edge("e1", "trigger", "out", "a1"),
        edge("e2", "a1", "success", "a2"),
        edge("e3", "a2", "success", "a1")
      ]
    );
    expect(codes(definition)).toEqual(["CYCLE"]);
    expect(referenceIssues(definition, catalog).map((i) => i.code)).toEqual([
      "UNKNOWN_VARIABLE"
    ]);
  });

  it("referenceIssues says nothing about a definition it cannot read", () => {
    expect(referenceIssues({ nodes: "not a list" }, catalog)).toEqual([]);
  });

  it("reports UNKNOWN_VARIABLE for an output the step no longer hands out", () => {
    const definition = define(
      [
        trigger(),
        action("a1", {
          action: "createIssue",
          inputs: { title: ref("trigger", "salesOrder") }
        })
      ],
      [edge("e1", "trigger", "out", "a1")]
    );
    expect(codes(definition)).toEqual(["UNKNOWN_VARIABLE"]);
  });

  it("reports REF_NOT_UPSTREAM across two branches of a condition", () => {
    const definition = define(
      [
        trigger(),
        condition("check", [
          { id: "yes", kind: "if", clauses: [] },
          { id: "no", kind: "else", clauses: [] }
        ]),
        lookup("on_if", "part", "one"),
        action("on_else", {
          action: "updatePart",
          inputs: { part: ref("on_if", "result") }
        })
      ],
      [
        edge("e1", "trigger", "out", "check"),
        edge("e2", "check", "yes", "on_if"),
        edge("e3", "check", "no", "on_else")
      ]
    );
    expect(codes(definition)).toEqual(["REF_NOT_UPSTREAM"]);
  });
});

describe("types", () => {
  it("reports MISSING_INPUT when a required input has no value", () => {
    const definition = define(
      [trigger(), action("a1", { action: "createIssue", inputs: {} })],
      [edge("e1", "trigger", "out", "a1")]
    );
    const issues = validateDefinition(definition, catalog);
    expect(issues.map((i) => i.code)).toEqual(["MISSING_INPUT"]);
    expect(issues[0]?.field).toBe("title");
  });

  it("reports TYPE_MISMATCH for a string supplied to a number input", () => {
    const definition = define(
      [
        trigger(),
        action("a1", {
          action: "updatePart",
          inputs: {
            part: ref("trigger", "purchaseOrder"),
            name: literal("number", 12)
          }
        })
      ],
      [edge("e1", "trigger", "out", "a1")]
    );
    const codesFound = codes(definition);
    expect(codesFound).toContain("TYPE_MISMATCH");
  });

  it("reports TYPE_MISMATCH for a record written into a sentence", () => {
    const definition = define(
      [
        trigger(),
        action("a1", {
          action: "createIssue",
          inputs: {
            title: {
              kind: "template",
              parts: [
                { kind: "text", text: "Check " },
                ref("trigger", "purchaseOrder")
              ]
            }
          }
        })
      ],
      [edge("e1", "trigger", "out", "a1")]
    );
    const issues = validateDefinition(definition, catalog);
    expect(issues.map((i) => i.code)).toEqual(["TYPE_MISMATCH"]);
    // The part index, so the builder can redden that one token and not the field.
    expect(issues[0]?.field).toBe("title.parts.1");
  });

  it("accepts a property of that record in the same sentence", () => {
    const definition = define(
      [
        trigger(),
        action("a1", {
          action: "createIssue",
          inputs: {
            title: {
              kind: "template",
              parts: [
                { kind: "text", text: "Check " },
                ref("trigger", "purchaseOrder", ["status"])
              ]
            }
          }
        })
      ],
      [edge("e1", "trigger", "out", "a1")]
    );
    expect(validateDefinition(definition, catalog)).toEqual([]);
  });

  it("reports TYPE_MISMATCH for an operator that does not fit the type", () => {
    const definition = define(
      [
        trigger(),
        condition("check", [
          {
            id: "p1",
            kind: "if",
            clauses: [
              {
                left: ref("trigger", "purchaseOrder", ["status"]),
                operator: "gt",
                right: literal("string", "Sent")
              }
            ]
          }
        ])
      ],
      [edge("e1", "trigger", "out", "check")]
    );
    const issues = validateDefinition(definition, catalog);
    expect(issues.map((i) => i.code)).toEqual(["TYPE_MISMATCH"]);
    expect(issues[0]?.field).toBe("paths.p1.clauses.0.operator");
  });

  it("reports TYPE_MISMATCH when the two sides of a clause differ", () => {
    const definition = define(
      [
        trigger(),
        condition("check", [
          {
            id: "p1",
            kind: "if",
            clauses: [
              {
                left: ref("trigger", "purchaseOrder", ["amount"]),
                operator: "gt",
                right: literal("string", "lots")
              }
            ]
          }
        ])
      ],
      [edge("e1", "trigger", "out", "check")]
    );
    const issues = validateDefinition(definition, catalog);
    expect(issues.map((i) => i.code)).toEqual(["TYPE_MISMATCH"]);
    expect(issues[0]?.field).toBe("paths.p1.clauses.0.right");
  });

  function listIntoSingle(
    actionId: string,
    inputName: string
  ): WorkflowDefinition {
    return define(
      [
        trigger(),
        lookup("find", "part", "list"),
        action("a1", {
          action: actionId,
          inputs: { [inputName]: ref("find", "result") }
        })
      ],
      [
        edge("e1", "trigger", "out", "find"),
        edge("e2", "find", "success", "a1")
      ]
    );
  }

  it("reports LIST_INTO_SINGLE when a list feeds a step that cannot repeat", () => {
    const issues = validateDefinition(
      listIntoSingle("createIssue", "title"),
      catalog
    );
    expect(issues.map((i) => i.code)).toEqual(["LIST_INTO_SINGLE"]);
    expect(issues[0]?.field).toBe("title");
  });

  it("accepts the same wiring when the action can repeat", () => {
    expect(
      validateDefinition(listIntoSingle("updatePart", "part"), catalog)
    ).toEqual([]);
  });

  it("reports INCOMPLETE_CONFIG when two lists leave the repeat ambiguous", () => {
    const definition = define(
      [
        trigger(),
        lookup("parts", "part", "list"),
        lookup("users", "user", "list"),
        action("a1", {
          action: "assignPart",
          inputs: {
            part: ref("parts", "result"),
            user: ref("users", "result")
          }
        })
      ],
      [
        edge("e1", "trigger", "out", "parts"),
        edge("e2", "parts", "success", "users"),
        edge("e3", "users", "success", "a1")
      ]
    );
    const issues = validateDefinition(definition, catalog);
    expect(issues.map((i) => i.code)).toEqual(["INCOMPLETE_CONFIG"]);
    // Blamed on the second list; neither list is also rejected on its own.
    expect(issues[0]?.field).toBe("user");
  });

  it("reports TYPE_MISMATCH when a filter's source is not a list", () => {
    const definition = define(
      [
        trigger(),
        lookup("find", "part", "one"),
        {
          id: "f1",
          name: "f1",
          type: "filter",
          position: { x: 0, y: 0 },
          data: { source: ref("find", "result"), clauses: [] }
        }
      ],
      [
        edge("e1", "trigger", "out", "find"),
        edge("e2", "find", "success", "f1")
      ]
    );
    const issues = validateDefinition(definition, catalog);
    expect(issues.map((i) => i.code)).toEqual(["TYPE_MISMATCH"]);
    expect(issues[0]?.field).toBe("source");
  });
});

describe("configuration", () => {
  it("reports UNKNOWN_EVENT for an event the catalog does not know", () => {
    const definition = define([trigger({ events: ["part.exploded"] })]);
    expect(codes(definition)).toEqual(["UNKNOWN_EVENT"]);
  });

  it("reports UNKNOWN_OPERATION for an operation the catalog does not know", () => {
    const definition = define(
      [
        trigger(),
        {
          id: "e1",
          name: "e1",
          type: "entity",
          position: { x: 0, y: 0 },
          data: { operation: "job.vibes", inputs: {} }
        }
      ],
      [edge("x1", "trigger", "out", "e1")]
    );
    expect(codes(definition)).toEqual(["UNKNOWN_OPERATION"]);
  });

  it("reports UNKNOWN_ENTITY for a record type the catalog does not know", () => {
    const definition = define(
      [trigger(), lookup("l1", "unicorn", "one")],
      [edge("e1", "trigger", "out", "l1")]
    );
    expect(codes(definition)).toEqual(["UNKNOWN_ENTITY"]);
  });

  it("reports UNKNOWN_INPUT for a lookup matching on a property the record has not got", () => {
    const definition = define(
      [
        trigger(),
        {
          ...lookup("l1", "part", "one"),
          data: {
            entity: "part",
            returns: "one",
            match: [
              {
                field: "colour",
                operator: "eq",
                value: literal("string", "red")
              }
            ]
          }
        }
      ],
      [edge("e1", "trigger", "out", "l1")]
    );
    const issues = validateDefinition(definition, catalog);
    expect(issues.map((i) => i.code)).toEqual(["UNKNOWN_INPUT"]);
    expect(issues[0]?.field).toBe("match.0.field");
  });

  it("reports TYPE_MISMATCH for a lookup comparing a property against the wrong type", () => {
    const definition = define(
      [
        trigger(),
        {
          ...lookup("l1", "part", "one"),
          data: {
            entity: "part",
            returns: "one",
            match: [
              { field: "name", operator: "eq", value: literal("number", 7) }
            ]
          }
        }
      ],
      [edge("e1", "trigger", "out", "l1")]
    );
    const issues = validateDefinition(definition, catalog);
    expect(issues.map((i) => i.code)).toEqual(["TYPE_MISMATCH"]);
    expect(issues[0]?.field).toBe("match.0.value");
  });

  it("accepts a lookup matching a real property at a matching type", () => {
    const definition = define(
      [
        trigger(),
        {
          ...lookup("l1", "part", "one"),
          data: {
            entity: "part",
            returns: "one",
            match: [
              {
                field: "name",
                operator: "eq",
                value: literal("string", "Bolt")
              }
            ]
          }
        }
      ],
      [edge("e1", "trigger", "out", "l1")]
    );
    expect(validateDefinition(definition, catalog)).toEqual([]);
  });

  it("reports UNKNOWN_INPUT for an input the catalog does not declare", () => {
    const definition = define(
      [
        trigger(),
        action("a1", {
          action: "createIssue",
          inputs: {
            title: literal("string", "Something went wrong"),
            severity: literal("string", "high")
          }
        })
      ],
      [edge("e1", "trigger", "out", "a1")]
    );
    const issues = validateDefinition(definition, catalog);
    expect(issues.map((i) => i.code)).toEqual(["UNKNOWN_INPUT"]);
    expect(issues[0]?.field).toBe("severity");
  });

  it("reports INCOMPLETE_CONFIG when no input from a required group is supplied", () => {
    const definition = define(
      [trigger(), action("a1", { action: "alertSomeone", inputs: {} })],
      [edge("e1", "trigger", "out", "a1")]
    );
    const issues = validateDefinition(definition, catalog);
    expect(issues.map((i) => i.code)).toEqual(["INCOMPLETE_CONFIG"]);
    expect(issues[0]?.message).toBe(
      "This step needs at least one of: user, role."
    );
  });

  it("accepts a required group when one of its inputs is supplied", () => {
    const definition = define(
      [
        trigger(),
        action("a1", {
          action: "alertSomeone",
          inputs: { role: literal("string", "Buyer") }
        })
      ],
      [edge("e1", "trigger", "out", "a1")]
    );
    expect(validateDefinition(definition, catalog)).toEqual([]);
  });

  it("reports INCOMPLETE_CONFIG for an action with nothing chosen", () => {
    const definition = define(
      [trigger(), action("a1", { action: "" })],
      [edge("e1", "trigger", "out", "a1")]
    );
    const issues = validateDefinition(definition, catalog);
    expect(issues.map((i) => i.code)).toEqual(["INCOMPLETE_CONFIG"]);
    expect(issues[0]?.field).toBe("action");
  });

  it("reports INCOMPLETE_CONFIG for an if branch with nothing to check", () => {
    const definition = define(
      [trigger(), condition("check", [{ id: "p1", kind: "if", clauses: [] }])],
      [edge("e1", "trigger", "out", "check")]
    );
    const issues = validateDefinition(definition, catalog);
    expect(issues.map((i) => i.code)).toEqual(["INCOMPLETE_CONFIG"]);
  });

  it("reports INCOMPLETE_CONFIG for a filter with no list chosen", () => {
    const definition = define(
      [
        trigger(),
        {
          id: "f1",
          name: "f1",
          type: "filter",
          position: { x: 0, y: 0 },
          data: { clauses: [] }
        }
      ],
      [edge("e1", "trigger", "out", "f1")]
    );
    const issues = validateDefinition(definition, catalog);
    expect(issues.map((i) => i.code)).toEqual(["INCOMPLETE_CONFIG"]);
    expect(issues[0]?.field).toBe("source");
  });

  it("reports INCOMPLETE_CONFIG for a choices input given an out-of-list literal", () => {
    const definition = define(
      [
        trigger(),
        action("a1", {
          action: "alertSomeone",
          inputs: { role: literal("string", "CEO") }
        })
      ],
      [edge("e1", "trigger", "out", "a1")]
    );
    const issues = validateDefinition(definition, catalog);
    const choicesIssue = issues.find(
      (i) => i.code === "INCOMPLETE_CONFIG" && i.field === "inputs.role"
    );
    expect(choicesIssue).toBeDefined();
    expect(choicesIssue?.field).toBe("inputs.role");
  });

  it("accepts a choices input given an in-list literal", () => {
    const definition = define(
      [
        trigger(),
        action("a1", {
          action: "alertSomeone",
          inputs: { role: literal("string", "Manager") }
        })
      ],
      [edge("e1", "trigger", "out", "a1")]
    );
    const issues = validateDefinition(definition, catalog);
    expect(issues.filter((i) => i.code === "INCOMPLETE_CONFIG")).toEqual([]);
  });

  it("does not check choices when the value is a ref", () => {
    const definition = define(
      [
        trigger(),
        action("a1", {
          action: "alertSomeone",
          inputs: { role: ref("trigger", "purchaseOrder", ["status"]) }
        })
      ],
      [edge("e1", "trigger", "out", "a1")]
    );
    const issues = validateDefinition(definition, catalog);
    expect(issues.filter((i) => i.code === "INCOMPLETE_CONFIG")).toEqual([]);
  });

  it("does not emit INCOMPLETE_CONFIG for an enum-valued lookup match when omitEnums is true", () => {
    const thin = createFixtureCatalog({ omitEnums: true });
    const definition = define(
      [
        trigger(),
        {
          ...lookup("l1", "purchaseOrder", "one"),
          data: {
            entity: "purchaseOrder",
            returns: "one",
            match: [
              {
                field: "status",
                operator: "eq",
                value: literal("string", "InvalidStatus")
              }
            ]
          }
        }
      ],
      [edge("e1", "trigger", "out", "l1")]
    );
    expect(
      validateDefinition(definition, thin).filter(
        (i) => i.code === "INCOMPLETE_CONFIG"
      )
    ).toEqual([]);
  });
});

// A draft is saved as-is, so these shapes reach the validator. Each must parse
// (so autosave never fails) and block publishing (so no half-filled node runs).
describe("half-filled drafts", () => {
  it("parses a condition clause with no right-hand side, but blocks publishing", () => {
    const definition = define(
      [
        trigger(),
        condition("check", [
          {
            id: "over",
            kind: "if",
            combinator: "and",
            clauses: [
              {
                left: ref("trigger", "purchaseOrder", ["amount"]),
                operator: "gt"
              }
            ]
          }
        ]),
        action("notify", {
          action: "notify",
          inputs: {
            recipient: ref("trigger", "purchaseOrder", ["assignee", "manager"]),
            message: literal("string", "This order is over $10,000.")
          }
        })
      ],
      [
        edge("e1", "trigger", "out", "check"),
        edge("e2", "check", "over", "notify")
      ]
    );
    expect(workflowDefinitionSchema.safeParse(definition).success).toBe(true);

    const issues = validateDefinition(definition, catalog);
    expect(issues.map((i) => i.code)).toEqual(["INCOMPLETE_CONFIG"]);
    expect(issues[0]?.field).toBe("paths.over.clauses.0.right");
  });

  it("parses a lookup match with a blank field, but blocks publishing", () => {
    const definition = define(
      [
        trigger(),
        {
          ...lookup("l1", "part", "one"),
          data: {
            entity: "part",
            returns: "one",
            match: [{ field: "", operator: "eq" }]
          }
        }
      ],
      [edge("e1", "trigger", "out", "l1")]
    );
    expect(workflowDefinitionSchema.safeParse(definition).success).toBe(true);

    const issues = validateDefinition(definition, catalog);
    expect(issues.map((i) => i.code)).toEqual(["INCOMPLETE_CONFIG"]);
    expect(issues[0]?.field).toBe("match.0.field");
  });

  it("parses a lookup match with a named field but no value, but blocks publishing", () => {
    const definition = define(
      [
        trigger(),
        {
          ...lookup("l1", "part", "one"),
          data: {
            entity: "part",
            returns: "one",
            match: [{ field: "name", operator: "eq" }]
          }
        }
      ],
      [edge("e1", "trigger", "out", "l1")]
    );
    expect(workflowDefinitionSchema.safeParse(definition).success).toBe(true);

    const issues = validateDefinition(definition, catalog);
    expect(issues.map((i) => i.code)).toEqual(["INCOMPLETE_CONFIG"]);
    expect(issues[0]?.field).toBe("match.0.value");
  });
});

describe("the current item", () => {
  const item = (path: string[] = []) => ({ kind: "item" as const, path });

  const filterOn = (clauses: unknown[]) =>
    define(
      [
        trigger(),
        lookup("find", "part", "list"),
        {
          id: "f1",
          name: "f1",
          type: "filter",
          position: { x: 0, y: 0 },
          data: { source: ref("find", "result"), clauses }
        }
      ],
      [
        edge("e1", "trigger", "out", "find"),
        edge("e2", "find", "success", "f1")
      ]
    );

  it("accepts a filter testing a property of the item it is on", () => {
    const definition = filterOn([
      {
        left: item(["unitPrice"]),
        operator: "gt",
        right: literal("number", 10)
      }
    ]);
    expect(validateDefinition(definition, catalog)).toEqual([]);
  });

  it("reports ITEM_OUTSIDE_LOOP on a node that works through no list", () => {
    const definition = define(
      [
        trigger(),
        condition("check", [
          {
            id: "p1",
            kind: "if",
            clauses: [
              {
                left: item(["unitPrice"]),
                operator: "gt",
                right: literal("number", 10)
              }
            ]
          }
        ])
      ],
      [edge("e1", "trigger", "out", "check")]
    );
    expect(codes(definition)).toEqual(["ITEM_OUTSIDE_LOOP"]);
  });

  it("reports UNKNOWN_VARIABLE for a property the items do not have", () => {
    const definition = filterOn([
      { left: item(["nope"]), operator: "eq", right: literal("string", "x") }
    ]);
    const issues = validateDefinition(definition, catalog);
    expect(issues.map((i) => i.code)).toEqual(["UNKNOWN_VARIABLE"]);
    expect(issues[0]?.message).toBe(
      "This property does not exist on the items in that list."
    );
  });

  // The next three assert ITEM_OUTSIDE_LOOP is suppressed when a deeper cause exists.
  it("reports only UNKNOWN_ENTITY when the list's record type is gone", () => {
    const thin = createFixtureCatalog({ omitEntities: ["part"] });
    const definition = filterOn([
      {
        left: item(["unitPrice"]),
        operator: "gt",
        right: literal("number", 10)
      }
    ]);
    expect(validateDefinition(definition, thin).map((i) => i.code)).toEqual([
      "UNKNOWN_ENTITY"
    ]);
  });

  it("reports only INCOMPLETE_CONFIG when the filter has no list chosen", () => {
    const definition = define(
      [
        trigger(),
        {
          id: "f1",
          name: "f1",
          type: "filter",
          position: { x: 0, y: 0 },
          data: {
            clauses: [
              {
                left: item(["unitPrice"]),
                operator: "gt",
                right: literal("number", 10)
              }
            ]
          }
        }
      ],
      [edge("e1", "trigger", "out", "f1")]
    );
    const issues = validateDefinition(definition, catalog);
    expect(issues.map((i) => i.code)).toEqual(["INCOMPLETE_CONFIG"]);
    expect(issues[0]?.field).toBe("source");
  });

  it("reports only UNKNOWN_ACTION when a repeating action's action is gone", () => {
    const thin = createFixtureCatalog({ omitActions: ["updatePart"] });
    const definition = define(
      [
        trigger(),
        action("a1", {
          action: "updatePart",
          inputs: { name: item(["name"]) }
        })
      ],
      [edge("e1", "trigger", "out", "a1")]
    );
    expect(validateDefinition(definition, thin).map((i) => i.code)).toEqual([
      "UNKNOWN_ACTION"
    ]);
  });

  it("accepts a step fed one record, with nothing to repeat", () => {
    const definition = define(
      [
        trigger(),
        lookup("find", "part", "one"),
        action("a1", {
          action: "updatePart",
          inputs: { part: ref("find", "result") }
        })
      ],
      [
        edge("e1", "trigger", "out", "find"),
        edge("e2", "find", "success", "a1")
      ]
    );
    expect(validateDefinition(definition, catalog)).toEqual([]);
  });
});

describe("the catalog is injected, not baked in", () => {
  it("validates the purchase-order workflow against the full catalog", () => {
    expect(validateDefinition(purchaseOrderWorkflow(), catalog)).toEqual([]);
  });

  it("reports exactly one UNKNOWN_ACTION when notify is missing", () => {
    const thin = createFixtureCatalog({ omitActions: ["notify"] });
    const issues = validateDefinition(purchaseOrderWorkflow(), thin);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("UNKNOWN_ACTION");
    expect(issues[0]?.nodeId).toBe("notify");
  });

  it("reports UNKNOWN_EVENT when the trigger's event is missing", () => {
    const thin = createFixtureCatalog({
      omitEvents: ["purchaseOrder.status.changed"]
    });
    const issues = validateDefinition(purchaseOrderWorkflow(), thin);
    expect(issues.map((i) => i.code)).toEqual(["UNKNOWN_EVENT"]);
  });
});

describe("regressions", () => {
  it("rejects a filter whose source is its own output", () => {
    const definition = define(
      [
        trigger(),
        {
          id: "f",
          name: "f",
          type: "filter",
          position: { x: 0, y: 0 },
          data: {
            source: { kind: "ref", nodeId: "f", output: "result", path: [] },
            clauses: []
          }
        }
      ],
      [edge("e1", "trigger", "out", "f")]
    );
    expect(codes(definition)).toEqual(["REF_NOT_UPSTREAM"]);
  });

  it("rejects two filters that read each other", () => {
    const filter = (id: string, sourceNode: string) => ({
      id,
      name: id,
      type: "filter",
      position: { x: 0, y: 0 },
      data: {
        source: { kind: "ref", nodeId: sourceNode, output: "result", path: [] },
        clauses: []
      }
    });
    const definition = define(
      [trigger(), filter("f1", "f2"), filter("f2", "f1")],
      [edge("e1", "trigger", "out", "f1"), edge("e2", "f1", "out", "f2")]
    );
    expect(codes(definition)).toEqual(["REF_NOT_UPSTREAM"]);
  });

  it("rejects a literal whose value contradicts its declared type", () => {
    const definition = {
      formatVersion: 1,
      nodes: [
        trigger(),
        action("a", {
          inputs: {
            title: {
              kind: "literal",
              type: { kind: "primitive", of: "string" },
              value: { not: "a string" }
            }
          }
        })
      ],
      edges: [edge("e1", "trigger", "out", "a")]
    };
    const issues = validateDefinition(definition, catalog);
    expect(issues.map((i) => i.code)).toEqual(["MALFORMED_DEFINITION"]);
  });

  it("accepts a literal whose value matches its declared type", () => {
    const definition = {
      formatVersion: 1,
      nodes: [
        trigger(),
        action("a", {
          inputs: {
            title: {
              kind: "literal",
              type: { kind: "primitive", of: "string" },
              value: "Look into this"
            }
          }
        })
      ],
      edges: [edge("e1", "trigger", "out", "a")]
    };
    expect(validateDefinition(definition, catalog)).toEqual([]);
  });

  it("rejects an operator outside the shared vocabulary at parse time", () => {
    const definition = {
      formatVersion: 1,
      nodes: [
        trigger(),
        {
          id: "c",
          name: "c",
          type: "condition",
          position: { x: 0, y: 0 },
          data: {
            paths: [
              {
                id: "p1",
                kind: "if",
                clauses: [
                  {
                    left: {
                      kind: "ref",
                      nodeId: "trigger",
                      output: "purchaseOrder",
                      path: ["status"]
                    },
                    operator: "banana",
                    right: {
                      kind: "literal",
                      type: { kind: "primitive", of: "string" },
                      value: "Sent"
                    }
                  }
                ]
              }
            ]
          }
        }
      ],
      edges: [edge("e1", "trigger", "out", "c")]
    };
    const issues = validateDefinition(definition, catalog);
    expect(issues.map((i) => i.code)).toEqual(["MALFORMED_DEFINITION"]);
  });

  it("declares a node kind for every node type in the schema", () => {
    const inSchema = nodeSchema.options
      .map((option) => option.shape.type.value)
      .sort();
    expect(Object.keys(NODE_KINDS).sort()).toEqual(inSchema);
  });

  it("validates a definition that has never been through the schema", () => {
    const issues = validateDefinition({ nodes: "not a list" }, catalog);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.code === "MALFORMED_DEFINITION")).toBe(true);
  });
});

describe("pairs and showWhen", () => {
  const literal = (value: string) => ({
    kind: "literal",
    type: { kind: "primitive", of: "string" },
    value
  });

  const callUrl = (inputs: Record<string, unknown>) =>
    define(
      [trigger(), action("call", { action: "callUrl", inputs })],
      [edge("e1", "trigger", "out", "call")]
    );

  const issuesFor = (inputs: Record<string, unknown>) =>
    validateDefinition(callUrl(inputs), catalog);

  it("accepts named rows on an input declared for them", () => {
    expect(
      issuesFor({
        url: literal("https://example.com"),
        method: literal("POST"),
        body: literal("hi"),
        headers: {
          kind: "pairs",
          entries: [{ name: "X-Company-Key", value: literal("abc") }]
        }
      })
    ).toEqual([]);
  });

  it("rejects named rows on an input that does not take them", () => {
    const issues = issuesFor({
      url: { kind: "pairs", entries: [] },
      method: literal("GET")
    });
    expect(issues[0]?.code).toBe("TYPE_MISMATCH");
    expect(issues[0]?.message).toMatch(
      /does not take a list of names and values/
    );
  });

  it("rejects a plain value on an input that takes named rows", () => {
    const issues = issuesFor({
      url: literal("https://example.com"),
      method: literal("GET"),
      headers: literal("nope")
    });
    expect(issues[0]?.code).toBe("TYPE_MISMATCH");
    expect(issues[0]?.message).toMatch(/takes a list of names and values/);
  });

  it("reports a row with no name", () => {
    const issues = issuesFor({
      url: literal("https://example.com"),
      method: literal("GET"),
      headers: { kind: "pairs", entries: [{ name: "  ", value: literal("a") }] }
    });
    expect(issues[0]?.code).toBe("INCOMPLETE_CONFIG");
    expect(issues[0]?.field).toBe("headers.entries.0");
    expect(issues[0]?.message).toBe("This row needs a name.");
  });

  it("refuses a header name Carbon sets itself", () => {
    const issues = issuesFor({
      url: literal("https://example.com"),
      method: literal("GET"),
      headers: {
        kind: "pairs",
        entries: [{ name: "Host", value: literal("evil.example") }]
      }
    });
    expect(issues[0]?.code).toBe("INCOMPLETE_CONFIG");
    expect(issues[0]?.message).toMatch(/is set by Carbon/);
  });

  it("reports the same name set twice, ignoring case", () => {
    const issues = issuesFor({
      url: literal("https://example.com"),
      method: literal("GET"),
      headers: {
        kind: "pairs",
        entries: [
          { name: "X-Key", value: literal("a") },
          { name: "x-key", value: literal("b") }
        ]
      }
    });
    expect(issues[0]?.code).toBe("INCOMPLETE_CONFIG");
    expect(issues[0]?.field).toBe("headers.entries.1");
    expect(issues[0]?.message).toMatch(/is set twice/);
  });

  it("does not require a gated-off input", () => {
    expect(
      issuesFor({ url: literal("https://example.com"), method: literal("GET") })
    ).toEqual([]);
  });

  it("requires a gated-on input", () => {
    const issues = issuesFor({
      url: literal("https://example.com"),
      method: literal("POST")
    });
    expect(issues[0]?.code).toBe("MISSING_INPUT");
    expect(issues[0]?.field).toBe("body");
  });

  it("reports a value left behind on a gated-off input", () => {
    const issues = issuesFor({
      url: literal("https://example.com"),
      method: literal("GET"),
      body: literal("leftover")
    });
    expect(issues[0]?.code).toBe("INCOMPLETE_CONFIG");
    expect(issues[0]?.message).toBe(
      '"body" does not apply when method is "GET". Clear it to continue.'
    );
  });

  it("opens the gate when the gating input holds a variable", () => {
    const issues = issuesFor({
      url: literal("https://example.com"),
      method: {
        kind: "ref",
        nodeId: "trigger",
        output: "purchaseOrder",
        path: ["status"]
      }
    });
    expect(issues[0]?.code).toBe("MISSING_INPUT");
    expect(issues[0]?.field).toBe("body");
  });

  it("reports a reference to a missing step inside a row", () => {
    const issues = issuesFor({
      url: literal("https://example.com"),
      method: literal("GET"),
      headers: {
        kind: "pairs",
        entries: [
          {
            name: "X-Key",
            value: { kind: "ref", nodeId: "gone", output: "record", path: [] }
          }
        ]
      }
    });
    expect(issues[0]?.code).toBe("UNKNOWN_VARIABLE");
    expect(issues[0]?.field).toBe("headers.entries.0");
  });

  it("refuses a whole record as a row's value", () => {
    const issues = issuesFor({
      url: literal("https://example.com"),
      method: literal("GET"),
      headers: {
        kind: "pairs",
        entries: [
          {
            name: "X-Key",
            value: {
              kind: "ref",
              nodeId: "trigger",
              output: "purchaseOrder",
              path: []
            }
          }
        ]
      }
    });
    expect(issues[0]?.code).toBe("TYPE_MISMATCH");
    expect(issues[0]?.field).toBe("headers.entries.0");
    expect(issues[0]?.message).toMatch(/into text/);
  });

  it("leaves an already-published webhook with only url and body alone", () => {
    expect(
      issuesFor({ url: literal("https://example.com"), body: literal("hi") })
    ).toEqual([]);
  });
});
