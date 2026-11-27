// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { setupI18n } from "@lingui/core";
import { describe, expect, it } from "vitest";
import { DEPENDENCIES } from "../content/dependencies";
import { SETUP_GROUPS } from "../content/setup";
import { SPINE } from "../content/spine";
import type { BoardTask } from "../types";
import {
  gateDueDates,
  heldUp,
  isPastDue,
  overdueCascade,
  overdueTasks
} from "./cascade";
import { flagKey, taskKey } from "./keys";
import { spineForTier } from "./overlay";
import { planTasks } from "./readiness";
import { PLAN_START_KEY, resolveTimeline } from "./timeline";

const i18n = setupI18n({ locale: "en", messages: { en: {} } });

const task = (key: string, stepKey: string): BoardTask => ({
  key,
  label: { id: key, message: key },
  stepKey,
  owner: "you"
});

// Two phases: a setup phase due 2026-02-09 and a later one due 2026-03-02.
const setupA = task("setup-a", "gate:configure");
const setupB = task("setup-b", "gate:configure");
const later = task("later", "gate:golive");
const last = task("last", "gate:golive");
const gateDates = new Map([
  ["gate:configure", "2026-02-09"],
  ["gate:golive", "2026-03-02"]
]);
const done = (...keys: string[]) =>
  new Map(keys.map((key) => [taskKey(key), "done"]));

describe("isPastDue", () => {
  it("is past due only after the due day", () => {
    expect(isPastDue("2026-02-09", "2026-02-10")).toBe(true);
    expect(isPastDue("2026-02-09", "2026-02-09")).toBe(false);
    expect(isPastDue(undefined, "2026-02-10")).toBe(false);
  });
});

describe("overdueTasks", () => {
  it("lists the open tasks whose phase date has passed", () => {
    const overdue = overdueTasks(
      [setupA, setupB, later],
      done("setup-b"),
      gateDates,
      "2026-02-10"
    );
    expect(overdue.map((t) => t.key)).toEqual(["setup-a"]);
  });

  it("finds nothing overdue when the hub has no dates", () => {
    const timeline = resolveTimeline(
      spineForTier(SPINE, "guided"),
      new Map(),
      i18n
    );
    const noDates = gateDueDates(timeline);
    expect(noDates.size).toBe(0);
    expect(
      overdueTasks(
        planTasks("guided", [], {}),
        new Map(),
        noDates,
        "2030-01-01"
      )
    ).toEqual([]);
  });

  it("dates each phase from the resolved timeline", () => {
    const timeline = resolveTimeline(
      spineForTier(SPINE, "guided"),
      new Map([[PLAN_START_KEY, "2026-01-05"]]),
      i18n
    );
    expect(gateDueDates(timeline).get("gate:configure")).toBe("2026-02-09");
  });
});

describe("heldUp", () => {
  it("lists the tasks an overdue task holds up directly", () => {
    expect(heldUp(["setup-a"], { "setup-a": ["later"] })).toEqual([
      { key: "later", causes: ["setup-a"] }
    ]);
  });

  it("follows the map through other tasks", () => {
    expect(
      heldUp(["setup-a"], { "setup-a": ["setup-b"], "setup-b": ["last"] })
    ).toEqual([
      { key: "setup-b", causes: ["setup-a"] },
      { key: "last", causes: ["setup-a"] }
    ]);
  });

  it("walks a cycle once instead of looping", () => {
    expect(
      heldUp(["setup-a"], {
        "setup-a": ["setup-b"],
        "setup-b": ["setup-a", "later"],
        later: ["setup-b"]
      })
    ).toEqual([
      { key: "setup-b", causes: ["setup-a"] },
      { key: "later", causes: ["setup-a"] }
    ]);
  });

  it("names every overdue task that holds a task up, and never lists an overdue task as held up", () => {
    expect(
      heldUp(["setup-a", "setup-b"], {
        "setup-a": ["setup-b", "later"],
        "setup-b": ["later"]
      })
    ).toEqual([{ key: "later", causes: ["setup-a", "setup-b"] }]);
  });
});

describe("overdueCascade", () => {
  const map = { "setup-a": ["hidden"], hidden: ["later"], later: ["last"] };

  it("reaches shown tasks through a task the hub does not show", () => {
    const cascade = overdueCascade(
      [setupA, later, last],
      new Map(),
      gateDates,
      "2026-02-10",
      map
    );
    expect(cascade.overdue.map((t) => t.key)).toEqual(["setup-a"]);
    expect(
      cascade.heldUp.map(({ task, causes }) => [
        task.key,
        causes.map((c) => c.key)
      ])
    ).toEqual([
      ["later", ["setup-a"]],
      ["last", ["setup-a"]]
    ]);
  });

  it("does not list a finished task as held up", () => {
    const cascade = overdueCascade(
      [setupA, later, last],
      done("later"),
      gateDates,
      "2026-02-10",
      map
    );
    expect(cascade.heldUp.map(({ task }) => task.key)).toEqual(["last"]);
  });

  it("with the real map, open storage setup holds up receiving and the data load", () => {
    // A guided hub past its Configure date, with every setup row configured
    // except the Inventory group's (no storage units yet).
    const inventory = SETUP_GROUPS.find((group) => group.n === 8)!;
    const states = new Map<string, string>([
      ...[
        "kickoff",
        "process-mapped",
        "scope-signed",
        "integrations",
        "hosting"
      ].map((key) => [taskKey(key), "done"] as [string, string]),
      ...SETUP_GROUPS.filter((group) => group !== inventory).flatMap((group) =>
        group.rows.map(
          (row) => [flagKey(`setup.${row.key}`), "1"] as [string, string]
        )
      )
    ]);
    const tasks = planTasks("guided", [], {
      suppliers: 1,
      items: 1,
      purchaseOrdersFinalized: 1
    });
    const timeline = resolveTimeline(
      spineForTier(SPINE, "guided"),
      new Map([[PLAN_START_KEY, "2026-01-05"]]),
      i18n
    );
    const cascade = overdueCascade(
      tasks,
      states,
      gateDueDates(timeline),
      "2026-02-10",
      DEPENDENCIES
    );
    expect(cascade.overdue.map((t) => t.key)).toEqual(["setup-inventory"]);
    const heldUpKeys = cascade.heldUp.map(({ task }) => task.key);
    expect(heldUpKeys).toContain("first-receipt");
    expect(heldUpKeys).toContain("data-loaded");
    // Through the data load: validation, acceptance, then go-live.
    expect(heldUpKeys).toContain("cutover");
    expect(heldUpKeys).not.toContain("first-quote");
  });
});
