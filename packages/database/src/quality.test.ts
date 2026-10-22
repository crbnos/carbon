// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { isRejectableWithoutReason } from "./quality";

// A lot can always be rejected with a reason (a suspected counterfeit, the
// wrong part). Without one, it must have failed inspection.
describe("isRejectableWithoutReason", () => {
  const feature = (rejectionNumber: number, failed: number) => ({
    rejectionNumber,
    failed
  });

  it("rejects a document-driven lot once a characteristic reaches its rejection number", () => {
    expect(
      isRejectableWithoutReason({
        features: [feature(2, 0), feature(2, 2)],
        failedSamples: 0,
        acceptanceNumber: 1
      })
    ).toBe(true);
  });

  it("rejects a document-driven lot with a failed sample", () => {
    expect(
      isRejectableWithoutReason({
        features: [feature(3, 1)],
        failedSamples: 1,
        acceptanceNumber: 2
      })
    ).toBe(true);
  });

  it("needs a reason for a document-driven lot that has not failed", () => {
    expect(
      isRejectableWithoutReason({
        features: [feature(2, 1), feature(3, 0)],
        failedSamples: 0,
        acceptanceNumber: 1
      })
    ).toBe(false);
  });

  it("rejects a lot with no characteristics once its failures pass the acceptance number", () => {
    expect(
      isRejectableWithoutReason({
        features: [],
        failedSamples: 2,
        acceptanceNumber: 1
      })
    ).toBe(true);
  });

  it("needs a reason for a lot with no characteristics within its acceptance number", () => {
    expect(
      isRejectableWithoutReason({
        features: [],
        failedSamples: 1,
        acceptanceNumber: 1
      })
    ).toBe(false);
    expect(
      isRejectableWithoutReason({
        features: [],
        failedSamples: 0,
        acceptanceNumber: 0
      })
    ).toBe(false);
  });
});
