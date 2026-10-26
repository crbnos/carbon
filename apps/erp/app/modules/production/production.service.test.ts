// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  buildAssemblyToolStepLinks,
  maxToolQuantityByItem,
  planAssemblyStepMarkerRemap,
  planAssemblyStepMarkerSync,
  planOrphanStepAdoption
} from "./production.service";

describe("planAssemblyStepMarkerSync", () => {
  it("updates marked steps, leaves new sources to insert, and marks removed ones stale", () => {
    expect(
      planAssemblyStepMarkerSync(
        ["src-1", "src-new"],
        [
          { id: "job-1", assemblyInstructionStepId: "src-1" },
          { id: "job-2", assemblyInstructionStepId: "src-removed" }
        ]
      )
    ).toEqual({
      targetIdBySourceId: new Map([
        ["src-1", "job-1"],
        ["src-removed", "job-2"]
      ]),
      staleTargetIds: ["job-2"]
    });
  });
});

describe("planAssemblyStepMarkerRemap", () => {
  const step = (id: string, rootStepId: string | null = null) => ({
    id,
    rootStepId
  });

  it.each([
    [
      "maps a v1 step to the v2 step copied from it",
      [step("v1a")],
      [step("v2a", "v1a")],
      [["v1a", "v2a"]]
    ],
    // v3 copied from v2 still roots at v1.
    [
      "maps across versions through the flat root",
      [step("v2a", "v1a")],
      [step("v3a", "v1a")],
      [["v2a", "v3a"]]
    ],
    [
      "maps regardless of order",
      [step("v1a"), step("v1b")],
      [step("v2b", "v1b"), step("v2a", "v1a")],
      [
        ["v1a", "v2a"],
        ["v1b", "v2b"]
      ]
    ],
    [
      "leaves a deleted step unmapped",
      [step("v1a"), step("v1gone")],
      [step("v2a", "v1a")],
      [["v1a", "v2a"]]
    ],
    [
      "ignores a step added in the new version",
      [step("v1a")],
      [step("v2a", "v1a"), step("v2new")],
      [["v1a", "v2a"]]
    ],
    // Activation passes every sibling version as old steps.
    [
      "collapses every old version onto the new step",
      [step("v1a"), step("v2a", "v1a")],
      [step("v3a", "v1a")],
      [
        ["v1a", "v3a"],
        ["v2a", "v3a"]
      ]
    ],
    ["does not map a step to itself", [step("same")], [step("same")], []]
  ])("%s", (_, oldSteps, newSteps, expected) => {
    expect(planAssemblyStepMarkerRemap(oldSteps, newSteps)).toEqual(
      new Map(expected as [string, string][])
    );
  });
});

describe("planOrphanStepAdoption", () => {
  const src = (id: string, title: string | null, sortOrder: number) => ({
    id,
    title,
    sortOrder
  });
  const orphan = (id: string, name: string, sortOrder: number) => ({
    id,
    name,
    sortOrder
  });

  it.each([
    [
      "adopts an orphan matching a source step on sortOrder and name",
      [src("src1", "Fit cover", 1)],
      [orphan("orphan1", "Fit cover", 1)],
      [],
      [["orphan1", "src1"]]
    ],
    [
      "ignores an orphan whose name differs",
      [src("src1", "Fit cover", 1)],
      [orphan("handmade", "Operator note", 1)],
      [],
      []
    ],
    [
      "does not claim a source step a marked step already owns",
      [src("src1", "Fit cover", 1)],
      [orphan("orphan1", "Fit cover", 1)],
      ["src1"],
      []
    ],
    // The sync names an untitled step `Step ${index + 1}`.
    [
      "adopts an untitled source step by its placeholder name at its own index",
      [src("src1", "Real title", 1), src("src2", null, 2)],
      [orphan("orphan2", "Step 2", 2)],
      [],
      [["orphan2", "src2"]]
    ],
    [
      "adopts orphans that follow the operation's own steps",
      [src("src1", "Fit cover", 1), src("src2", "Torque bolts", 2)],
      [
        orphan("own1", "Clean bench", 1),
        orphan("own2", "Check kit", 2),
        orphan("orphan1", "Fit cover", 3),
        orphan("orphan2", "Torque bolts", 4)
      ],
      [],
      [
        ["orphan1", "src1"],
        ["orphan2", "src2"]
      ]
    ],
    [
      "adopts by position when sub-assembly rows leave gaps in the source order",
      [src("src1", "Press bearing", 1), src("src2", "Fit hub", 3)],
      [orphan("orphan1", "Press bearing", 1), orphan("orphan2", "Fit hub", 2)],
      [],
      [
        ["orphan1", "src1"],
        ["orphan2", "src2"]
      ]
    ],
    [
      "adopts each orphan at most once",
      [src("src1", "Same", 1), src("src2", "Same", 1)],
      [orphan("orphan1", "Same", 1)],
      [],
      [["orphan1", "src1"]]
    ]
  ])("%s", (_, sources, orphans, claimed, expected) => {
    expect(
      planOrphanStepAdoption(sources, orphans, new Set(claimed as string[]))
    ).toEqual(new Map(expected as [string, string][]));
  });
});

describe("maxToolQuantityByItem", () => {
  it("takes the max quantity any step asks for, defaulting null to 1", () => {
    expect(
      maxToolQuantityByItem([
        { itemId: "T1", quantity: 1 },
        { itemId: "T1", quantity: 3 },
        { itemId: "T2", quantity: null }
      ])
    ).toEqual(
      new Map([
        ["T1", 3],
        ["T2", 1]
      ])
    );
  });
});

describe("buildAssemblyToolStepLinks", () => {
  const link = (toolsByStep: [string, { itemId: string }[]][]) =>
    buildAssemblyToolStepLinks(
      [{ id: "src-1" }, { id: "src-2" }],
      new Map(toolsByStep),
      new Map([
        ["T1", "row-T1"],
        ["T2", "row-T2"]
      ]),
      new Map([
        ["src-1", "job-1"],
        ["src-2", "job-2"]
      ])
    );

  it("links each step's tools to its synced target step", () => {
    expect(
      link([
        ["src-1", [{ itemId: "T1" }]],
        ["src-2", [{ itemId: "T2" }]]
      ])
    ).toEqual([
      { jobOperationToolId: "row-T1", jobOperationStepId: "job-1" },
      { jobOperationToolId: "row-T2", jobOperationStepId: "job-2" }
    ]);
  });

  // The kept tool row then shows on every step of the operation.
  it("links nothing for a tool no source step uses any more", () => {
    expect(link([["src-1", [{ itemId: "T1" }]]])).toEqual([
      { jobOperationToolId: "row-T1", jobOperationStepId: "job-1" }
    ]);
  });
});
