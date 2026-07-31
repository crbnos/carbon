import { describe, expect, it } from "vitest";
import { createFixtureCatalog } from "./catalog";
import type { WorkflowIssueCode } from "./issues";
import { NODE_KINDS } from "./nodes";
import {
  nodeSchema,
  type WorkflowDefinition,
  workflowDefinitionSchema
} from "./schema";
import { validateDefinition } from "./validate";

const catalog = createFixtureCatalog();

function define(nodes: unknown[], edges: unknown[] = []): WorkflowDefinition {
  return workflowDefinitionSchema.parse({ nodes, edges });
}

function codes(definition: WorkflowDefinition): WorkflowIssueCode[] {
  return validateDefinition(definition, catalog).map((issue) => issue.code);
}

const trigger = (data: Record<string, unknown> = {}) => ({
  id: "trigger",
  type: "trigger",
  position: { x: 0, y: 0 },
  data: { events: ["purchaseOrder.status.changed"], ...data }
});

const action = (id: string, data: Record<string, unknown> = {}) => ({
  id,
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
});

describe("trigger", () => {
  it("reports NO_TRIGGER when nothing can start the workflow", () => {
    expect(codes(define([action("a1")]))).toEqual(["NO_TRIGGER"]);
  });

  it("reports MULTIPLE_TRIGGERS when there are two", () => {
    const definition = define([trigger(), { ...trigger(), id: "trigger2" }]);
    expect(codes(definition)).toEqual(["MULTIPLE_TRIGGERS"]);
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

  it("reports UNREACHABLE_NODE for a step with no path from the trigger", () => {
    const definition = define([trigger(), action("a1")]);
    const issues = validateDefinition(definition, catalog);
    expect(issues.map((i) => i.code)).toEqual(["UNREACHABLE_NODE"]);
    expect(issues[0]?.nodeId).toBe("a1");
  });

  it("accepts a fan-out of two actions off one handle", () => {
    const definition = define(
      [trigger(), action("a1"), action("a2")],
      [edge("e1", "trigger", "out", "a1"), edge("e2", "trigger", "out", "a2")]
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
  type: "condition",
  position: { x: 0, y: 0 },
  data: { paths }
});

const lookup = (id: string, entity: string, returns: "one" | "list") => ({
  id,
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

  it("reports REF_NOT_UPSTREAM across two branches of a condition", () => {
    const definition = define(
      [
        trigger(),
        condition("check", [
          { id: "yes", kind: "if", clauses: [] },
          { id: "no", kind: "else", clauses: [] }
        ]),
        lookup("onIf", "part", "one"),
        action("onElse", {
          action: "updatePart",
          inputs: { part: ref("onIf", "result") }
        })
      ],
      [
        edge("e1", "trigger", "out", "check"),
        edge("e2", "check", "yes", "onIf"),
        edge("e3", "check", "no", "onElse")
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

  function listIntoSingle(batch: boolean): WorkflowDefinition {
    return define(
      [
        trigger(),
        lookup("find", "part", "list"),
        action("a1", {
          action: "updatePart",
          batch,
          inputs: { part: ref("find", "result") }
        })
      ],
      [
        edge("e1", "trigger", "out", "find"),
        edge("e2", "find", "success", "a1")
      ]
    );
  }

  it("reports LIST_INTO_SINGLE when a list feeds a single-item input", () => {
    const issues = validateDefinition(listIntoSingle(false), catalog);
    expect(issues.map((i) => i.code)).toEqual(["LIST_INTO_SINGLE"]);
    expect(issues[0]?.field).toBe("part");
  });

  it("accepts the same wiring when the action is in batch mode", () => {
    expect(validateDefinition(listIntoSingle(true), catalog)).toEqual([]);
  });

  it("reports TYPE_MISMATCH when a filter's source is not a list", () => {
    const definition = define(
      [
        trigger(),
        lookup("find", "part", "one"),
        {
          id: "f1",
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

describe("the current item", () => {
  const item = (path: string[] = []) => ({ kind: "item" as const, path });

  const filterOn = (clauses: unknown[]) =>
    define(
      [
        trigger(),
        lookup("find", "part", "list"),
        {
          id: "f1",
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

  it("reports only UNKNOWN_ACTION when a batched action's action is gone", () => {
    const thin = createFixtureCatalog({ omitActions: ["updatePart"] });
    const definition = define(
      [
        trigger(),
        action("a1", {
          action: "updatePart",
          batch: true,
          inputs: { name: item(["name"]) }
        })
      ],
      [edge("e1", "trigger", "out", "a1")]
    );
    expect(validateDefinition(definition, thin).map((i) => i.code)).toEqual([
      "UNKNOWN_ACTION"
    ]);
  });

  it("reports INCOMPLETE_CONFIG for a batch action with no list to repeat over", () => {
    const definition = define(
      [
        trigger(),
        lookup("find", "part", "one"),
        action("a1", {
          action: "updatePart",
          batch: true,
          inputs: { part: ref("find", "result") }
        })
      ],
      [
        edge("e1", "trigger", "out", "find"),
        edge("e2", "find", "success", "a1")
      ]
    );
    const issues = validateDefinition(definition, catalog);
    expect(issues.map((i) => i.code)).toEqual(["INCOMPLETE_CONFIG"]);
    expect(issues[0]?.field).toBe("batch");
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
