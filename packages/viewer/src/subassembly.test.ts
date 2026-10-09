// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  arrivalIndexByNode,
  buildCarryPlans,
  buildSubAssemblyPlan,
  displayOrder,
  subAssemblyPartIds,
  usableSubAssemblies,
  validateSubAssemblies,
  worldOf
} from "./subassembly";
import type { AssemblyStep, Motion } from "./types";

type Row = Pick<
  AssemblyStep,
  "id" | "componentNodeIds" | "parentStepId" | "usedInStepId" | "isSubAssembly"
>;

const step = (
  id: string,
  parts: string[] = [],
  extra: Partial<Row> = {}
): Row => ({ id, componentNodeIds: parts, ...extra });

// Play order. Drive Train (1.1–1.3) is used by 4.2; Heel Module (4.1–4.2)
// joins the main build.
const example: Row[] = [
  step("plate", ["plate"], { parentStepId: "drive" }),
  step("pinion", ["pinion"], { parentStepId: "drive" }),
  step("idler", ["idler"], { parentStepId: "drive" }),
  step("drive", [], { isSubAssembly: true, usedInStepId: "fit" }),
  step("sole", ["sole"]),
  step("counter", ["counter"]),
  step("shell", ["shell"], { parentStepId: "heel" }),
  step("fit", ["battery"], { parentStepId: "heel" }),
  step("heel", [], { isSubAssembly: true }),
  step("upper", ["upper"])
];

describe("displayOrder", () => {
  it("puts each header above its members", () => {
    expect(displayOrder(example)).toEqual([
      { stepId: "drive", depth: 0 },
      { stepId: "plate", depth: 1 },
      { stepId: "pinion", depth: 1 },
      { stepId: "idler", depth: 1 },
      { stepId: "sole", depth: 0 },
      { stepId: "counter", depth: 0 },
      { stepId: "heel", depth: 0 },
      { stepId: "shell", depth: 1 },
      { stepId: "fit", depth: 1 },
      { stepId: "upper", depth: 0 }
    ]);
  });

  it("shows an empty sub-assembly at its own place", () => {
    const rows = displayOrder([
      step("a", ["a"]),
      step("empty", [], { isSubAssembly: true }),
      step("b", ["b"])
    ]);
    expect(rows.map((r) => r.stepId)).toEqual(["a", "empty", "b"]);
  });

  it("lists a header once when it is stored before its members", () => {
    const rows = displayOrder([
      step("unit", [], { isSubAssembly: true }),
      step("a", ["a"], { parentStepId: "unit" }),
      step("b", ["b"], { parentStepId: "unit" })
    ]);
    expect(rows).toEqual([
      { stepId: "unit", depth: 0 },
      { stepId: "a", depth: 1 },
      { stepId: "b", depth: 1 }
    ]);
  });
});

describe("buildSubAssemblyPlan", () => {
  const plan = buildSubAssemblyPlan(example);

  it("numbers top-level items and members", () => {
    const numbers = Object.fromEntries(
      [...plan.values()].map((info) => [info.stepId, info.number])
    );
    expect(numbers).toEqual({
      drive: "1",
      plate: "1.1",
      pinion: "1.2",
      idler: "1.3",
      sole: "2",
      counter: "3",
      heel: "4",
      shell: "4.1",
      fit: "4.2",
      upper: "5"
    });
  });

  it("a used header does not play; an unused one joins the main build", () => {
    expect(plan.get("drive")?.plays).toBe(false);
    expect(plan.get("heel")?.plays).toBe(true);
    expect(plan.get("heel")?.carriesIn).toEqual(["heel"]);
    expect(plan.get("fit")?.carriesIn).toEqual(["drive"]);
    expect(plan.get("sole")?.carriesIn).toEqual([]);
  });

  it("isolates members to their sub-assembly's parts, including used ones", () => {
    expect(plan.get("pinion")?.isolatePartIds?.sort()).toEqual(
      ["idler", "pinion", "plate"].sort()
    );
    expect(plan.get("shell")?.isolatePartIds?.sort()).toEqual(
      ["battery", "idler", "pinion", "plate", "shell"].sort()
    );
    expect(plan.get("sole")?.isolatePartIds).toBeNull();
    expect(plan.get("heel")?.isolatePartIds).toBeNull();
  });
});

describe("worldOf / arrivalIndexByNode", () => {
  it("places each step in its build", () => {
    expect(worldOf(example, "pinion")).toBe("drive");
    expect(worldOf(example, "fit")).toBe("heel");
    expect(worldOf(example, "sole")).toBeNull();
    expect(worldOf(example, "heel")).toBeNull();
  });

  it("main build: a sub-assembly's parts arrive when its unit joins", () => {
    const arrival = arrivalIndexByNode(example, null);
    const heelIndex = example.findIndex((s) => s.id === "heel");
    expect(arrival.get("sole")).toBe(4);
    expect(arrival.get("upper")).toBe(9);
    // Drive Train is inside Heel Module, which joins at its header.
    expect(arrival.get("plate")).toBe(heelIndex);
    expect(arrival.get("battery")).toBe(heelIndex);
  });

  it("inside a sub-assembly: used units arrive at the using step", () => {
    const heel = arrivalIndexByNode(example, "heel");
    const fitIndex = example.findIndex((s) => s.id === "fit");
    expect(heel.get("shell")).toBe(6);
    expect(heel.get("battery")).toBe(fitIndex);
    expect(heel.get("pinion")).toBe(fitIndex);
    expect(heel.has("sole")).toBe(false);

    const drive = arrivalIndexByNode(example, "drive");
    expect(drive.get("plate")).toBe(0);
    expect(drive.get("idler")).toBe(2);
    expect(drive.has("shell")).toBe(false);
  });
});

