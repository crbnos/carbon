import { describe, expect, it } from "vitest";
import { describeStep } from "./describe";
import { groupComponentNodeIds, indexAssemblyGraph } from "./graph";
import type { AssemblyGraph, AssemblyGraphNode } from "./types";

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function leaf(
  nodeId: string,
  name: string,
  geometryHash: string | null
): AssemblyGraphNode {
  return {
    nodeId,
    name,
    isAssembly: false,
    geometryHash,
    transform: IDENTITY,
    bbox: { min: [0, 0, 0], max: [10, 20, 30] },
    volume: 1000,
    color: [0.5, 0.5, 0.5, 1],
    children: []
  };
}

function assembly(
  nodeId: string,
  name: string,
  children: AssemblyGraphNode[]
): AssemblyGraphNode {
  return {
    nodeId,
    name,
    isAssembly: true,
    geometryHash: null,
    transform: IDENTITY,
    bbox: { min: [0, 0, 0], max: [10, 20, 30] },
    volume: null,
    color: null,
    children
  };
}

const graph: AssemblyGraph = {
  version: 1,
  unit: "mm",
  sourceUnit: "mm",
  componentCount: 5,
  root: assembly("root", "Assembly", [
    leaf("bolt-1", "M8 Bolt", "hash-bolt"),
    leaf("bolt-2", "M8 Bolt", "hash-bolt"),
    assembly("sub", "Bracket Sub", [
      leaf("bolt-3", "M8 Bolt", "hash-bolt"),
      leaf("plate-1", "Base Plate", "hash-plate")
    ]),
    leaf("gasket-1", "Gasket", null)
  ])
};

describe("indexAssemblyGraph", () => {
  const index = indexAssemblyGraph(graph);

  it("indexes every node by nodeId", () => {
    expect(index.nodesById.size).toBe(7);
    expect(index.nodesById.get("sub")?.isAssembly).toBe(true);
  });

  it("collects leaves depth-first", () => {
    expect(index.leaves.map((node) => node.nodeId)).toEqual([
      "bolt-1",
      "bolt-2",
      "bolt-3",
      "plate-1",
      "gasket-1"
    ]);
  });

  it("groups identical geometry across subassemblies", () => {
    const bolts = index.groups.find((group) => group.key === "hash-bolt");
    expect(bolts?.count).toBe(3);
    expect(bolts?.nodeIds).toEqual(["bolt-1", "bolt-2", "bolt-3"]);
  });

  it("falls back to a name key for leaves without a geometry hash", () => {
    const gasket = index.groupByNodeId.get("gasket-1");
    expect(gasket?.key).toBe("name:Gasket");
    expect(gasket?.count).toBe(1);
  });
});

describe("groupComponentNodeIds", () => {
  const index = indexAssemblyGraph(graph);

  it("groups only the given ids", () => {
    const groups = groupComponentNodeIds(
      ["bolt-1", "bolt-3", "plate-1"],
      index
    );
    expect(groups.map((group) => [group.name, group.count])).toEqual([
      ["M8 Bolt", 2],
      ["Base Plate", 1]
    ]);
  });

  it("skips unknown/stale nodeIds", () => {
    const groups = groupComponentNodeIds(["bolt-1", "gone-1"], index);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.count).toBe(1);
  });

  it("does not mutate the index groups", () => {
    groupComponentNodeIds(["bolt-1"], index);
    const bolts = index.groups.find((group) => group.key === "hash-bolt");
    expect(bolts?.count).toBe(3);
  });
});

describe("describeStep", () => {
  const index = indexAssemblyGraph(graph);

  it("uses an explicit title verbatim", () => {
    expect(
      describeStep(
        {
          title: "Torque the head",
          componentNodeIds: ["bolt-1"],
          fastener: null
        },
        index
      )
    ).toBe("Torque the head");
  });

  it("describes a single component", () => {
    expect(
      describeStep(
        { title: null, componentNodeIds: ["plate-1"], fastener: null },
        index
      )
    ).toBe("Add Base Plate");
  });

  it("counts duplicate components and appends the fastener spec", () => {
    expect(
      describeStep(
        {
          title: null,
          componentNodeIds: ["bolt-1", "bolt-2", "bolt-3"],
          fastener: { spec: "M8 SHCS", count: 3 }
        },
        index
      )
    ).toBe("Add M8 Bolt (×3), M8 SHCS (×3)");
  });

  it("uses Assemble for multiple distinct components", () => {
    expect(
      describeStep(
        {
          title: null,
          componentNodeIds: ["plate-1", "gasket-1"],
          fastener: null
        },
        index
      )
    ).toBe("Assemble Base Plate, Gasket");
  });

  it("uses Install for fastener-only steps", () => {
    expect(
      describeStep(
        {
          title: null,
          componentNodeIds: [],
          fastener: { spec: "M5 SHCS", count: 4 }
        },
        index
      )
    ).toBe("Install M5 SHCS (×4)");
  });

  it("returns null when there is nothing to describe", () => {
    expect(
      describeStep({ title: null, componentNodeIds: [], fastener: null }, index)
    ).toBeNull();
    expect(
      describeStep(
        { title: null, componentNodeIds: ["gone"], fastener: null },
        index
      )
    ).toBeNull();
    expect(
      describeStep(
        { title: null, componentNodeIds: ["bolt-1"], fastener: null },
        null
      )
    ).toBeNull();
  });
});

describe("describeStep with named subassembly units", () => {
  const index = indexAssemblyGraph(graph);
  const units = [
    { name: "Bracket Sub", componentNodeIds: ["plate-1", "bolt-3"] }
  ];

  it("titles a step by the unit name when its components match the unit", () => {
    expect(
      describeStep(
        {
          title: null,
          componentNodeIds: ["bolt-3", "plate-1"],
          fastener: null
        },
        index,
        units
      )
    ).toBe("Add Bracket Sub");
  });

  it("matches on the set, ignoring order and duplicates", () => {
    expect(
      describeStep(
        {
          title: null,
          componentNodeIds: ["plate-1", "bolt-3", "plate-1"],
          fastener: null
        },
        index,
        units
      )
    ).toBe("Add Bracket Sub");
  });

  it("appends the fastener spec to the unit name", () => {
    expect(
      describeStep(
        {
          title: null,
          componentNodeIds: ["plate-1", "bolt-3"],
          fastener: { spec: "M5 SHCS", count: 4 }
        },
        index,
        units
      )
    ).toBe("Add Bracket Sub, M5 SHCS (×4)");
  });

  it("still lets an explicit title win over a unit match", () => {
    expect(
      describeStep(
        {
          title: "Seat the bracket",
          componentNodeIds: ["plate-1", "bolt-3"],
          fastener: null
        },
        index,
        units
      )
    ).toBe("Seat the bracket");
  });

  it("falls back to enumerating components when the set does not match a unit", () => {
    // A superset of the unit (extra bolt) is not the unit → enumerate.
    expect(
      describeStep(
        {
          title: null,
          componentNodeIds: ["plate-1", "bolt-3", "bolt-1"],
          fastener: null
        },
        index,
        units
      )
    ).toBe("Assemble Base Plate, M8 Bolt (×2)");
  });
});
