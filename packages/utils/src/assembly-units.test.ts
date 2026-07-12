import { describe, expect, it } from "vitest";
import {
  deriveAssemblyUnits,
  distinctComponentNames,
  type UnitGraph,
  type UnitGraphNode
} from "./assembly-units";

function leaf(
  nodeId: string,
  name: string,
  geometryHash: string,
  bbox?: UnitGraphNode["bbox"]
): UnitGraphNode {
  return { nodeId, name, isAssembly: false, geometryHash, bbox, children: [] };
}

// A tiny PCB component at a spread board position: a 1mm solid at x = i*10, so a
// swarm of them spans the board while each sits far below the swarm's tiny-size
// threshold — the real shape of a populated PCB (vs substantial mech parts).
function pcbLeaf(i: number, name: string, geometryHash: string): UnitGraphNode {
  return leaf(`pcb-${i}`, name, geometryHash, {
    min: [i * 10, 0, 0],
    max: [i * 10 + 1, 1, 1]
  });
}

function flat(children: UnitGraphNode[]): UnitGraph {
  return {
    root: {
      nodeId: "root",
      name: "Assembly",
      isAssembly: true,
      geometryHash: null,
      children
    }
  };
}

describe("deriveAssemblyUnits", () => {
  it("gives an unmatched flat model one loose unit per leaf", () => {
    const graph = flat([
      leaf("a", "Bracket", "h1"),
      leaf("b", "Screw", "h2"),
      leaf("c", "Cover", "h3")
    ]);
    const units = deriveAssemblyUnits({
      graph,
      bomMaterials: [],
      componentMappings: [],
      authoredUnits: []
    });
    expect(units).toHaveLength(3);
    expect(units.every((u) => u.source === "loose")).toBe(true);
    expect(units.map((u) => u.id).sort()).toEqual(["a", "b", "c"]);
  });

  // A flat SA-BCU-like model: a populated PCB (qty 1) shown as many TINY
  // component solids, plus 8 screws (qty 8) and a single seal (qty 1). What
  // marks the 300 passives a detail swarm to collapse is their SIZE — each far
  // below the board's extent — not geometry hashes (world-space, so each hashes
  // distinctly). A mechanical subassembly of substantial parts would not.
  const bcuGraph = () =>
    flat([
      leaf("seal", "Seal Electronics Box", "hseal"),
      ...Array.from({ length: 8 }, (_, i) =>
        leaf(`screw-${i}`, "Flanged Screw", `hscrew`)
      ),
      ...Array.from({ length: 300 }, (_, i) =>
        pcbLeaf(i, `R_0402_${i}`, `hr${i}`)
      )
    ]);
  const bcuBom = [
    { itemId: "i_seal", name: "Seal Electronics Box", quantity: 1 },
    { itemId: "i_screw", name: "Flanged Screws", quantity: 8 },
    { itemId: "i_pcb", name: "BCU PCB", quantity: 1 }
  ];
  // The LLM assigns each distinct component name to a BOM line.
  const bcuMatches = [
    { name: "Seal Electronics Box", itemId: "i_seal" },
    { name: "Flanged Screw", itemId: "i_screw" },
    ...Array.from({ length: 300 }, (_, i) => ({
      name: `R_0402_${i}`,
      itemId: "i_pcb"
    }))
  ];

  it("collapses the qty-1 PCB into one rigid unit but keeps 8 screws separate", () => {
    const units = deriveAssemblyUnits({
      graph: bcuGraph(),
      bomMaterials: bcuBom,
      componentMappings: [],
      authoredUnits: [],
      componentMatches: bcuMatches
    });

    const pcb = units.find((u) => u.id === "unit:i_pcb");
    expect(pcb?.nodeIds).toHaveLength(300);
    expect(pcb?.name).toBe("BCU PCB");
    expect(pcb?.source).toBe("bom");

    // 8 screws stay as 8 separate components (qty 8, not merged).
    const screws = units.filter((u) => u.itemId === "i_screw");
    expect(screws).toHaveLength(8);
    expect(screws.every((u) => u.nodeIds.length === 1)).toBe(true);

    // Seal is a lone matched component.
    const seal = units.find((u) => u.id === "seal");
    expect(seal?.itemId).toBe("i_seal");

    // 1 PCB unit + 8 screws + 1 seal.
    expect(units).toHaveLength(10);
  });

  it("does not collapse a qty>1 line even with many leaves", () => {
    const graph = flat(
      Array.from({ length: 12 }, (_, i) => leaf(`s-${i}`, "Screw", "hs"))
    );
    const units = deriveAssemblyUnits({
      graph,
      bomMaterials: [{ itemId: "i", name: "Screw", quantity: 12 }],
      componentMappings: [],
      authoredUnits: [],
      componentMatches: [{ name: "Screw", itemId: "i" }]
    });
    expect(units).toHaveLength(12);
    expect(units.every((u) => u.nodeIds.length === 1)).toBe(true);
  });

  it("does not collapse a qty-1 line whose leaves are each a distinct part", () => {
    // A mechanical subassembly: 30 SUBSTANTIAL parts (each ~40mm, a real chunk
    // of the subassembly), one leaf each, folded to one line — must NOT become a
    // single 30-part fade-in step (regression: the engine's 52-part first step).
    // Size, not part count, is why this stays split while a same-count PCB folds.
    const graph = flat(
      Array.from({ length: 30 }, (_, i) =>
        leaf(`p-${i}`, `Part${i}`, `hp${i}`, {
          min: [i * 10, 0, 0],
          max: [i * 10 + 40, 40, 40]
        })
      )
    );
    const units = deriveAssemblyUnits({
      graph,
      bomMaterials: [
        { itemId: "i_asm", name: "Cylinder Subassembly", quantity: 1 }
      ],
      componentMappings: Array.from({ length: 30 }, (_, i) => ({
        geometryHash: `hp${i}`,
        itemId: `i_part${i}`
      })),
      authoredUnits: [],
      lineByItem: Object.fromEntries(
        Array.from({ length: 30 }, (_, i) => [`i_part${i}`, "i_asm"])
      )
    });
    expect(units).toHaveLength(30);
    expect(units.every((u) => u.nodeIds.length === 1)).toBe(true);
  });

  it("prefers an exact geometry↔BOM mapping over the LLM name assignment", () => {
    const graph = flat([leaf("a", "Widget", "hA"), leaf("b", "Widget", "hB")]);
    const units = deriveAssemblyUnits({
      graph,
      bomMaterials: [
        { itemId: "i_map", name: "Mapped", quantity: 1 },
        { itemId: "i_llm", name: "Guessed", quantity: 1 }
      ],
      // Exact mapping says hA → i_map; the LLM guesses the name → i_llm.
      componentMappings: [{ geometryHash: "hA", itemId: "i_map" }],
      authoredUnits: [],
      componentMatches: [{ name: "Widget", itemId: "i_llm" }]
    });
    expect(units.find((u) => u.id === "a")?.itemId).toBe("i_map");
    expect(units.find((u) => u.id === "b")?.itemId).toBe("i_llm");
  });

  it("honors an authored unit and removes its leaves from the automatic pass", () => {
    const graph = flat([
      leaf("a", "Bracket", "h1"),
      leaf("b", "Screw", "h2"),
      leaf("c", "Washer", "h3")
    ]);
    const units = deriveAssemblyUnits({
      graph,
      bomMaterials: [],
      componentMappings: [],
      authoredUnits: [
        { id: "unit-1", name: "Fastener Kit", componentNodeIds: ["b", "c"] }
      ]
    });
    const authored = units.find((u) => u.id === "unit-1");
    expect(authored?.source).toBe("authored");
    expect(authored?.nodeIds.sort()).toEqual(["b", "c"]);
    expect(units.filter((u) => u.nodeIds.includes("b"))).toHaveLength(1);
    expect(units.find((u) => u.id === "a")?.source).toBe("loose");
  });

  it("summarizes distinct component names with counts for the matcher", () => {
    const names = distinctComponentNames(bcuGraph());
    const byName = new Map(names.map((n) => [n.name, n.count]));
    expect(byName.get("Flanged Screw")).toBe(8);
    expect(byName.get("Seal Electronics Box")).toBe(1);
    // 300 distinct R_0402_* names + screw + seal.
    expect(names).toHaveLength(302);
  });

  it("folds leaves mapped to nested-subassembly items into the top-level line's unit", () => {
    // The bare board and its connector are geometry-mapped to items that live
    // INSIDE the "BCU PCB" line's Make BOM — without lineByItem they escape
    // the populated-PCB unit and the component swarm installs with nothing
    // to mate to.
    const graph = flat([
      leaf("board", "minimalBCU_gen2_PCB", "hboard"),
      leaf("conn", "C-1-776163-1", "hconn"),
      // 10 tiny passives spread across the board → a detail swarm.
      ...Array.from({ length: 10 }, (_, i) =>
        pcbLeaf(i, `R_0402_${i}`, `hr${i}`)
      )
    ]);
    const bom = [{ itemId: "i_pcb", name: "BCU PCB", quantity: 1 }];
    const matches = Array.from({ length: 10 }, (_, i) => ({
      name: `R_0402_${i}`,
      itemId: "i_pcb"
    }));
    const mappings = [
      { geometryHash: "hboard", itemId: "i_bareboard" },
      { geometryHash: "hconn", itemId: "i_connector" }
    ];

    const without = deriveAssemblyUnits({
      graph,
      bomMaterials: bom,
      componentMappings: mappings,
      authoredUnits: [],
      componentMatches: matches
    });
    expect(without.find((u) => u.id === "unit:i_pcb")?.nodeIds).toHaveLength(
      10
    );

    const withAliases = deriveAssemblyUnits({
      graph,
      bomMaterials: bom,
      componentMappings: mappings,
      authoredUnits: [],
      componentMatches: matches,
      lineByItem: { i_bareboard: "i_pcb", i_connector: "i_pcb" }
    });
    const unit = withAliases.find((u) => u.id === "unit:i_pcb");
    expect(unit?.nodeIds).toHaveLength(12);
    expect(unit?.nodeIds).toContain("board");
    expect(unit?.nodeIds).toContain("conn");
  });
});
