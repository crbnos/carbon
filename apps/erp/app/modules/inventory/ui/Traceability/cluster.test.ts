import { describe, expect, it } from "vitest";
import type {
  ActivityInput,
  ActivityOutput,
  TrackedEntity
} from "~/modules/inventory";
import { clusterEntities, edgeKey } from "./cluster";

type EntityOverrides = Partial<
  Pick<
    TrackedEntity,
    | "id"
    | "readableId"
    | "quantity"
    | "status"
    | "itemId"
    | "sourceDocumentReadableId"
  >
>;

const entity = (id: string, over: EntityOverrides = {}): TrackedEntity =>
  ({
    id,
    readableId: id,
    quantity: 1,
    status: "Available",
    itemId: "PART-1",
    sourceDocumentReadableId: "PART-1",
    ...over
  }) as TrackedEntity;

const input = (activityId: string, entityId: string, quantity = 1) =>
  ({
    trackedActivityId: activityId,
    trackedEntityId: entityId,
    quantity
  }) satisfies ActivityInput;

const output = (activityId: string, entityId: string, quantity = 1) =>
  ({
    trackedActivityId: activityId,
    trackedEntityId: entityId,
    quantity
  }) satisfies ActivityOutput;

/** Every entity is a single-state candidate unless a test says otherwise. */
const allEligible = (entities: TrackedEntity[]) =>
  new Set(entities.map((e) => e.id));

const run = (
  entities: TrackedEntity[],
  inputs: ActivityInput[],
  outputs: ActivityOutput[],
  opts: Partial<Parameters<typeof clusterEntities>[1]> = {}
) =>
  clusterEntities(
    { entities, inputs, outputs },
    { eligibleIds: allEligible(entities), ...opts }
  );

