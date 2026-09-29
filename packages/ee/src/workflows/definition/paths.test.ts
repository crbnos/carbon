import { describe, expect, it } from "vitest";
import { pathLabel } from "./paths";
import type { ConditionPath } from "./schema";

function makePath(id: string, kind: ConditionPath["kind"]): ConditionPath {
  return { id, kind, combinator: "and", clauses: [] };
}

describe("pathLabel", () => {
  const paths: ConditionPath[] = [
    makePath("p0", "if"),
    makePath("p1", "elseIf"),
    makePath("p2", "elseIf"),
    makePath("pe", "else")
  ];

  it("returns indexed:0 for the if path", () => {
    expect(pathLabel(paths, "p0")).toEqual({ kind: "indexed", index: 0 });
  });

  it("returns indexed:1 for the first elseIf", () => {
    expect(pathLabel(paths, "p1")).toEqual({ kind: "indexed", index: 1 });
  });

  it("returns indexed:2 for the second elseIf", () => {
    expect(pathLabel(paths, "p2")).toEqual({ kind: "indexed", index: 2 });
  });

  it("returns else for the else path", () => {
    expect(pathLabel(paths, "pe")).toEqual({ kind: "else" });
  });

  it("renumbers when the middle elseIf is removed", () => {
    const trimmed = paths.filter((p) => p.id !== "p1");
    expect(pathLabel(trimmed, "p2")).toEqual({ kind: "indexed", index: 1 });
  });

  it("returns indexed:-1 for an unknown pathId", () => {
    expect(pathLabel(paths, "unknown")).toEqual({ kind: "indexed", index: -1 });
  });
});
