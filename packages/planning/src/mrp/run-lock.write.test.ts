// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Logger } from "@carbon/logger";
import { describe, expect, it } from "vitest";
import {
  kindOf,
  type LoggedStep,
  recordingDatabase
} from "./__fixtures__/recording-driver";
import { withCompanyMrpRunLock } from "./run-lock";

/** The steps of each connection, in the order each connection ran them. */
function byConnection(log: LoggedStep[]): string[][] {
  const steps = new Map<number, string[]>();
  for (const step of log) {
    const list = steps.get(step.connection) ?? [];
    list.push(kindOf(step));
    steps.set(step.connection, list);
  }
  return [...steps.values()];
}

/** A run that reads once on its own connection, as `runMrpLocked` does. */
function setup(lockBusyTries: number) {
  const { db, driver } = recordingDatabase();
  driver.lockBusyTries = lockBusyTries;
  const sleeps: number[] = [];
  const warnings: unknown[][] = [];
  const logger = {
    warning: (...args: unknown[]) => {
      warnings.push(args);
    }
  } as unknown as Logger;
  const run = async () => {
    // Every try's transaction has ended (or holds the lock) when the run
    // starts: a waiting run held no connection.
    const openWhenRunStarts = byConnection(driver.log).filter(
      (steps) => !["commit", "rollback"].includes(steps.at(-1) ?? "")
    ).length;
    await db.selectFrom("plannedOrder").select("id").execute();
    return openWhenRunStarts;
  };
  const options = {
    pollMs: 250,
    maxWaitMs: 1_000,
    sleep: async (ms: number) => {
      // a wait that never ends fails here instead of hanging the test
      if (sleeps.length >= 20) throw new Error("still waiting after 20 tries");
      sleeps.push(ms);
    },
    logger
  };
  return { db, driver, sleeps, warnings, run, options };
}

describe("withCompanyMrpRunLock", () => {
  it("ends each refused try at once and waits between tries, holding no connection", async () => {
    const { db, driver, sleeps, warnings, run, options } = setup(2);
    const open = await withCompanyMrpRunLock(db, "co-1", run, options);

    expect(sleeps).toEqual([250, 250]);
    expect(warnings).toEqual([]);
    expect(byConnection(driver.log)).toEqual([
      ["begin", "run lock", "rollback"],
      ["begin", "run lock", "rollback"],
      // the granted try stays open for the run, then commits
      ["begin", "run lock", "commit"],
      ["select"]
    ]);
    // only the granted try's transaction was open while the run worked
    expect(open).toBe(1);
    expect(
      driver.log
        .filter((step) => kindOf(step) === "run lock")
        .map((step) => step.parameters)
    ).toEqual([["mrp-run:co-1"], ["mrp-run:co-1"], ["mrp-run:co-1"]]);
  });

  it("runs inside the granted try's transaction and releases it when the run fails", async () => {
    const { db, driver, run, options } = setup(0);
    await expect(
      withCompanyMrpRunLock(
        db,
        "co-1",
        async () => {
          await run();
          throw new Error("run failed");
        },
        options
      )
    ).rejects.toThrow("run failed");

    expect(byConnection(driver.log)).toEqual([
      ["begin", "run lock", "rollback"],
      ["select"]
    ]);
    // the lock's transaction ends last, after the run's own work
    expect(kindOf(driver.log.at(-1)!)).toBe("rollback");
  });

  // 1 s at 250 ms: the first try and 4 more after a wait each.
  it("runs without the run lock, with a warning, once the wait is over", async () => {
    const { db, driver, sleeps, warnings, run, options } = setup(
      Number.POSITIVE_INFINITY
    );
    const open = await withCompanyMrpRunLock(db, "co-1", run, options);

    expect(sleeps).toEqual([250, 250, 250, 250]);
    expect(byConnection(driver.log)).toEqual([
      ["begin", "run lock", "rollback"],
      ["begin", "run lock", "rollback"],
      ["begin", "run lock", "rollback"],
      ["begin", "run lock", "rollback"],
      ["begin", "run lock", "rollback"],
      ["select"]
    ]);
    expect(open).toBe(0);
    expect(warnings).toEqual([
      [expect.any(String), { companyId: "co-1", waitedMs: 1_000 }]
    ]);
  });
});
