// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { localPoolerUrl } from "./client";

describe("localPoolerUrl", () => {
  const direct = "postgresql://postgres:postgres@localhost:54322/wt_a";

  it("uses the pooler for the same database", () => {
    const pooler = "postgresql://postgres:postgres@localhost:54329/wt_a";
    expect(localPoolerUrl(direct, pooler)).toBe(pooler);
  });

  it("keeps a SUPABASE_DB_URL that names another database", () => {
    const pooler = "postgresql://postgres:postgres@localhost:54329/wt_b";
    expect(localPoolerUrl(direct, pooler)).toBe(direct);
  });

  it("keeps a SUPABASE_DB_URL on another host with the same database", () => {
    const remote = "postgresql://postgres:x@db.example.com:5432/wt_a";
    const pooler = "postgresql://postgres:postgres@localhost:54329/wt_a";
    expect(localPoolerUrl(remote, pooler)).toBe(remote);
  });

  it("keeps a SUPABASE_DB_URL on another local port or as another user", () => {
    const pooler = "postgresql://postgres:postgres@localhost:54329/wt_a";
    const otherStack = "postgresql://postgres:postgres@localhost:55000/wt_a";
    expect(localPoolerUrl(otherStack, pooler, "54322")).toBe(otherStack);
    expect(localPoolerUrl(direct, pooler, "54322")).toBe(pooler);
    const admin = "postgresql://supabase_admin:postgres@localhost:54322/wt_a";
    expect(localPoolerUrl(admin, pooler, "54322")).toBe(admin);
  });

  it("uses a pooler on another host that was set next to its database", () => {
    const direct = "postgresql://postgres:x@postgres:5432/postgres";
    const pooler = "postgresql://postgres.carbon:x@supavisor:6543/postgres";
    expect(localPoolerUrl(direct, pooler)).toBe(pooler);
  });

  it("treats a blank or missing pooler URL as unset", () => {
    expect(localPoolerUrl(direct, "")).toBe(direct);
    expect(localPoolerUrl(direct, undefined)).toBe(direct);
  });
});
