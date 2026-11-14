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
  // one-connection pool. A run that fails on its first read has sent nothing.
  it("takes no lock before its first read, and leaves nothing open when it fails", async () => {
    const { db, driver } = recordingDatabase();
    await expect(
      runMrp(unreachable, db, {
        type: "company",
        id: "co-1",
        companyId: "co-1",
        userId: "system"
      })
    ).rejects.toThrow("PostgREST is unreachable");

    expect(driver.log.map(kindOf)).not.toContain("lock");
    const begins = driver.log.filter((step) => kindOf(step) === "begin");
    const ends = driver.log.filter((step) =>
      ["commit", "rollback"].includes(kindOf(step))
    );
    expect(ends.length).toBe(begins.length);
  });
});
