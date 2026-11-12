// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "pathe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stackAt } from "./stack.js";
import { resolveSlot, writeStackMode } from "./worktree.js";

describe("stackAt", () => {
  const home = process.env.HOME;
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "crbn-stack-"));
    process.env.HOME = tmp;
  });
  afterEach(() => {
    process.env.HOME = home;
    rmSync(tmp, { recursive: true, force: true });
  });
  const envLocal = (url: string) =>
    writeFileSync(join(tmp, ".env.local"), `SUPABASE_DB_URL=${url}\n`);

  it("reads a stack an older crbn started, with no mode file, as isolated", () => {
    envLocal("postgresql://postgres:postgres@localhost:54000/postgres");
    const stack = stackAt(tmp, "carbon-old");
    expect(stack.recordedMode).toBeNull();
    expect(stack.mode).toBe("isolated");
    expect(stack.db).toEqual({ port: 54000, database: "postgres" });
  });

  it("migrates the database .env.local names, which under --borrow is another worktree's", () => {
    writeStackMode("carbon-a", "shared");
    envLocal("postgresql://postgres:postgres@localhost:54322/wt_carbon_b");
    expect(stackAt(tmp, "carbon-a").db).toEqual({
      port: 54322,
      database: "wt_carbon_b"
    });
  });

  it("takes the ports .env.local runs on, which localhost mode pins", async () => {
    await resolveSlot("carbon-l", tmp);
    writeFileSync(
      join(tmp, ".env.local"),
      "SUPABASE_DB_URL=postgresql://postgres:postgres@localhost:54322/wt_carbon_l\nPORT_API=54321\n"
    );
    expect(stackAt(tmp, "carbon-l").ports?.PORT_API).toBe(54321);
  });

  it("defaults a worktree no `crbn up` ran in to shared mode, with no database yet", () => {
    const stack = stackAt(tmp, "carbon-new");
    expect(stack.mode).toBe("shared");
    expect(stack.db).toBeNull();
    expect(stack.hosts.api).toBe("carbon-new-api-gw");
  });
});