describe("clusterEntities", () => {
  it("clusters 3 siblings produced by the same job", () => {
    const entities = ["S1", "S2", "S3"].map((id) => entity(id));
    const { clusters, memberToCluster } = run(
      entities,
      [],
      entities.map((e) => output("JOB", e.id))
    );

    expect(clusters).toHaveLength(1);
    expect(clusters[0].members.map((m) => m.id)).toEqual(["S1", "S2", "S3"]);
    expect(clusters[0].readableIdRange).toEqual(["S1", "S3"]);
    expect(clusters[0].signature).toEqual([
      { activityId: "JOB", side: "output" }
    ]);
    expect(memberToCluster).toEqual({
      S1: clusters[0].id,
      S2: clusters[0].id,
      S3: clusters[0].id
    });
  });

  it("leaves 2 siblings ungrouped — below the threshold", () => {
    const entities = ["S1", "S2"].map((id) => entity(id));
    const { clusters, memberToCluster } = run(
      entities,
      [],
      entities.map((e) => output("JOB", e.id))
    );

    expect(clusters).toEqual([]);
    expect(memberToCluster).toEqual({});
  });

  it("splits siblings by status — a rejected serial keeps its own story", () => {
    const entities = [
      entity("S1"),
      entity("S2"),
      entity("S3"),
      entity("S4", { status: "Rejected" }),
      entity("S5", { status: "Rejected" }),
      entity("S6", { status: "Rejected" })
    ];
    const { clusters } = run(
      entities,
      [],
      entities.map((e) => output("JOB", e.id))
    );

    expect(clusters).toHaveLength(2);
    expect(new Set(clusters.map((c) => c.status))).toEqual(
      new Set(["Available", "Rejected"])
    );
    for (const c of clusters) expect(c.members).toHaveLength(3);
  });

  it("splits siblings by item even on the same activity", () => {
    const entities = [
      entity("A1", { itemId: "PART-A", sourceDocumentReadableId: "PART-A" }),
      entity("A2", { itemId: "PART-A", sourceDocumentReadableId: "PART-A" }),
      entity("A3", { itemId: "PART-A", sourceDocumentReadableId: "PART-A" }),
      entity("B1", { itemId: "PART-B", sourceDocumentReadableId: "PART-B" }),
      entity("B2", { itemId: "PART-B", sourceDocumentReadableId: "PART-B" }),
      entity("B3", { itemId: "PART-B", sourceDocumentReadableId: "PART-B" })
    ];
    const { clusters } = run(
      entities,
      [],
      entities.map((e) => output("JOB", e.id))
    );

    expect(clusters).toHaveLength(2);
    expect(clusters.map((c) => c.headline).sort()).toEqual([
      "PART-A",
      "PART-B"
    ]);
  });

  it("never merges different items that share a sourceDocumentReadableId", () => {
    // `sourceDocumentReadableId` is a denormalised display string kept in sync
    // by a trigger; `itemId` is the identity. The documented rule is "same
    // item", so a stale or colliding display string must not merge two items.
    const entities = [
      entity("A1", { itemId: "PART-A", sourceDocumentReadableId: "SHARED" }),
      entity("A2", { itemId: "PART-A", sourceDocumentReadableId: "SHARED" }),
      entity("A3", { itemId: "PART-A", sourceDocumentReadableId: "SHARED" }),
      entity("B1", { itemId: "PART-B", sourceDocumentReadableId: "SHARED" }),
      entity("B2", { itemId: "PART-B", sourceDocumentReadableId: "SHARED" }),
      entity("B3", { itemId: "PART-B", sourceDocumentReadableId: "SHARED" })
    ];
    const { clusters } = run(
      entities,
      [],
      entities.map((e) => output("JOB", e.id))
    );

    expect(clusters).toHaveLength(2);
    for (const c of clusters) expect(c.members).toHaveLength(3);
  });

  it("never clusters the traced root", () => {
    const entities = ["S1", "S2", "S3", "S4"].map((id) => entity(id));
    const { clusters, memberToCluster } = run(
      entities,
      [],
      entities.map((e) => output("JOB", e.id)),
      { excludeIds: new Set(["S2"]) }
    );

    expect(clusters).toHaveLength(1);
    expect(clusters[0].members.map((m) => m.id)).toEqual(["S1", "S3", "S4"]);
    expect(memberToCluster.S2).toBeUndefined();
  });

  it("never clusters quantity != 1 — post-flip batch fragments stay individual", () => {
    const entities = [
      entity("L1", { quantity: 12 }),
      entity("L2", { quantity: 12 }),
      entity("L3", { quantity: 12 })
    ];
    const { clusters } = run(
      entities,
      [],
      entities.map((e) => output("JOB", e.id))
    );

    expect(clusters).toEqual([]);
  });

  it("never clusters an ineligible (multi-state) entity", () => {
    const entities = ["S1", "S2", "S3"].map((id) => entity(id));
    const { clusters } = run(
      entities,
      [],
      entities.map((e) => output("JOB", e.id)),
      { eligibleIds: new Set(["S1", "S2"]) }
    );

    expect(clusters).toEqual([]);
  });

  it("skips entities with no edges", () => {
    const entities = ["S1", "S2", "S3"].map((id) => entity(id));
    const { clusters } = run(entities, [], []);

    expect(clusters).toEqual([]);
  });

  it("sums member quantities per signature edge", () => {
    const entities = ["S1", "S2", "S3", "S4"].map((id) => entity(id));
    const { clusters } = run(
      entities,
      entities.map((e) => input("SHIP", e.id)),
      entities.map((e) => output("JOB", e.id))
    );

    expect(clusters).toHaveLength(1);
    expect(clusters[0].quantitiesByEdge).toEqual({
      [edgeKey("JOB", "output")]: 4,
      [edgeKey("SHIP", "input")]: 4
    });
    expect(clusters[0].signature).toEqual([
      { activityId: "JOB", side: "output" },
      { activityId: "SHIP", side: "input" }
    ]);
  });

  it("splits a mixed fan: shipped siblings cluster apart from produced-only ones", () => {
    const shipped = ["S1", "S2", "S3"].map((id) => entity(id));
    const idle = ["S4", "S5", "S6", "S7"].map((id) => entity(id));
    const entities = [...shipped, ...idle];

    const { clusters } = run(
      entities,
      shipped.map((e) => input("SHIP", e.id)),
      entities.map((e) => output("JOB", e.id))
    );

    expect(clusters).toHaveLength(2);
    const bySize = [...clusters].sort(
      (a, b) => a.members.length - b.members.length
    );
    expect(bySize[0].members.map((m) => m.id)).toEqual(["S1", "S2", "S3"]);
    expect(bySize[0].signature).toHaveLength(2);
    expect(bySize[1].members.map((m) => m.id)).toEqual([
      "S4",
      "S5",
      "S6",
      "S7"
    ]);
    expect(bySize[1].signature).toEqual([
      { activityId: "JOB", side: "output" }
    ]);
  });

  it("is insensitive to input/output row order", () => {
    const entities = ["S1", "S2", "S3"].map((id) => entity(id));
    const forward = run(
      entities,
      [input("SHIP", "S1"), input("SHIP", "S2"), input("SHIP", "S3")],
      [output("JOB", "S1"), output("JOB", "S2"), output("JOB", "S3")]
    );
    const reversed = run(
      entities,
      [input("SHIP", "S3"), input("SHIP", "S2"), input("SHIP", "S1")],
      [output("JOB", "S3"), output("JOB", "S2"), output("JOB", "S1")]
    );

    expect(reversed.clusters[0].id).toBe(forward.clusters[0].id);
    expect(reversed.clusters[0].members).toEqual(forward.clusters[0].members);
  });

  it("honours a custom threshold", () => {
    const entities = ["S1", "S2"].map((id) => entity(id));
    const { clusters } = run(
      entities,
      [],
      entities.map((e) => output("JOB", e.id)),
      { threshold: 2 }
    );

    expect(clusters).toHaveLength(1);
  });

  it("ignores duplicate entity rows in the payload", () => {
    const entities = [entity("S1"), entity("S1"), entity("S2"), entity("S3")];
    const { clusters } = run(
      entities,
      [],
      [output("JOB", "S1"), output("JOB", "S2"), output("JOB", "S3")]
    );

    expect(clusters).toHaveLength(1);
    expect(clusters[0].members.map((m) => m.id)).toEqual(["S1", "S2", "S3"]);
  });
});
