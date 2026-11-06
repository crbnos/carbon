// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { modeOf, worktreeDbTarget } from "./migrations.js";

describe("worktreeDbTarget", () => {
  it("takes the database .env.local's SUPABASE_DB_URL names", () => {
    // A stack an older crbn started: no mode file, a private `postgres`.
    const db = worktreeDbTarget(
      "carbon-old",
      54000,
      "postgresql://postgres:postgres@localhost:54000/postgres"
    );
    expect(db).toEqual({ port: 54000, database: "postgres" });
    expect(modeOf(db)).toBe("isolated");
  });

  it("reads a shared worktree database as shared mode", () => {
    const db = worktreeDbTarget(
      "carbon-a",
      54322,
      "postgresql://postgres:postgres@localhost:54322/wt_carbon_a"
    );
    expect(db.database).toBe("wt_carbon_a");
    expect(modeOf(db)).toBe("shared");
  });
});
