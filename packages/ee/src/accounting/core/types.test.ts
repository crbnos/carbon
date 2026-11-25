// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import { getPushedVersion } from "./types";

describe("getPushedVersion", () => {
  // The forms an `updatedAt` reaches a syncer in: PostgREST's ISO text, a
  // Postgres text cast, and the JS Date the pg driver decodes a timestamptz to.
  it.each([
    ["2026-11-25T10:00:00.123456+00:00", "2026-11-25T10:00:00.123Z"],
    ["2026-11-25 10:00:00.123456+00", "2026-11-25T10:00:00.123Z"],
    ["2026-11-25 15:30:00+05:30", "2026-11-25T10:00:00.000Z"],
    ["2026-11-25T10:00:00Z", "2026-11-25T10:00:00.000Z"]
  ])("reads the instant of the timestamp %s", (updatedAt, version) => {
    expect(getPushedVersion({ updatedAt })).toBe(version);
  });

  it("reads the instant of a decoded Date", () => {
    expect(
      getPushedVersion({ updatedAt: new Date(Date.UTC(2026, 10, 25, 10)) })
    ).toBe("2026-11-25T10:00:00.000Z");
  });

  it.each([
    undefined,
    null,
    {},
    { updatedAt: null },
    { updatedAt: "" },
    { updatedAt: "yesterday" },
    { updatedAt: new Date(Number.NaN) }
  ])("has no version for %o, so the link stamps the link time", (entity) => {
    expect(getPushedVersion(entity)).toBeUndefined();
  });
});
