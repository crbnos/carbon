// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: vi.fn()
}));
vi.mock("../../../db", () => ({ getJobDatabaseClient: vi.fn() }));
vi.mock("../../client", () => ({
  inngest: { createFunction: vi.fn(() => ({})) }
}));

import { NotificationTopic } from "@carbon/notifications";
import { staleDigests } from "./notification-digest";

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
