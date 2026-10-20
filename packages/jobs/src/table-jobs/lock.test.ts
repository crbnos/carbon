// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

// The Redis client itself is the boundary: only the reply is decided here.
vi.mock("@carbon/kv", () => ({ redis: {} }));

import { decideTableJobLock } from "./lock";

describe("decideTableJobLock", () => {
  it("takes the lock when the script set it", () => {
    expect(decideTableJobLock([1, 0])).toEqual({ status: "acquired" });
  });

  it("refuses with the remaining seconds while another job holds it", () => {
    expect(decideTableJobLock([0, 1740])).toEqual({
      status: "busy",
      retryAfterSeconds: 1740
    });
  });

  it("never promises a wait for a key without a real TTL", () => {
    expect(decideTableJobLock([0, -1])).toEqual({
      status: "busy",
      retryAfterSeconds: 0
    });
    expect(decideTableJobLock([0, -2])).toEqual({
      status: "busy",
      retryAfterSeconds: 0
    });
  });

  it("refuses while every slot across companies is taken", () => {
    expect(decideTableJobLock([2, 0])).toEqual({ status: "full" });
  });

  it("fails open when Redis answers nothing", () => {
    expect(decideTableJobLock(null)).toEqual({ status: "unavailable" });
    expect(decideTableJobLock([])).toEqual({ status: "unavailable" });
  });
});
