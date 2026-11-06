// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

// @carbon/auth builds its Supabase client at import time.
vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: vi.fn()
}));

import { NotificationTopic } from "@carbon/notifications";
import { isCronDigest, staleDigests } from "./notification-digest";

describe("isCronDigest", () => {
  it("claims a digest this job made", () => {
    expect(
      isCronDigest({ count: 5, event: "digest", topic: NotificationTopic.Job })
    ).toBe(true);
  });

  it("leaves alone a digest a notify event made", () => {
    // The weekly training reminder finds last week's digest by this marker to
    // mark it read. Rewriting the payload erased it, so every week stacked a
    // new digest beside the old one and the next pass merged them into one
    // that listed each training twice.
    expect(
      isCronDigest({
        count: 2,
        event: "digest",
        sourceEvent: "training-reminder",
        topic: NotificationTopic.Training
      })
    ).toBe(false);
  });

  it("claims a digest whose payload is missing", () => {
    expect(isCronDigest(null)).toBe(true);
  });
});

const keeper = (id: string, count: number | null) => ({
  id,
  topic: NotificationTopic.Job,
  count
});

describe("staleDigests", () => {
  it("leaves a digest alone when its count has not moved", () => {
    expect(staleDigests([keeper("d1", 7)], new Map([["d1", 7]]))).toEqual([]);
  });

  it("refreshes a digest that absorbed new children", () => {
    expect(
      staleDigests([keeper("d1", 7)], new Map([["d1", 9]])).map((d) => [
        d.id,
        d.total
      ])
    ).toEqual([["d1", 9]]);
  });

  it("refreshes a digest whose children were purged, down to zero", () => {
    expect(
      staleDigests([keeper("d1", 7)], new Map()).map((d) => d.total)
    ).toEqual([0]);
  });

  it("refreshes a digest whose stored count cannot be read", () => {
    expect(
      staleDigests([keeper("d1", null)], new Map([["d1", 3]])).map(
        (d) => d.total
      )
    ).toEqual([3]);
  });
});
