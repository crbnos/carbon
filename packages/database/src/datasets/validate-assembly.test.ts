// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { satellite } from "./data/satellite/index.ts";
import type { AssemblyStepSpec, Dataset } from "./types.ts";
import { validateDataset } from "./validate.ts";

// The satellite assembly is the one seeded with sub-assemblies, so each case
// breaks one rule on a copy of it and expects exactly that rule to fire.
function withSteps(
  edit: (steps: AssemblyStepSpec[]) => AssemblyStepSpec[]
): Dataset {
  // Only the steps are cloned: the dataset holds functions structuredClone refuses.
  const assembly = satellite.items.assembly!;
  return {
    ...satellite,
    items: {
      ...satellite.items,
      assembly: { ...assembly, steps: edit(structuredClone(assembly.steps)) }
    }
  };
}

const assemblyViolations = (dataset: Dataset) =>
  validateDataset(dataset).filter((v) => v.includes("items.assembly"));

const headerIndex = (steps: AssemblyStepSpec[], key: string) =>
  steps.findIndex((step) => step.key === key);

describe("satellite assembly sub-assemblies", () => {
  it("seeds headers that other steps use", () => {
    const steps = satellite.items.assembly!.steps;
    expect(steps.filter((step) => step.isSubAssembly).length).toBe(5);
    expect(assemblyViolations(satellite)).toEqual([]);
  });

  it("rejects a member that sits after its header", () => {
    const dataset = withSteps((steps) => {
      const header = headerIndex(steps, "sa-wings");
      const member = steps[header - 1]!;
      const rest = steps.filter((_, i) => i !== header - 1);
      rest.splice(header, 0, member);
      return rest;
    });
    expect(assemblyViolations(dataset).join("\n")).toContain(
      "must sit directly before it"
    );
  });

  it("rejects a sub-assembly used by one of its own members", () => {
    const dataset = withSteps((steps) => {
      const header = headerIndex(steps, "sa-wings");
      const member = steps[header - 1]!;
      member.key = "wings-last-member";
      steps[header]!.usedIn = "wings-last-member";
      return steps;
    });
    expect(assemblyViolations(dataset).join("\n")).toContain(
      "must come after the sub-assembly"
    );
  });

  it("rejects usedIn pointing at an earlier step", () => {
    const dataset = withSteps((steps) => {
      steps[headerIndex(steps, "sa-avionics")]!.usedIn = "eps-wings";
      return steps;
    });
    expect(assemblyViolations(dataset).join("\n")).toContain(
      'usedIn "eps-wings" must come after the sub-assembly'
    );
  });

  it("rejects a parent that is not a sub-assembly", () => {
    const dataset = withSteps((steps) => {
      steps[0]!.parent = "no-such-header";
      return steps;
    });
    expect(assemblyViolations(dataset).join("\n")).toContain(
      'parent "no-such-header" is not a sub-assembly'
    );
  });
  it("rejects baked motions once a step's parts change", () => {
    const dataset = withSteps((steps) => {
      const step = steps.find((candidate) => candidate.motion)!;
      step.componentNodeIds = step.componentNodeIds.slice(1);
      return steps;
    });
    expect(assemblyViolations(dataset).join("\n")).toContain(
      "steps changed since their motions were baked"
    );
  });

  it("keeps baked motions when only wording changes", () => {
    const dataset = withSteps((steps) => {
      steps[0]!.title = "Renamed";
      steps[0]!.instruction = "Reworded.";
      return steps;
    });
    expect(assemblyViolations(dataset)).toEqual([]);
  });
});
