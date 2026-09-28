import {
  buildSeedWorkflows,
  EVENT_SOURCES,
  SEED_WORKFLOW_BUILDERS
} from "@carbon/database/seed-workflows";
import { describe, expect, it } from "vitest";
import { createWorkflowCatalog } from "./catalog";
import { readWorkflowVersion } from "./definition/normalize";
import { validateDefinition } from "./definition/validate";

// The seed's definitions are hand-written, and a broken one only surfaces as a silently dead
// workflow in someone's local company. The check lives here because @carbon/database cannot
// import this package, but this package already dev-depends on it.

const refs = { ownerId: "usr_seed_owner", issueTypeId: "nct_seed_type" };
const catalog = createWorkflowCatalog();
const workflows = buildSeedWorkflows(refs);

const everyDataset = Object.entries(SEED_WORKFLOW_BUILDERS).flatMap(
  ([key, build]) => build(refs).map((w) => [`${key}: ${w.name}`, w] as const)
);

describe("dev seed workflows", () => {
  it("ships exactly one published workflow", () => {
    expect(workflows.filter((w) => w.published).map((w) => w.name)).toEqual([
      "Assign new sales orders"
    ]);
  });

  it("covers every node type between them", () => {
    const types = new Set(workflows.flatMap((w) => w.nodes.map((n) => n.type)));
    expect([...types].sort()).toEqual([
      "action",
      "compute",
      "condition",
      "filter",
      "lookup",
      "trigger"
    ]);
  });

  it.each(everyDataset)("%s is a valid definition", (_name, workflow) => {
    const read = readWorkflowVersion({
      formatVersion: 4,
      nodes: workflow.nodes,
      edges: workflow.edges
    });
    if (!read.ok) throw new Error(read.message);
    expect(
      validateDefinition(read.definition, catalog).map(
        (issue) =>
          `${issue.code} ${issue.nodeId}.${issue.field ?? ""}: ${issue.message}`
      )
    ).toEqual([]);
  });

  // Tier 11 subscribes each trigger's table from EVENT_SOURCES, which it cannot
  // read from this catalog (package cycle) — so pin the copy to the catalog here.
  it.each(
    Object.entries(EVENT_SOURCES)
  )("EVENT_SOURCES %s matches the catalog event", (eventId, source) => {
    const match = catalog.getEvent(eventId)?.match;
    expect(match).toBeDefined();
    expect(
      match && "table" in match
        ? { table: match.table, operation: match.operation }
        : null
    ).toEqual(source);
  });

  it("has an event source for every seeded trigger event", () => {
    const triggered = everyDataset.flatMap(([, workflow]) =>
      workflow.nodes.flatMap((node) =>
        node.type === "trigger"
          ? ((node.data.events as string[] | undefined) ?? [])
          : []
      )
    );
    expect(triggered.filter((id) => !(id in EVENT_SOURCES))).toEqual([]);
  });
});
