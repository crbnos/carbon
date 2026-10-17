// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { planReceiptSerialRelease } from "./receipt-serials.ts";

describe("planReceiptSerialRelease", () => {
  it("deletes entities without history and only unlinks the rest", () => {
    const placeholder = { id: "new" };
    const shipped = { id: "unit" };
    expect(
      planReceiptSerialRelease([placeholder, shipped], new Set(["unit"]))
    ).toEqual({ deleteIds: ["new"], unlink: [shipped] });
  });
});
