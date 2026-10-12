// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { noPostgresChanges } from "./no-postgres-changes";

const scan = (contents: string) =>
  noPostgresChanges.scan("apps/erp/app/hooks/useThing.tsx", contents);

describe("noPostgresChanges", () => {
  it("flags a postgres_changes subscription, at its line", () => {
    const violations = scan(
      `channel.on(\n  "postgres_changes",\n  { event: "*", schema: "public", table: "job" },\n  refresh\n);`
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]!.line).toBe(2);
  });

  it("accepts a broadcast subscription", () => {
    expect(
      scan(`channel.on("broadcast", { event: "*" }, ({ payload }) => {});`)
    ).toEqual([]);
  });

  it("ignores the words in a comment or prose", () => {
    expect(scan(`// this used to be a postgres_changes subscription`)).toEqual(
      []
    );
  });
});
