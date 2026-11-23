// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTrailingCall } from "./trailing-call";

describe("createTrailingCall", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("calls once with the latest value after the pointer rests", () => {
    const onDue = vi.fn();
    const call = createTrailingCall(400, onDue);
    call.schedule("a");
    vi.advanceTimersByTime(300);
    call.schedule("b");
    vi.advanceTimersByTime(399);
    expect(onDue).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onDue.mock.calls).toEqual([["b"]]);
    expect(call.isPending()).toBe(false);
  });

  it("hands back a pending value on take and never calls it", () => {
    const onDue = vi.fn();
    const call = createTrailingCall(400, onDue);
    call.schedule("a");
    expect(call.isPending()).toBe(true);
    expect(call.take()).toBe("a");
    vi.advanceTimersByTime(1000);
    expect(onDue).not.toHaveBeenCalled();
    expect(call.take()).toBeUndefined();
  });
});
