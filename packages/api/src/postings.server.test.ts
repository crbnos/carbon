// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { posting, postingOrThrow } from "./postings.server";

describe("posting", () => {
  const handles = { db: {} as never, companyId: "c1", userId: "u1" };

  it("refuses to run before the app registers its postings", async () => {
    expect(() => posting("post-receipt", handles, { receiptId: "r1" })).toThrow(
      'posting("post-receipt"): the app has not called registerPostings'
    );
    await expect(
      postingOrThrow("post-shipment", handles, {
        type: "post",
        shipmentId: "s1"
      })
    ).rejects.toThrow(
      'posting("post-shipment"): the app has not called registerPostings'
    );
  });
});
