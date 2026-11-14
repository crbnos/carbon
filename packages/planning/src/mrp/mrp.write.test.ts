// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { kindOf, recordingDatabase } from "./__fixtures__/recording-driver";
import { runMrp } from "./mrp";

/** A PostgREST client that is down: the run fails on its first read. */
const unreachable = new Proxy(
  {},
  {
    get() {
      throw new Error("PostgREST is unreachable");
    }
  }
) as SupabaseClient<Database>;

describe("runMrp", () => {
  // Two runs of one company at once would keep changing each other's planned
  // orders and both fail after three attempts; the run lock queues them.
  it("holds the company's MRP run lock from before its first read until it fails", async () => {
    const { db, driver } = recordingDatabase();
    await expect(
      runMrp(unreachable, db, {
        type: "company",
        id: "co-1",
        companyId: "co-1",
        userId: "system"
      })
    ).rejects.toThrow("PostgREST is unreachable");

    const [first, lock] = driver.log;
    expect([first, lock].map((step) => step && kindOf(step))).toEqual([
      "begin",
      "run lock"
    ]);
    expect(lock?.parameters).toEqual(["mrp-run:co-1"]);
    // The lock's transaction does nothing else and ends last: the run's own
    // reads and writes are on other connections.
    const onLockConnection = driver.log.filter(
      (step) => step.connection === first?.connection
    );
    expect(onLockConnection.map(kindOf)).toEqual([
      "begin",
      "run lock",
      "rollback"
    ]);
    expect(driver.log.at(-1)).toBe(onLockConnection.at(-1));
    expect(driver.log.length).toBeGreaterThan(3);
  });
});
