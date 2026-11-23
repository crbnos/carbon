// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { parseAbsolute } from "@internationalized/date";
import { describe, expect, it } from "vitest";
import { chargeLineDescription, sourceTimestamp } from "./card-charge-source";

// node-postgres hands back a Date although the generated types say string.
describe("sourceTimestamp", () => {
  it("turns a driver Date into an ISO instant", () => {
    const value = parseAbsolute("2026-09-09T00:00:00Z", "UTC").toDate();
    expect(sourceTimestamp(value)).toBe("2026-09-09T00:00:00.000Z");
  });

  it.each(["2026-09-09T00:00:00Z", null])("passes %s through", (value) => {
    expect(sourceTimestamp(value)).toBe(value);
  });
});

// Card spend shares one catch-all vendor, so the merchant must lead the line.
describe("chargeLineDescription", () => {
  it.each([
    ["Acme Fuel", "Airfare", "memo", "Acme Fuel"],
    [null, "Airfare", "memo", "Airfare"],
    [null, null, "memo", "memo"],
    [null, null, null, undefined]
  ])(
    "merchant %s, line %s, memo %s → %s",
    (merchantName, description, memo, expected) => {
      expect(
        chargeLineDescription({ merchantName, memo }, { description })
      ).toBe(expected);
    }
  );
});
