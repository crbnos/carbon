// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { motor } from "./data/motor/index.ts";
import { motorLine } from "./data/motor-line/index.ts";
import type { Dataset } from "./types.ts";
import { validateDataset } from "./validate.ts";

const base = (patch: Partial<Dataset> = {}): Dataset => ({
  ...motorLine,
  ...patch
});

describe("a walkthrough dataset", () => {
  it("passes the structural rules without demo coverage", () => {
    expect(validateDataset(base())).toEqual([]);
  });

  it("is refused with an industryId", () => {
    expect(
      validateDataset(base({ industryId: "automotive_precision" }))
    ).toEqual([
      'walkthrough: a walkthrough dataset is dev-only, so its industryId must be null, not "automotive_precision"'
    ]);
  });

  it("is refused with rows in a slice whose rules do not run", () => {
    const violations = validateDataset(
      base({
        production: { ...motorLine.production, jobs: motor.production.jobs }
      })
    );
    expect(violations).toContain(
      "production.jobs: a walkthrough dataset leaves it empty — its rules do not run"
    );
  });

  it("still catches a serial sequence that re-issues a shelf serial", () => {
    const violations = validateDataset(
      base({
        ops: {
          ...motorLine.ops,
          serialSequences: motorLine.ops.serialSequences.map((spec) =>
            spec.item === "AJ3-CC" ? { ...spec, next: 2 } : spec
          )
        }
      })
    );
    expect(violations).toEqual([
      'ops.serialSequences[1]: next 2 would re-issue "AJ3C-0003", already seeded'
    ]);
  });
});

describe("a demo dataset", () => {
  it("must carry every job, RFQ and demand story", () => {
    const violations = validateDataset({
      ...motor,
      planning: { ...motor.planning, demandOrder: null }
    });
    expect(violations).toContain(
      "planning.demandOrder: missing — only a walkthrough omits it"
    );
  });
});