describe("subAssemblyPartIds", () => {
  it("follows uses and survives a cycle", () => {
    expect(subAssemblyPartIds(example, "drive").sort()).toEqual(
      ["idler", "pinion", "plate"].sort()
    );
    const cyclic: Row[] = [
      step("m1", ["x"], { parentStepId: "h1" }),
      step("h1", [], { isSubAssembly: true, usedInStepId: "m2" }),
      step("m2", ["y"], { parentStepId: "h2" }),
      step("h2", [], { isSubAssembly: true, usedInStepId: "m1" })
    ];
    expect(subAssemblyPartIds(cyclic, "h1").sort()).toEqual(["x", "y"]);
  });
});

describe("validateSubAssemblies", () => {
  it("accepts the example", () => {
    expect(validateSubAssemblies(example)).toEqual([]);
  });

  it("rule 1: members must sit directly before the header", () => {
    const rows = [
      step("m1", ["a"], { parentStepId: "h" }),
      step("main", ["b"]),
      step("m2", ["c"], { parentStepId: "h" }),
      step("h", [], { isSubAssembly: true })
    ];
    expect(validateSubAssemblies(rows).map((v) => v.rule)).toEqual([1]);
  });

  it("rule 2: no nesting, and members only belong to headers", () => {
    const nested = [
      step("inner", [], { isSubAssembly: true, parentStepId: "outer" }),
      step("outer", [], { isSubAssembly: true })
    ];
    expect(validateSubAssemblies(nested).map((v) => v.rule)).toEqual([2]);
    const notHeader = [
      step("a", ["a"], { parentStepId: "b" }),
      step("b", ["b"])
    ];
    expect(validateSubAssemblies(notHeader).map((v) => v.rule)).toEqual([2]);
  });

  it("rule 3: used later, by an ordinary step outside it", () => {
    const early = [
      step("use", ["u"]),
      step("m", ["a"], { parentStepId: "h" }),
      step("h", [], { isSubAssembly: true, usedInStepId: "use" })
    ];
    expect(validateSubAssemblies(early)[0]?.message).toMatch(
      /after it is built/
    );

    const own = [
      step("m", ["a"], { parentStepId: "h" }),
      step("h", [], { isSubAssembly: true, usedInStepId: "m" })
    ];
    expect(validateSubAssemblies(own)[0]?.message).toMatch(/own steps/);

    const byHeader = [
      step("m", ["a"], { parentStepId: "h" }),
      step("h", [], { isSubAssembly: true, usedInStepId: "h2" }),
      step("h2", [], { isSubAssembly: true })
    ];
    expect(validateSubAssemblies(byHeader)[0]?.rule).toBe(3);

    const onStep = [step("a", ["a"], { usedInStepId: "b" }), step("b", ["b"])];
    expect(validateSubAssemblies(onStep)[0]?.rule).toBe(3);
  });
});

describe("usableSubAssemblies", () => {
  it("explains why a sub-assembly can't be used", () => {
    const reasons = (id: string) =>
      Object.fromEntries(
        usableSubAssemblies(example, id).map((u) => [u.headerId, u.reason])
      );
    expect(reasons("fit")).toEqual({ drive: null, heel: "own" });
    expect(reasons("sole")).toEqual({ drive: null, heel: "before" });
    expect(reasons("heel")).toEqual({ drive: "header", heel: "header" });
  });
});

describe("buildCarryPlans", () => {
  const drop: Motion = { type: "linear", direction: [0, 0, -1], distance: 40 };
  const withMotion = (paths: Record<string, Motion>) =>
    example.map((row) => ({
      ...row,
      motion: paths[row.id] ?? ({ type: "none" } as Motion)
    }));
  const plansFor = (paths: Record<string, Motion>) => {
    const rows = withMotion(paths);
    const plans = buildCarryPlans(rows, buildSubAssemblyPlan(rows));
    return Object.fromEntries(rows.map((row, i) => [row.id, plans[i]]));
  };

  it("keeps the glide for a sub-assembly with no path of its own", () => {
    const plans = plansFor({});
    expect(plans.fit?.pathUnits).toEqual([]);
    expect(plans.fit?.glidingPartIds.sort()).toEqual(
      ["idler", "pinion", "plate"].sort()
    );
    expect(plans.heel?.joinsOnOwnPath).toBe(false);
  });

  it("flies a sub-assembly with a path instead of gliding it", () => {
    const plans = plansFor({ drive: drop });
    expect(plans.fit?.pathUnits).toEqual([
      {
        headerId: "drive",
        nodeIds: ["plate", "pinion", "idler"],
        motion: drop
      }
    ]);
    expect(plans.fit?.glidingPartIds).toEqual([]);
    expect(plans.fit?.carriedPartIds.sort()).toEqual(
      ["idler", "pinion", "plate"].sort()
    );
    // Its header is used, so it is not where the unit joins.
    expect(plans.drive?.joinsOnOwnPath).toBe(false);
  });

  it("an unused header with a path joins on it", () => {
    const plans = plansFor({ heel: drop });
    expect(plans.heel?.joinsOnOwnPath).toBe(true);
    expect(plans.heel?.pathUnits.map((unit) => unit.headerId)).toEqual([
      "heel"
    ]);
    expect(plans.heel?.glidingPartIds).toEqual([]);
  });

  it("steps that carry nothing in have an empty plan", () => {
    expect(plansFor({ drive: drop }).sole).toEqual({
      carriedPartIds: [],
      pathUnits: [],
      glidingPartIds: [],
      joinsOnOwnPath: false
    });
  });
});
