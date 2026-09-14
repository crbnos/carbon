import { describe, expect, it } from "vitest";
import type { BomViewLine } from "./bom-view";
import {
  bomParentIndexes,
  bomViewLevel,
  buildBomViewTree,
  visibleBomRows
} from "./bom-view";

function line(
  index: string,
  partNumber: string | null,
  quantity = 1
): BomViewLine {
  return { index, partNumber, quantity };
}

/**
 * One sub-assembly used twice, with a bracket shared between it and the top
 * level — the shape that separates a correct roll-up from a wrong one.
 */
const lines: BomViewLine[] = [
  line("1", "PLATE-1", 2),
  line("2", "SUB-1", 3),
  line("2.1", "BRACKET", 4),
  line("2.2", "SCREW", 10),
  line("3", "BRACKET", 1)
];

describe("bomViewLevel", () => {
  it("counts the dots", () => {
    expect(bomViewLevel("1")).toBe(1);
    expect(bomViewLevel("2.1")).toBe(2);
    expect(bomViewLevel("2.1.3")).toBe(3);
  });

  it("treats an empty index as top level", () => {
    expect(bomViewLevel("")).toBe(1);
  });
});

describe("buildBomViewTree", () => {
  it("nests children under the parent named by their index", () => {
    const tree = buildBomViewTree(lines);
    expect(tree.map((node) => node.line.index)).toEqual(["1", "2", "3"]);
    expect(tree[1]?.children.map((node) => node.line.index)).toEqual([
      "2.1",
      "2.2"
    ]);
  });

  it("orders rows numerically, not lexically", () => {
    const tree = buildBomViewTree([
      line("10", "TEN"),
      line("2", "TWO"),
      line("1", "ONE")
    ]);
    expect(tree.map((node) => node.line.partNumber)).toEqual([
      "ONE",
      "TWO",
      "TEN"
    ]);
  });

  it("builds the same tree whatever order the lines arrive in", () => {
    const shuffled = [
      line("2.1", "BRACKET", 4),
      line("3", "BRACKET", 1),
      line("1", "PLATE-1", 2),
      line("2.2", "SCREW", 10),
      line("2", "SUB-1", 3)
    ];
    expect(buildBomViewTree(shuffled)).toEqual(buildBomViewTree(lines));
  });

  it("keeps a line whose parent never appeared, at the top level", () => {
    const tree = buildBomViewTree([line("1", "A"), line("4.2", "ORPHAN")]);
    expect(tree.map((node) => node.line.index)).toEqual(["1", "4.2"]);
  });
});

describe("visibleBomRows", () => {
  it("shows only the top level when nothing is open", () => {
    const rows = visibleBomRows(buildBomViewTree(lines), new Set());
    expect(rows.map((row) => row.line.index)).toEqual(["1", "2", "3"]);
    expect(rows.map((row) => row.level)).toEqual([1, 1, 1]);
  });

  it("marks a sub-assembly with what opening it reveals", () => {
    const rows = visibleBomRows(buildBomViewTree(lines), new Set());
    const sub = rows.find((row) => row.line.index === "2");
    expect(sub).toMatchObject({
      hasChildren: true,
      descendantCount: 2,
      open: false
    });
    expect(rows[0]).toMatchObject({ hasChildren: false, descendantCount: 0 });
  });

  it("reveals the subtree of an open sub-assembly, indented", () => {
    const rows = visibleBomRows(buildBomViewTree(lines), new Set(["2"]));
    expect(rows.map((row) => [row.line.index, row.level])).toEqual([
      ["1", 1],
      ["2", 1],
      ["2.1", 2],
      ["2.2", 2],
      ["3", 1]
    ]);
  });

  it("ignores an open index inside a closed parent", () => {
    const deep = [...lines, line("2.1.1", "PIN")];
    const rows = visibleBomRows(buildBomViewTree(deep), new Set(["2.1"]));
    expect(rows.map((row) => row.line.index)).toEqual(["1", "2", "3"]);
  });

  it("counts descendants at every depth", () => {
    const deep = [...lines, line("2.1.1", "PIN"), line("2.1.2", "WASHER")];
    const rows = visibleBomRows(buildBomViewTree(deep), new Set(["2"]));
    expect(rows.find((row) => row.line.index === "2")?.descendantCount).toBe(4);
    expect(rows.find((row) => row.line.index === "2.1")?.descendantCount).toBe(
      2
    );
  });
});

describe("bomParentIndexes", () => {
  it("lists every sub-assembly, at any depth", () => {
    const deep = [...lines, line("2.1.1", "PIN")];
    expect(bomParentIndexes(buildBomViewTree(deep))).toEqual(["2", "2.1"]);
  });

  it("is empty for a flat BOM", () => {
    expect(bomParentIndexes(buildBomViewTree([line("1", "A")]))).toEqual([]);
  });
});
