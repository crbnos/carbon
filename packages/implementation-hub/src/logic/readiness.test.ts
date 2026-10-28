// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import type { BoardTask } from "../types";
import { isReady, planTasks, visibleTasks } from "./readiness";

const task = (key: string, ready?: BoardTask["ready"]): BoardTask => ({
  key,
  label: { id: key, message: key },
  stepKey: "gate:golive",
  owner: "you",
  ready
});

const firstPurchaseOrder = task("first-purchase-order", [
  { count: "suppliers", min: 1 },
  { count: "items", min: 1 }
]);

describe("isReady", () => {
  it("is ready when the task has no rule", () => {
    expect(isReady(task("cutover"), {})).toBe(true);
  });

  it("is ready once every count reaches its minimum", () => {
    expect(isReady(firstPurchaseOrder, { suppliers: 1, items: 12 })).toBe(true);
  });

  it("is not ready while any count is below its minimum", () => {
    expect(isReady(firstPurchaseOrder, { suppliers: 2, items: 0 })).toBe(false);
  });

  it("is not ready when a count could not be read or was never loaded", () => {
    expect(isReady(firstPurchaseOrder, { suppliers: null, items: 5 })).toBe(
      false
    );
    expect(isReady(firstPurchaseOrder, { items: 5 })).toBe(false);
  });
});

describe("visibleTasks", () => {
  it("keeps a task someone already ticked, even when its counts are unreadable", () => {
    const states = new Map([["task:first-purchase-order", "done"]]);
    expect(
      visibleTasks([firstPurchaseOrder], { suppliers: null }, states).map(
        (t) => t.key
      )
    ).toEqual(["first-purchase-order"]);
    expect(
      visibleTasks([firstPurchaseOrder], { suppliers: null }, new Map()).map(
        (t) => t.key
      )
    ).toEqual([]);
  });

  it("keeps the tasks without a rule and the ready ones", () => {
    const tasks = [task("cutover"), firstPurchaseOrder];
    expect(visibleTasks(tasks, {}).map((t) => t.key)).toEqual(["cutover"]);
    expect(
      visibleTasks(tasks, { suppliers: 1, items: 1 }).map((t) => t.key)
    ).toEqual(["cutover", "first-purchase-order"]);
  });
});

describe("planTasks", () => {
  const keys = (tasks: BoardTask[]) => tasks.map((t) => t.key);

  it("hides every operational task before any records exist", () => {
    const tasks = keys(planTasks("guided", [], {}));
    expect(tasks).toContain("cutover");
    expect(tasks).not.toContain("first-quote");
    expect(tasks).not.toContain("first-job-completed");
  });

  it("shows a ready task under Acceptance on a paid tier", () => {
    const quote = planTasks("guided", [], { customers: 3, items: 10 }).find(
      (t) => t.key === "first-quote"
    );
    expect(quote?.stepKey).toBe("gate:acceptance");
  });

  it("shows the same task under Go-Live on self-serve", () => {
    const quotes = planTasks("self_serve", [], {
      customers: 3,
      items: 10
    }).filter((t) => t.key === "first-quote");
    expect(quotes).toHaveLength(1);
    expect(quotes[0]?.stepKey).toBe("gate:golive");
  });

  it("drops the tasks of phases the tier does not have", () => {
    const tasks = keys(planTasks("self_serve", [], {}));
    expect(tasks).not.toContain("kickoff");
    expect(tasks).not.toContain("scope-signed");
    expect(tasks).not.toContain("acceptance-passed");
  });
});
