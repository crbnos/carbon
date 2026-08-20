import { buildSeedWorkflows } from "@carbon/database/seed-workflows";
import { describe, expect, it } from "vitest";
import { createWorkflowCatalog } from "./catalog";
import { readWorkflowVersion } from "./definition/normalize";
import { validateDefinition } from "./definition/validate";

// The seed's definitions are hand-written, and a broken one only surfaces as a silently dead
// workflow in someone's local company. The check lives here because @carbon/database cannot
// import this package, but this package already dev-depends on it.

const catalog = createWorkflowCatalog();
const workflows = buildSeedWorkflows({
  ownerId: "usr_seed_owner",
  issueTypeId: "nct_seed_type"
});

describe("dev seed workflows", () => {
  it("ships exactly one active workflow", () => {
    expect(workflows.filter((w) => w.active).map((w) => w.name)).toEqual([
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

  it.each(
    workflows.map((w) => [w.name, w] as const)
  )("%s is a valid definition", (_name, workflow) => {
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
});
