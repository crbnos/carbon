// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect } from "vitest";

// Deno std `asserts` reimplemented on vitest's `expect`, so the scheduling
// tests relocated from the edge runtime convert 1:1 without rewriting every
// call site. Behavior matches the originals: a failed assertion throws.

export function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  expect(actual, msg).toEqual(expected);
}

export function assert(expr: unknown, msg?: string): asserts expr {
  expect(expr, msg).toBeTruthy();
}

export function assertStrictEquals<T>(
  actual: T,
  expected: T,
  msg?: string
): void {
  expect(actual, msg).toBe(expected);
}
