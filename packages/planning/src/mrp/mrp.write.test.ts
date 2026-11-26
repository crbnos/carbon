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
  // A run holds no lock or connection across its whole length: a lock held on
  // one connection while the run worked on another hung a run on a
  // one-connection pool. The only lock before its first read is the period
  // lock of a transaction that creates missing weeks, and it is released
  // when that transaction ends.
  it("takes no lock outside a transaction before its first read, and leaves nothing open when it fails", async () => {
    const { db, driver } = recordingDatabase();
    await expect(
      runMrp(unreachable, db, {
        type: "company",
        id: "co-1",
        companyId: "co-1",
        userId: "system"
      })
    ).rejects.toThrow("PostgREST is unreachable");

    // every lock sits inside a transaction, which ends before the next step
    let depth = 0;
    for (const kind of driver.log.map(kindOf)) {
      if (kind === "begin") depth += 1;
      if (kind === "commit" || kind === "rollback") depth -= 1;
      if (kind === "lock") expect(depth).toBeGreaterThan(0);
    }
    expect(depth).toBe(0);
    const begins = driver.log.filter((step) => kindOf(step) === "begin");
    const ends = driver.log.filter((step) =>
      ["commit", "rollback"].includes(kindOf(step))
    );
    expect(ends.length).toBe(begins.length);
  });
});
