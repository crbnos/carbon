// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import { createFixtureCatalog, type WorkflowCatalog } from "./catalog";
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

const codes = (definition: unknown, against: WorkflowCatalog = catalog) =>
  validateDefinition(definition, against).map((issue) => issue.code);

/** Code and field of every issue, for cases where the field is the point. */
const issuesAt = (definition: unknown, against: WorkflowCatalog = catalog) =>
  validateDefinition(definition, against).map(({ code, field }) => ({
    code,
    field
  }));

// --- node and value builders -------------------------------------------------

type Node = { id: string; type: string } & Record<string, unknown>;

const node = (type: string, id: string, data: Record<string, unknown>) => ({
  id,
  name: id,
  type,
  position: { x: 0, y: 0 },
  data
});

const trigger = (data: Record<string, unknown> = {}) =>
  node("trigger", "trigger", {
    events: ["purchaseOrder.status.changed"],
    ...data
  });

const secondTrigger = (data: Record<string, unknown> = {}) =>
  node("trigger", "trigger2", {
    events: ["purchaseOrder.status.changed"],
    ...data
  });

const action = (id: string, data: Record<string, unknown> = {}) =>
  node("action", id, { action: "createIssue", inputs: {}, ...data });

const condition = (id: string, paths: unknown[]) =>
  node("condition", id, { paths });

const lookup = (
  id: string,
  entity: string,
  returns: "one" | "list",
  match: unknown[] = []
) => node("lookup", id, { entity, returns, match });

const filter = (id: string, data: Record<string, unknown>) =>
  node("filter", id, data);

