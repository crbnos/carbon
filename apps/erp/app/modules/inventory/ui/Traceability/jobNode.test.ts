import { describe, expect, it } from "vitest";
import type { LineagePayload } from "~/modules/inventory/lineage.server";
import type { TrackedEntity } from "~/modules/inventory/types";
import { getEntityJobId, jobNodeId, withJobNode } from "./jobNode";

const JOB = "job_1";

const seed = (id: string, over: Partial<TrackedEntity> = {}): TrackedEntity =>
  ({
    id,
    readableId: id,
    quantity: 1,
    status: "Reserved",
    itemId: "PART-1",
    sourceDocument: "Item",
    sourceDocumentId: "PART-1",
    sourceDocumentReadableId: "PART-1",
    attributes: { Job: JOB },
    ...over
  }) as TrackedEntity;

const payload = (over: Partial<LineagePayload> = {}): LineagePayload => ({
  entities: [],
  activities: [],
  inputs: [],
  outputs: [],
  ...over
});

/** What startProductionEvent writes: one per operation per unit. */
const productionEvent = (id: string, type: string) =>
  ({
    id,
    type,
    sourceDocument: "Production Event",
    sourceDocumentId: `pe_${id}`,
    attributes: { Job: JOB }
  }) as unknown as LineagePayload["activities"][number];

describe("getEntityJobId", () => {
  it("reads the Job attribute", () => {
    expect(getEntityJobId(seed("e1"))).toBe(JOB);
  });
  it("returns null when there is no Job attribute", () => {
    expect(getEntityJobId(seed("e1", { attributes: {} }))).toBeNull();
  });
  it("tolerates a missing or non-object attributes blob", () => {
    expect(getEntityJobId(undefined)).toBeNull();
    expect(
      getEntityJobId(seed("e1", { attributes: null as never }))
    ).toBeNull();
    expect(
      getEntityJobId(seed("e1", { attributes: ["nope"] as never }))
    ).toBeNull();
  });
});

describe("withJobNode", () => {
  it("anchors seed entities that nothing has produced yet", () => {
    const result = withJobNode(
      payload({ entities: [seed("e1"), seed("e2")] }),
      JOB,
      "JOB-0001"
    );

    expect(result.activities.map((a) => a.id)).toEqual([jobNodeId(JOB)]);
    expect(result.outputs).toEqual([
      { trackedActivityId: jobNodeId(JOB), trackedEntityId: "e1", quantity: 1 },
      { trackedActivityId: jobNodeId(JOB), trackedEntityId: "e2", quantity: 1 }
    ]);
  });

  it("does NOT also claim an entity a real activity already produced", () => {
    // The duplication: the serial had two parents, the production event and
    // the job, reading as two separate origins for one entity.
    const result = withJobNode(
      payload({
        entities: [seed("e1")],
        activities: [productionEvent("pe1", "Weld (Labor)")],
        outputs: [
          { trackedActivityId: "pe1", trackedEntityId: "e1", quantity: 1 }
        ]
      }),
      JOB,
      "JOB-0001"
    );

    expect(result.activities.map((a) => a.id)).toEqual(["pe1"]);
    expect(result.outputs).toEqual([
      { trackedActivityId: "pe1", trackedEntityId: "e1", quantity: 1 }
    ]);
  });

  it("drops the job node entirely once production covers every seed", () => {
    const before = payload({
      entities: [seed("e1"), seed("e2")],
      activities: [productionEvent("pe1", "Weld (Labor)")],
      outputs: [
        { trackedActivityId: "pe1", trackedEntityId: "e1", quantity: 1 },
        { trackedActivityId: "pe1", trackedEntityId: "e2", quantity: 1 }
      ]
    });

    expect(withJobNode(before, JOB, "JOB-0001")).toEqual(before);
  });

  it("keeps every production event — operations are never collapsed", () => {
    const result = withJobNode(
      payload({
        entities: [seed("e1"), seed("e2")],
        activities: [
          productionEvent("pe1", "Weld (Labor)"),
          productionEvent("pe2", "Assemble (Setup)"),
          productionEvent("pe3", "Inspect (Labor)")
        ],
        outputs: [
          { trackedActivityId: "pe1", trackedEntityId: "e1", quantity: 1 }
        ]
      }),
      JOB,
      "JOB-0001"
    );

    // e1 is produced, e2 is not — the job node stays, but only for e2.
    expect(result.activities.map((a) => a.id)).toEqual([
      jobNodeId(JOB),
      "pe1",
      "pe2",
      "pe3"
    ]);
    expect(
      result.outputs.filter((o) => o.trackedActivityId === jobNodeId(JOB))
    ).toEqual([
      { trackedActivityId: jobNodeId(JOB), trackedEntityId: "e2", quantity: 1 }
    ]);
  });

  it("ignores entities belonging to a different job", () => {
    const result = withJobNode(
      payload({
        entities: [seed("e1"), seed("other", { attributes: { Job: "job_2" } })]
      }),
      JOB,
      "JOB-0001"
    );

    expect(result.outputs.map((o) => o.trackedEntityId)).toEqual(["e1"]);
  });

  it("ignores entities that are neither Reserved nor Item-sourced", () => {
    const result = withJobNode(
      payload({
        entities: [
          seed("e1", { status: "Available", sourceDocument: "Receipt" })
        ]
      }),
      JOB,
      "JOB-0001"
    );

    expect(result.outputs).toEqual([]);
    expect(result.activities).toEqual([]);
  });

  it("does not duplicate an existing job node", () => {
    const existing = {
      id: jobNodeId(JOB),
      type: "Job",
      attributes: {}
    } as unknown as LineagePayload["activities"][number];

    const result = withJobNode(
      payload({ entities: [seed("e1")], activities: [existing] }),
      JOB,
      "JOB-0001"
    );

    expect(result.activities).toHaveLength(1);
  });
});
