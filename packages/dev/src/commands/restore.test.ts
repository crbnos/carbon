// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { buildRestoreEnv } from "./restore.js";

// The restore itself is SQL in scripts/restore-database.sh and is not
// unit-testable. What IS testable — and what a mistake here would actually
// cost — is the flag→env mapping: getting the scrub wrong silently loads real
// production email addresses into a local database.
const DB = { port: 54322, database: "wt_carbon_x" };

describe("buildRestoreEnv", () => {
  it("scrubs emails by default, inverting the script's opt-in default", () => {
    expect(buildRestoreEnv({}, DB).SCRUB_EMAILS).toBe("1");
  });

  it("OMITS the key when opted out — the script treats any non-empty value as true", () => {
    const env = buildRestoreEnv({ scrubEmails: false }, DB);
    // "0" would enable scrubbing, not disable it.
    expect(env).not.toHaveProperty("SCRUB_EMAILS");
  });

  it("defaults to local mode so the restore cannot talk to production services", () => {
    expect(buildRestoreEnv({}, DB).RESTORE_MODE).toBe("local");
    expect(buildRestoreEnv({ mode: "prod" }, DB).RESTORE_MODE).toBe("prod");
  });

  it("does not leak an empty ADMIN_EMAIL that would make the script look up ''", () => {
    expect(buildRestoreEnv({ adminEmail: "" }, DB)).not.toHaveProperty(
      "ADMIN_EMAIL"
    );
  });

  it("clears storage metadata unless explicitly asked to keep it", () => {
    // Default matters: kept rows point at files that only exist in the source
    // environment's backend, so every download 404s.
    expect(buildRestoreEnv({}, DB)).not.toHaveProperty("KEEP_STORAGE_OBJECTS");
    expect(
      buildRestoreEnv({ keepStorageObjects: false }, DB)
    ).not.toHaveProperty("KEEP_STORAGE_OBJECTS");
    expect(
      buildRestoreEnv({ keepStorageObjects: true }, DB).KEEP_STORAGE_OBJECTS
    ).toBe("1");
  });

  it("names the worktree's database, which in shared mode is not postgres", () => {
    const env = buildRestoreEnv({}, { port: 54322, database: "wt_carbon_x" });
    expect(env.PORT_DB).toBe("54322");
    expect(env.DB_NAME).toBe("wt_carbon_x");
  });
});