const ifPath = (id: string, clauses: unknown[]) => ({
  id,
  kind: "if",
  clauses
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

const item = (path: string[] = []) => ({ kind: "item" as const, path });

const edge = (
  id: string,
  source: string,
  sourceHandle: string,
  target: string
) => ({ id, source, sourceHandle, target, targetHandle: "in" });

const EXIT_HANDLE: Record<string, string> = {
  trigger: "out",
  compute: "out",
  filter: "out",
  lookup: "success",
  action: "success"
};

/** The trigger, then each step wired to the next on its default exit. */
function wired(...steps: Node[]): WorkflowDefinition {
  const chain: Node[] = [trigger(), ...steps];
  return define(
    chain,
    steps.map((step, i) => {
      const from = chain[i] as Node;
      return edge(
        `e${i + 1}`,
        from.id,
        EXIT_HANDLE[from.type] ?? "out",
        step.id
      );
    })
  );
}

/** "When a purchase order over $10,000 is sent, tell the buyer's manager." */
function purchaseOrderWorkflow(
  overClause: Record<string, unknown> = {
    left: ref("trigger", "purchaseOrder", ["amount"]),
    operator: "gt",
    right: literal("number", 10000)
  }
): WorkflowDefinition {
  return define(
    [
      trigger(),
      condition("check", [
        { id: "over", kind: "if", combinator: "and", clauses: [overClause] },
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

// --- tests --------------------------------------------------------------------

describe("shape", () => {
  it("accepts a trigger-only workflow", () => {
    expect(codes(define([trigger()]))).toEqual([]);
  });

  it("rejects two nodes sharing an id", () => {
    expect(codes(define([trigger(), trigger()]))).toContain(
      "MALFORMED_DEFINITION"
    );
  });

  it("reports DUPLICATE_NODE_NAME on both nodes sharing a name", () => {
    const definition = define(
      [
        trigger(),
        { ...condition("cond_a", [ifPath("p1", [])]), name: "shared" },
        { ...action("cond_b"), name: "shared" }
      ],
      [
        edge("e1", "trigger", "out", "cond_a"),
        edge("e2", "trigger", "out", "cond_b")
      ]
    );
    expect(codes(definition)).toEqual([
      "DUPLICATE_NODE_NAME",
      "DUPLICATE_NODE_NAME"
    ]);
  });

  it("does not report DUPLICATE_NODE_NAME when all names are unique", () => {
    const definition = define([
      trigger(),
      condition("condition_0", [ifPath("p1", [])]),
      condition("condition_1", [ifPath("p2", [])])
    ]);
    expect(codes(definition)).not.toContain("DUPLICATE_NODE_NAME");
  });

  it("declares a node kind for every node type in the schema", () => {
    const inSchema = nodeSchema.options
      .map((option) => option.shape.type.value)
      .sort();
    expect(Object.keys(NODE_KINDS).sort()).toEqual(inSchema);
  });

  it("validates a definition that has never been through the schema", () => {
    const found = codes({ nodes: "not a list" });
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((code) => code === "MALFORMED_DEFINITION")).toBe(true);
  });

  // A definition that skipped the schema is parsed first; a bad value fails it.
  it.each([
    [
      "a literal whose value contradicts its declared type",
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
    [
      "an operator outside the shared vocabulary",
      condition("a", [
        ifPath("p1", [
          {
            left: ref("trigger", "purchaseOrder", ["status"]),
            operator: "banana",
            right: literal("string", "Sent")
          }
        ])
      ])
    ]
  ])("rejects %s as MALFORMED_DEFINITION", (_, step) => {
    const definition = {
      formatVersion: 1,
      nodes: [trigger(), step],
      edges: [edge("e1", "trigger", "out", "a")]
    };
    expect(codes(definition)).toEqual(["MALFORMED_DEFINITION"]);
  });

  it("accepts an unparsed literal whose value matches its declared type", () => {
    const definition = {
      formatVersion: 1,
      nodes: [
        trigger(),
        action("a", { inputs: { title: literal("string", "Look into this") } })
      ],
      edges: [edge("e1", "trigger", "out", "a")]
    };
    expect(codes(definition)).toEqual([]);
  });
});

describe("trigger", () => {
  const daily = { freq: "Daily", hour: 9, minute: 0, tz: "America/Chicago" };

  it("reports NO_TRIGGER when nothing can start the workflow", () => {
    expect(codes(define([action("a1")]))).toEqual(["NO_TRIGGER"]);
  });

  it("accepts two triggers watching different events", () => {
    expect(
      codes(define([trigger(), secondTrigger({ events: ["part.created"] })]))
    ).toEqual([]);
  });

  it("reports DUPLICATE_TRIGGER_EVENT when two triggers share an event", () => {
    expect(codes(define([trigger(), secondTrigger()]))).toEqual([
      "DUPLICATE_TRIGGER_EVENT"
    ]);
  });

  it("reports CONFLICTING_TRIGGER for a schedule alongside another trigger", () => {
    expect(
      codes(define([trigger({ events: [], schedule: daily }), secondTrigger()]))
    ).toEqual(["CONFLICTING_TRIGGER"]);
  });

  it("reports CONFLICTING_TRIGGER for both events and a schedule", () => {
    expect(codes(define([trigger({ schedule: daily })]))).toEqual([
      "CONFLICTING_TRIGGER"
    ]);
  });

  it("reports EMPTY_TRIGGER naming the unconfigured trigger of two", () => {
    const issues = validateDefinition(
      define([trigger(), secondTrigger({ events: [] })]),
      catalog
    );
    expect(issues.map(({ code, nodeId }) => ({ code, nodeId }))).toEqual([
      { code: "EMPTY_TRIGGER", nodeId: "trigger2" }
    ]);
  });

  it("reports EMPTY_TRIGGER for neither events nor a schedule", () => {
    expect(codes(define([trigger({ events: [] })]))).toEqual(["EMPTY_TRIGGER"]);
  });

  it("accepts a well-formed schedule", () => {
    expect(codes(define([trigger({ events: [], schedule: daily })]))).toEqual(
      []
    );
  });

  it.each([
    ["a weekly schedule with no weekdays", { freq: "Weekly" }, "weekdays"],
    ["a daily schedule carrying a day", { day: 5 }, "day"],
    ["an unrecognised time zone", { tz: "Mars/Olympus" }, "tz"]
  ])("reports INVALID_SCHEDULE for %s", (_, schedule, field) => {
    const definition = define([
      trigger({ events: [], schedule: { ...daily, ...schedule } })
    ]);
    expect(issuesAt(definition)).toEqual([{ code: "INVALID_SCHEDULE", field }]);
  });
});

describe("edges", () => {
  it("reports DANGLING_EDGE for an edge naming a node that does not exist", () => {
    const definition = define(
      [trigger(), action("a1")],
      [edge("e1", "trigger", "out", "ghost")]
    );
    const issues = validateDefinition(definition, catalog);
    expect(issues.map(({ code, edgeId }) => ({ code, edgeId }))).toEqual([
      { code: "DANGLING_EDGE", edgeId: "e1" }
    ]);
  });

  it("reports UNKNOWN_HANDLE for a condition path the node does not declare", () => {
    const definition = define(
      [trigger(), condition("c1", [ifPath("p1", [])]), action("a1")],
      [edge("e1", "trigger", "out", "c1"), edge("e2", "c1", "p2", "a1")]
    );
    const issues = validateDefinition(definition, catalog);
    expect(issues.map(({ code, edgeId }) => ({ code, edgeId }))).toEqual([
      { code: "UNKNOWN_HANDLE", edgeId: "e2" }
    ]);
  });

  it("accepts an action's failure handle", () => {
    const definition = define(
      [trigger(), action("a1"), action("a2")],
      [edge("e1", "trigger", "out", "a1"), edge("e2", "a1", "failure", "a2")]
    );
    expect(codes(definition)).not.toContain("UNKNOWN_HANDLE");
  });
});

describe("graph", () => {
  const cycle = (a1: Node) =>
    define(
      [trigger(), a1, action("a2")],
      [
        edge("e1", "trigger", "out", "a1"),
        edge("e2", "a1", "success", "a2"),
        edge("e3", "a2", "success", "a1")
      ]
    );

  it("reports CYCLE when steps loop back on each other", () => {
    expect(codes(cycle(action("a1")))).toEqual(["CYCLE"]);
  });

  it("referenceIssues reports a broken variable a cycle would hide", () => {
    // `validateDefinition` stops at the cycle and never looks at values.
    const definition = cycle(
      action("a1", { inputs: { title: ref("ghost", "result") } })
    );
    expect(codes(definition)).toEqual(["CYCLE"]);
    expect(referenceIssues(definition, catalog).map((i) => i.code)).toEqual([
      "UNKNOWN_VARIABLE"
    ]);
  });

  it("referenceIssues says nothing about a definition it cannot read", () => {
    expect(referenceIssues({ nodes: "not a list" }, catalog)).toEqual([]);
  });

  // A step parked on the canvas is not part of the workflow; the engine never runs it.
  it("ignores a step with no path from the trigger, however broken", () => {
    expect(codes(define([trigger(), action("a1")]))).toEqual([]);
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
      [trigger(), secondTrigger({ events: ["part.created"] }), action("a1")],
      [edge("e1", "trigger2", "out", "a1")]
    );
    expect(codes(definition)).not.toContain("UNREACHABLE_NODE");
  });
});

describe("references", () => {
  it("accepts a property path through two entities", () => {
    expect(codes(purchaseOrderWorkflow())).toEqual([]);
  });

  it.each([
    ["a step that does not exist", ref("ghost", "result")],
    [
      "a property the record does not have",
      ref("trigger", "purchaseOrder", ["nickname"])
    ],
    ["an output the step no longer hands out", ref("trigger", "salesOrder")]
  ])("reports UNKNOWN_VARIABLE for %s", (_, title) => {
    expect(codes(wired(action("a1", { inputs: { title } })))).toEqual([
      "UNKNOWN_VARIABLE"
    ]);
  });

  it("reports REF_NOT_UPSTREAM across two branches of a condition", () => {
    const definition = define(
      [
        trigger(),
        condition("check", [
          ifPath("yes", []),
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

  it("rejects a filter whose source is its own output", () => {
    expect(
      codes(wired(filter("f", { source: ref("f", "result"), clauses: [] })))
    ).toEqual(["REF_NOT_UPSTREAM"]);
  });

  it("rejects two filters that read each other", () => {
    const definition = wired(
      filter("f1", { source: ref("f2", "result"), clauses: [] }),
      filter("f2", { source: ref("f1", "result"), clauses: [] })
    );
    expect(codes(definition)).toEqual(["REF_NOT_UPSTREAM"]);
  });
});

describe("types", () => {
  it("reports MISSING_INPUT when a required input has no value", () => {
    expect(issuesAt(wired(action("a1")))).toEqual([
      { code: "MISSING_INPUT", field: "title" }
    ]);
  });

  it("reports TYPE_MISMATCH for a number supplied to a text input", () => {
    const definition = wired(
      action("a1", {
        action: "updatePart",
        inputs: {
          part: ref("trigger", "purchaseOrder"),
          name: literal("number", 12)
        }
      })
    );
    expect(issuesAt(definition)).toContainEqual({
      code: "TYPE_MISMATCH",
      field: "name"
    });
  });

  // A whole record reads as its readable id ("…for PO000123"), which a
  // notification body turns into a link. A LIST of records still does not.
  it.each([
    ["a record", []],
    ["a property of that record", ["status"]]
  ])("accepts %s written into a sentence", (_, path) => {
    const title = {
      kind: "template",
      parts: [
        { kind: "text", text: "Check " },
        ref("trigger", "purchaseOrder", path)
      ]
    };
    expect(codes(wired(action("a1", { inputs: { title } })))).toEqual([]);
  });

  it.each([
    [
      "an operator that does not fit the type",
      ["status"],
      literal("string", "Sent"),
      "paths.p1.clauses.0.operator"
    ],
    [
      "two sides of a clause that differ",
      ["amount"],
      literal("string", "lots"),
      "paths.p1.clauses.0.right"
    ]
  ])("reports TYPE_MISMATCH for %s", (_, path, right, field) => {
    const definition = wired(
      condition("check", [
        ifPath("p1", [
          { left: ref("trigger", "purchaseOrder", path), operator: "gt", right }
        ])
      ])
    );
    expect(issuesAt(definition)).toEqual([{ code: "TYPE_MISMATCH", field }]);
  });

  const listInto = (actionId: string, inputName: string) =>
    wired(
      lookup("find", "part", "list"),
      action("a1", {
        action: actionId,
        inputs: { [inputName]: ref("find", "result") }
      })
    );

  it("reports LIST_INTO_SINGLE when a list feeds a step that cannot repeat", () => {
    expect(issuesAt(listInto("createIssue", "title"))).toEqual([
      { code: "LIST_INTO_SINGLE", field: "title" }
    ]);
  });

  it("accepts the same wiring when the action can repeat", () => {
    expect(codes(listInto("updatePart", "part"))).toEqual([]);
  });

  it("accepts a step fed one record, with nothing to repeat", () => {
    const definition = wired(
      lookup("find", "part", "one"),
      action("a1", {
        action: "updatePart",
        inputs: { part: ref("find", "result") }
      })
    );
    expect(codes(definition)).toEqual([]);
  });

  it("reports INCOMPLETE_CONFIG on the second list when two leave the repeat ambiguous", () => {
    const definition = wired(
      lookup("parts", "part", "list"),
      lookup("users", "user", "list"),
      action("a1", {
        action: "assignPart",
        inputs: { part: ref("parts", "result"), user: ref("users", "result") }
      })
    );
    // Neither list is also rejected on its own.
    expect(issuesAt(definition)).toEqual([
      { code: "INCOMPLETE_CONFIG", field: "user" }
    ]);
  });

  it("reports TYPE_MISMATCH when a filter's source is not a list", () => {
    const definition = wired(
      lookup("find", "part", "one"),
      filter("f1", { source: ref("find", "result"), clauses: [] })
    );
    expect(issuesAt(definition)).toEqual([
      { code: "TYPE_MISMATCH", field: "source" }
    ]);
  });
});

describe("configuration", () => {
  it("reports UNKNOWN_EVENT for an event the catalog does not know", () => {
    expect(codes(define([trigger({ events: ["part.exploded"] })]))).toEqual([
      "UNKNOWN_EVENT"
    ]);
  });

  it("reports UNKNOWN_OPERATION for an operation the catalog does not know", () => {
    expect(
      codes(
        wired(node("compute", "c1", { operation: "job.vibes", inputs: {} }))
      )
    ).toEqual(["UNKNOWN_OPERATION"]);
  });

  it("reports UNKNOWN_ENTITY for a record type the catalog does not know", () => {
    expect(codes(wired(lookup("l1", "unicorn", "one")))).toEqual([
      "UNKNOWN_ENTITY"
    ]);
  });

  it.each([
    [
      "UNKNOWN_INPUT",
      "a property the record has not got",
      { field: "colour", operator: "eq", value: literal("string", "red") },
      "match.0.field"
    ],
    [
      "TYPE_MISMATCH",
      "a property against the wrong type",
      { field: "name", operator: "eq", value: literal("number", 7) },
      "match.0.value"
    ]
  ])("reports %s for a lookup matching on %s", (code, _, match, field) => {
    expect(issuesAt(wired(lookup("l1", "part", "one", [match])))).toEqual([
      { code, field }
    ]);
  });

  it("accepts a lookup matching a real property at a matching type", () => {
    const match = {
      field: "name",
      operator: "eq",
      value: literal("string", "Bolt")
    };
    expect(codes(wired(lookup("l1", "part", "one", [match])))).toEqual([]);
  });

  it("does not check a lookup's enum match when the catalog carries no enums", () => {
    const match = {
      field: "status",
      operator: "eq",
      value: literal("string", "InvalidStatus")
    };
    const definition = wired(lookup("l1", "purchaseOrder", "one", [match]));
    expect(
      codes(definition, createFixtureCatalog({ omitEnums: true }))
    ).not.toContain("INCOMPLETE_CONFIG");
  });

  it("reports UNKNOWN_INPUT for an input the catalog does not declare", () => {
    const definition = wired(
      action("a1", {
        inputs: {
          title: literal("string", "Something went wrong"),
          severity: literal("string", "high")
        }
      })
    );
    expect(issuesAt(definition)).toEqual([
      { code: "UNKNOWN_INPUT", field: "severity" }
    ]);
  });

  it("reports INCOMPLETE_CONFIG when no input from a required group is supplied", () => {
    const issues = validateDefinition(
      wired(action("a1", { action: "alertSomeone" })),
      catalog
    );
    expect(issues.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: "INCOMPLETE_CONFIG",
        message: "This step needs at least one of: user, role."
      }
    ]);
  });

  const alert = (inputs: Record<string, unknown>) =>
    wired(action("a1", { action: "alertSomeone", inputs }));

  const channels = (value: string[]) => ({
    kind: "literal",
    type: { kind: "list", of: { kind: "primitive", of: "string" } },
    value
  });

  it.each([
    ["one input of a required group", { role: literal("string", "Buyer") }],
    [
      "an in-list literal for a choices input",
      { role: literal("string", "Manager") }
    ],
    [
      "a multi-select whose members are all offered",
      {
        role: literal("string", "Manager"),
        channels: channels(["inApp", "slack"])
      }
    ],
    // A variable's value is unknown until the run, so there is nothing to check.
    [
      "a ref for a choices input",
      { role: ref("trigger", "purchaseOrder", ["status"]) }
    ]
  ])("accepts %s", (_, inputs) => {
    expect(codes(alert(inputs))).toEqual([]);
  });

  it.each([
    [
      "an out-of-list literal for a choices input",
      { role: literal("string", "CEO") },
      "inputs.role"
    ],
    [
      "a member of a multi-select that is not offered",
      {
        role: literal("string", "Manager"),
        channels: channels(["inApp", "carrier-pigeon"])
      },
      "inputs.channels"
    ]
  ])("reports INCOMPLETE_CONFIG for %s", (_, inputs, field) => {
    expect(issuesAt(alert(inputs))).toContainEqual({
      code: "INCOMPLETE_CONFIG",
      field
    });
  });

  it("reports INCOMPLETE_CONFIG for an action with nothing chosen", () => {
    expect(issuesAt(wired(action("a1", { action: "" })))).toEqual([
      { code: "INCOMPLETE_CONFIG", field: "action" }
    ]);
  });

  it("reports INCOMPLETE_CONFIG for an if branch with nothing to check", () => {
    expect(codes(wired(condition("check", [ifPath("p1", [])])))).toEqual([
      "INCOMPLETE_CONFIG"
    ]);
  });

  it("reports INCOMPLETE_CONFIG for a filter with no list chosen", () => {
    expect(issuesAt(wired(filter("f1", { clauses: [] })))).toEqual([
      { code: "INCOMPLETE_CONFIG", field: "source" }
    ]);
  });
});

// A draft is saved as-is, so these shapes reach the validator. Each must parse
// (so autosave never fails) and block publishing (so no half-filled node runs).
describe("half-filled drafts", () => {
  it.each([
    [
      "a condition clause with no right-hand side",
      purchaseOrderWorkflow({
        left: ref("trigger", "purchaseOrder", ["amount"]),
        operator: "gt"
      }),
      "paths.over.clauses.0.right"
    ],
    [
      "a lookup match with a blank field",
      wired(lookup("l1", "part", "one", [{ field: "", operator: "eq" }])),
      "match.0.field"
    ],
    [
      "a lookup match with a named field but no value",
      wired(lookup("l1", "part", "one", [{ field: "name", operator: "eq" }])),
      "match.0.value"
    ]
  ])("parses %s, but blocks publishing", (_, definition, field) => {
    expect(workflowDefinitionSchema.safeParse(definition).success).toBe(true);
    expect(issuesAt(definition)).toEqual([
      { code: "INCOMPLETE_CONFIG", field }
    ]);
  });
});

describe("the current item", () => {
  const overTen = {
    left: item(["unitPrice"]),
    operator: "gt",
    right: literal("number", 10)
  };

  const filterOn = (clauses: unknown[]) =>
    wired(
      lookup("find", "part", "list"),
      filter("f1", { source: ref("find", "result"), clauses })
    );

  it("accepts a filter testing a property of the item it is on", () => {
    expect(codes(filterOn([overTen]))).toEqual([]);
  });

  it("reports ITEM_OUTSIDE_LOOP on a node that works through no list", () => {
    expect(codes(wired(condition("check", [ifPath("p1", [overTen])])))).toEqual(
      ["ITEM_OUTSIDE_LOOP"]
    );
  });

  it("reports UNKNOWN_VARIABLE for a property the items do not have", () => {
    const definition = filterOn([
      { left: item(["nope"]), operator: "eq", right: literal("string", "x") }
    ]);
    expect(codes(definition)).toEqual(["UNKNOWN_VARIABLE"]);
  });

  // ITEM_OUTSIDE_LOOP is suppressed when a deeper cause exists.
  it("reports only UNKNOWN_ENTITY when the list's record type is gone", () => {
    const thin = createFixtureCatalog({ omitEntities: ["part"] });
    expect(codes(filterOn([overTen]), thin)).toEqual(["UNKNOWN_ENTITY"]);
  });

  it("reports only INCOMPLETE_CONFIG when the filter has no list chosen", () => {
    expect(issuesAt(wired(filter("f1", { clauses: [overTen] })))).toEqual([
      { code: "INCOMPLETE_CONFIG", field: "source" }
    ]);
  });

  it("reports only UNKNOWN_ACTION when a repeating action's action is gone", () => {
    const thin = createFixtureCatalog({ omitActions: ["updatePart"] });
    const definition = wired(
      action("a1", { action: "updatePart", inputs: { name: item(["name"]) } })
    );
    expect(codes(definition, thin)).toEqual(["UNKNOWN_ACTION"]);
  });
});

describe("the catalog is injected, not baked in", () => {
  it("reports exactly one UNKNOWN_ACTION, on the step, when notify is missing", () => {
    const thin = createFixtureCatalog({ omitActions: ["notify"] });
    const issues = validateDefinition(purchaseOrderWorkflow(), thin);
    expect(issues.map(({ code, nodeId }) => ({ code, nodeId }))).toEqual([
      { code: "UNKNOWN_ACTION", nodeId: "notify" }
    ]);
  });

  it("reports UNKNOWN_EVENT when the trigger's event is missing", () => {
    const thin = createFixtureCatalog({
      omitEvents: ["purchaseOrder.status.changed"]
    });
    expect(codes(purchaseOrderWorkflow(), thin)).toEqual(["UNKNOWN_EVENT"]);
  });
});

describe("pairs and showWhen", () => {
  const text = (value: string) => literal("string", value);
  const url = text("https://example.com");
  const headers = (...entries: unknown[]) => ({ kind: "pairs", entries });

  const callUrl = (inputs: Record<string, unknown>) =>
    validateDefinition(
      wired(action("call", { action: "callUrl", inputs })),
      catalog
    );

  it.each([
    [
      "named rows on an input declared for them",
      {
        url,
        method: text("POST"),
        body: text("hi"),
        headers: headers({ name: "X-Company-Key", value: text("abc") })
      }
    ],
    ["a gated-off input left empty", { url, method: text("GET") }],
    // A record in a header reads as its readable id, as anywhere else in text.
    [
      "a whole record as a row's value",
      {
        url,
        method: text("GET"),
        headers: headers({
          name: "X-Key",
          value: ref("trigger", "purchaseOrder")
        })
      }
    ],
    [
      "an already-published webhook with only url and body",
      { url, body: text("hi") }
    ]
  ])("accepts %s", (_, inputs) => {
    expect(callUrl(inputs)).toEqual([]);
  });

  it.each([
    [
      "named rows on an input that does not take them",
      { url: headers(), method: text("GET") },
      "TYPE_MISMATCH",
      /does not take a list of names and values/
    ],
    [
      "a plain value on an input that takes named rows",
      { url, method: text("GET"), headers: text("nope") },
      "TYPE_MISMATCH",
      /takes a list of names and values/
    ],
    [
      "a header name Carbon sets itself",
      {
        url,
        method: text("GET"),
        headers: headers({ name: "Host", value: text("evil.example") })
      },
      "INCOMPLETE_CONFIG",
      /is set by Carbon/
    ],
    [
      "a value left behind on a gated-off input",
      { url, method: text("GET"), body: text("leftover") },
      "INCOMPLETE_CONFIG",
      /"body" does not apply when method is "GET"/
    ]
  ])("refuses %s", (_, inputs, code, message) => {
    const [first] = callUrl(inputs);
    expect(first?.code).toBe(code);
    expect(first?.message).toMatch(message);
  });

  it.each([
    [
      "a row with no name",
      headers({ name: "  ", value: text("a") }),
      "INCOMPLETE_CONFIG",
      "headers.entries.0"
    ],
    [
      "the same name set twice, ignoring case",
      headers(
        { name: "X-Key", value: text("a") },
        { name: "x-key", value: text("b") }
      ),
      "INCOMPLETE_CONFIG",
      "headers.entries.1"
    ],
    [
      "a reference to a missing step inside a row",
      headers({ name: "X-Key", value: ref("gone", "record") }),
      "UNKNOWN_VARIABLE",
      "headers.entries.0"
    ]
  ])("reports %s on that row", (_, rows, code, field) => {
    const [first] = callUrl({ url, method: text("GET"), headers: rows });
    expect({ code: first?.code, field: first?.field }).toEqual({ code, field });
  });

  it.each([
    ["a literal that opens the gate", text("POST")],
    [
      "a variable, which may open it",
      ref("trigger", "purchaseOrder", ["status"])
    ]
  ])("requires a gated input when the gating input holds %s", (_, method) => {
    const [first] = callUrl({ url, method });
    expect({ code: first?.code, field: first?.field }).toEqual({
      code: "MISSING_INPUT",
      field: "body"
    });
  });
});
