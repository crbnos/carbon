// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import assert from "node:assert/strict";
import { test } from "node:test";

import { withRetry } from "./retry";

test("retries with jittered, growing waits until the call succeeds", async () => {
  const waits: number[] = [];
  let calls = 0;
  const result = await withRetry(
    async () => {
      if (++calls < 3) throw new Error("400");
      return "ok";
    },
    { baseMs: 1000, random: () => 0.5, wait: async (ms) => waits.push(ms) }
  );
  assert.equal(result, "ok");
  assert.deepEqual(waits, [500, 1000]);
});

test("throws the last error once the attempts run out", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls++;
        throw new Error("400");
      },
      { attempts: 3, wait: async () => {} }
    ),
    /400/
  );
  assert.equal(calls, 3);
});
