import { describe, expect, it } from "vitest";
import type { Activity, TrackedEntity } from "~/modules/inventory";
import { isClusterId } from "./cluster";
import { type LineagePayload, payloadToFlow } from "./utils";

const T0 = "2026-08-01T10:00:00.000Z";
const T1 = "2026-08-01T11:00:00.000Z";

const serial = (id: string, over: Partial<TrackedEntity> = {}): TrackedEntity =>
  ({
    id,
    readableId: id,
    quantity: 1,
    status: "Available",
    itemId: "PART-1",
    sourceDocumentReadableId: "PART-1",
    attributes: {},
    ...over
  }) as TrackedEntity;

const activity = (id: string, type: string, createdAt = T0): Activity => ({
  id,
  type,
  attributes: {},
  createdAt
});

const flow = (payload: Partial<LineagePayload>, rootIds: string[] = []) =>
  payloadToFlow(
    {
      entities: [],
      activities: [],
      inputs: [],
      outputs: [],
      ...payload
    },
    undefined,
    { rootIds }
  );

describe("payloadToFlow clustering", () => {
  it("emits one group node with a single summed edge for a serial fan", () => {
    const entities = ["S1", "S2", "S3", "S4", "S5"].map((id) => serial(id));
    const { nodes, edges, clusters } = flow({
      entities,
      activities: [activity("JOB", "Manufacturing")],
      outputs: entities.map((e) => ({
        trackedActivityId: "JOB",
        trackedEntityId: e.id,
        quantity: 1
      }))
    });

    expect(clusters).toHaveLength(1);
    const groupNodes = nodes.filter((n) => n.type === "entityGroup");
    expect(groupNodes).toHaveLength(1);
    expect(isClusterId(groupNodes[0].id)).toBe(true);
    // The job plus the group — no member nodes.
    expect(nodes).toHaveLength(2);

    expect(edges).toHaveLength(1);
    expect(edges[0].source).toBe("JOB");
    expect(edges[0].target).toBe(groupNodes[0].id);
    expect(edges[0].data?.quantity).toBe(5);
    expect(edges[0].data?.kind).toBe("output");
  });

  it("keeps the traced root as its own node", () => {
    const entities = ["S1", "S2", "S3", "S4"].map((id) => serial(id));
    const { nodes, clusters } = flow(
      {
        entities,
        activities: [activity("JOB", "Manufacturing")],
        outputs: entities.map((e) => ({
          trackedActivityId: "JOB",
          trackedEntityId: e.id,
          quantity: 1
        }))
      },
      ["S1"]
    );

    expect(clusters[0].members).toHaveLength(3);
    expect(nodes.map((n) => n.id)).toContain("S1");
    expect(nodes.filter((n) => n.type === "entityGroup")).toHaveLength(1);
  });

  it("clusters a produced-then-consumed fan (still one timeline state)", () => {
    const entities = ["S1", "S2", "S3"].map((id) => serial(id));
    const { nodes, edges, clusters } = flow({
      entities,
      activities: [
        activity("JOB", "Manufacturing", T0),
        activity("SHIP", "Shipment", T1)
      ],
      outputs: entities.map((e) => ({
        trackedActivityId: "JOB",
        trackedEntityId: e.id,
        quantity: 1
      })),
      inputs: entities.map((e) => ({
        trackedActivityId: "SHIP",
        trackedEntityId: e.id,
        quantity: 1
      }))
    });

    expect(clusters).toHaveLength(1);
    const groupId = clusters[0].id;
    expect(nodes.filter((n) => n.type === "entity")).toHaveLength(0);
    expect(edges).toHaveLength(2);
    expect(edges.find((e) => e.target === groupId)?.source).toBe("JOB");
    expect(edges.find((e) => e.source === groupId)?.target).toBe("SHIP");
    for (const e of edges) expect(e.data?.quantity).toBe(3);
  });

  it("leaves bin-transferred serials individual — their timeline has 2 states", () => {
    const entities = ["S1", "S2", "S3"].map((id) => serial(id));
    const { nodes, clusters } = flow({
      entities,
      activities: [
        activity("JOB", "Manufacturing", T0),
        activity("MOVE", "Transfer", T1)
      ],
      outputs: entities.map((e) => ({
        trackedActivityId: "JOB",
        trackedEntityId: e.id,
        quantity: 1
      })),
      inputs: entities.map((e) => ({
        trackedActivityId: "MOVE",
        trackedEntityId: e.id,
        quantity: 1
      }))
    });

    expect(clusters).toEqual([]);
    expect(nodes.filter((n) => n.type === "entityGroup")).toHaveLength(0);
    expect(nodes.filter((n) => n.type === "entity").length).toBeGreaterThan(3);
  });

  it("is unchanged from today's rendering when nothing clusters", () => {
    const entities = ["S1", "S2"].map((id) => serial(id));
    const payload = {
      entities,
      activities: [activity("JOB", "Manufacturing")],
      outputs: entities.map((e) => ({
        trackedActivityId: "JOB",
        trackedEntityId: e.id,
        quantity: 1
      }))
    };

    const { nodes, edges, clusters, memberToCluster } = flow(payload);

    expect(clusters).toEqual([]);
    expect(memberToCluster).toEqual({});
    expect(nodes.map((n) => n.id).sort()).toEqual(["JOB", "S1", "S2"]);
    // Timeline-driven edge ids, state-suffixed — exactly as before clustering.
    expect(edges.map((e) => e.id).sort()).toEqual([
      "out:JOB:S1@0",
      "out:JOB:S2@0"
    ]);
  });

  it("does not cluster a batch lot fan — quantity is not 1", () => {
    const entities = ["L1", "L2", "L3"].map((id) =>
      serial(id, { quantity: 12 })
    );
    const { clusters } = flow({
      entities,
      activities: [activity("JOB", "Manufacturing")],
      outputs: entities.map((e) => ({
        trackedActivityId: "JOB",
        trackedEntityId: e.id,
        quantity: 12
      }))
    });

    expect(clusters).toEqual([]);
  });
});
