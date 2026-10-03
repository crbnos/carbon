// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { parseDate } from "@internationalized/date";
import { describe, expect, it } from "vitest";
import { expiredEntities, expiryVerdict } from "./shelf-life";

const today = parseDate("2026-09-30");

describe("expiredEntities", () => {
  it("keeps only entities that expired before today", () => {
    const entities = [
      { id: "a", expirationDate: "2026-09-29" },
      { id: "b", expirationDate: "2026-09-30" },
      { id: "c", expirationDate: null },
      { id: "d", expirationDate: "not-a-date" }
    ];
    expect(expiredEntities(entities, today).map(({ id }) => id)).toEqual(["a"]);
  });
});

describe("expiryVerdict", () => {
  const none = { allowed: false, reason: null };
  it("warns under Warn and blocks under Block", () => {
    expect(expiryVerdict("Warn", none)).toBe("warn");
    expect(expiryVerdict("Block", { allowed: true, reason: "ok" })).toBe(
      "block"
    );
  });

  it("allows an override only with a non-blank reason", () => {
    expect(
      expiryVerdict("BlockWithOverride", { allowed: true, reason: "QA ok" })
    ).toBe("allow");
    expect(
      expiryVerdict("BlockWithOverride", { allowed: true, reason: "  " })
    ).toBe("block");
    expect(expiryVerdict("BlockWithOverride", none)).toBe("block");
  });
});
