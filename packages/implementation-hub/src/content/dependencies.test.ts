// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { boardTasksForTier } from "../logic/board";
import { spineForTier } from "../logic/overlay";
import type { Tier } from "../types";
import { BOARD_TASKS } from "./board";
import { DEPENDENCIES, STEP_ORDER } from "./dependencies";
import { OPERATIONAL_TASKS } from "./operational";
import { SPINE } from "./spine";

const TIERS: Tier[] = ["self_serve", "guided", "enterprise"];
const boardKeys = new Set(BOARD_TASKS.map((task) => task.key));
const operationalKeys = [...new Set(OPERATIONAL_TASKS.map((t) => t.key))];

describe("DEPENDENCIES", () => {
  it("names only board tasks, as keys and as values", () => {
    const unknown = Object.entries(DEPENDENCIES).flatMap(([key, heldUp]) =>
      [key, ...heldUp].filter((k) => !boardKeys.has(k))
    );
    expect(unknown).toEqual([]);
  });

  it("has an entry for every board task", () => {
    const missing = [...boardKeys].filter((key) => !(key in DEPENDENCIES));
    expect(missing).toEqual([]);
  });
});

describe("OPERATIONAL_TASKS", () => {
  it("shows each operational task exactly once on every tier, under a phase the tier has", () => {
    for (const tier of TIERS) {
      const steps = new Set(spineForTier(SPINE, tier).map((s) => s.key));
      const tasks = boardTasksForTier(BOARD_TASKS, tier);
      for (const key of operationalKeys) {
        const shown = tasks.filter((task) => task.key === key);
        expect(shown, `${key} on ${tier}`).toHaveLength(1);
        expect(steps.has(shown[0]!.stepKey), `${key} on ${tier}`).toBe(true);
      }
    }
  });

  it("puts the completed first job in Go-Live on every tier", () => {
    for (const tier of TIERS) {
      const task = boardTasksForTier(BOARD_TASKS, tier).find(
        (t) => t.key === "first-job-completed"
      );
      expect(task?.stepKey).toBe("gate:golive");
    }
  });

  it("gives every operational task a readiness rule and evidence", () => {
    for (const task of OPERATIONAL_TASKS) {
      expect(task.ready?.length, task.key).toBeGreaterThan(0);
      expect(task.evidence, task.key).toBeDefined();
    }
  });
});

describe("STEP_ORDER", () => {
  it("has unique keys and ends on the operational tasks", () => {
    const keys = STEP_ORDER.map((step) => step.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.slice(-4)).toEqual([
      "first-purchase-order",
      "first-receipt",
      "first-job",
      "first-job-completed"
    ]);
    for (const key of keys.slice(-4)) {
      expect(operationalKeys).toContain(key);
    }
  });
});
