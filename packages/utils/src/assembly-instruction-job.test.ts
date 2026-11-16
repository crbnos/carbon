// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  getInstructionJobSteps,
  getInstructionMaterialLinks,
  getInstructionStepSlides,
  getInstructionTools,
  type InstructionStepSource
} from "./assembly-instruction-job";

const step = (
  overrides: Partial<InstructionStepSource> & { id: string }
): InstructionStepSource => ({
  title: null,
  type: "Task",
  description: null,
  instructionText: null,
  required: null,
  unitOfMeasureCode: null,
  minValue: null,
  maxValue: null,
  listValues: null,
  fileTypes: null,
  sortOrder: 0,
  isSubAssembly: false,
  ...overrides
});

describe("getInstructionJobSteps", () => {
  it("drops sub-assembly headers and keeps play order", () => {
    const steps = getInstructionJobSteps([
      step({ id: "b", sortOrder: 2, title: "Fit panel" }),
      step({ id: "h", sortOrder: 1, isSubAssembly: true, title: "Frame" }),
      step({ id: "a", sortOrder: 0, title: "Mount bracket" })
    ]);
    expect(steps.map((s) => s.assemblyInstructionStepId)).toEqual(["a", "b"]);
  });

  it("numbers from 1 and fills the defaults", () => {
    const [first] = getInstructionJobSteps([
      step({ id: "a", instructionText: "Torque to spec" })
    ]);
    expect(first).toMatchObject({
      name: "Step 1",
      description: "Torque to spec",
      required: false,
      sortOrder: 1
    });
  });
});

describe("getInstructionStepSlides", () => {
  const slide = (stepId: string, modelUploadId: string | null) => ({
    stepId,
    imagePath: modelUploadId ? null : "img.png",
    modelUploadId,
    caption: null,
    sortOrder: 1,
    size: "medium",
    annotations: null
  });

  it("leads with the instruction model", () => {
    const slides = getInstructionStepSlides("a", [slide("a", null)], "model");
    expect(slides.map((s) => s.modelUploadId)).toEqual(["model", null]);
  });

  it("does not repeat a model the step already shows", () => {
    const slides = getInstructionStepSlides(
      "a",
      [slide("a", "model"), slide("b", null)],
      "model"
    );
    expect(slides).toHaveLength(1);
  });
});

describe("getInstructionTools", () => {
  it("keeps one row per tool at the largest quantity, linked to each step", () => {
    expect(
      getInstructionTools([
        { stepId: "a", itemId: "t1", quantity: 1 },
        { stepId: "b", itemId: "t1", quantity: 3 },
        { stepId: "b", itemId: "t2", quantity: null }
      ])
    ).toEqual([
      { itemId: "t1", quantity: 3, stepIds: ["a", "b"] },
      { itemId: "t2", quantity: 1, stepIds: ["b"] }
    ]);
  });
});

describe("getInstructionMaterialLinks", () => {
  it("links only the parts the method carries", () => {
    expect(
      getInstructionMaterialLinks(
        [
          { stepId: "a", itemId: "i1", quantity: 2 },
          { stepId: "a", itemId: "missing", quantity: 1 }
        ],
        [{ id: "m1", itemId: "i1", order: 1 }]
      )
    ).toEqual([{ stepId: "a", materialId: "m1", quantity: 2 }]);
  });

  it("picks the first line by order when two lines carry the part", () => {
    expect(
      getInstructionMaterialLinks(
        [{ stepId: "a", itemId: "i1", quantity: null }],
        [
          { id: "m1", itemId: "i1", order: 2 },
          { id: "m2", itemId: "i1", order: 1 }
        ]
      )
    ).toEqual([{ stepId: "a", materialId: "m2", quantity: null }]);
  });
});
