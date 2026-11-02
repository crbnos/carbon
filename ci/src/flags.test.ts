// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import assert from "node:assert/strict";
import { test } from "node:test";
import { assertFlagdDocument, fetchFlagsDocument } from "./flags";

const doc = (flags: object) => JSON.stringify({ flags });
const valid = {
  "multi-company-management": {
    state: "ENABLED",
    variants: { on: true, off: false },
    defaultVariant: "off"
  }
};

test("accepts a valid document", () => {
  assert.doesNotThrow(() => assertFlagdDocument(doc(valid)));
});

test("refuses a string variant on a registered boolean flag", () => {
  assert.throws(
    () =>
      assertFlagdDocument(
        doc({
          "multi-company-management": {
            state: "ENABLED",
            variants: { on: "true" },
            defaultVariant: "on"
          }
        })
      ),
    /must have boolean variants/
  );
});

test("refuses a default variant that is not an own variant", () => {
  assert.throws(() =>
    assertFlagdDocument(
      doc({ x: { state: "ENABLED", variants: {}, defaultVariant: "toString" } })
    )
  );
});

test("refuses an invalid state", () => {
  assert.throws(() =>
    assertFlagdDocument(
      doc({ x: { state: "enabled", variants: { on: true }, defaultVariant: "on" } })
    )
  );
});

test("refuses an invalid targeting rule", () => {
  assert.throws(() =>
    assertFlagdDocument(
      doc({
        x: {
          state: "ENABLED",
          variants: { on: true },
          defaultVariant: "on",
          targeting: { nope: [1] }
        }
      })
    )
  );
});

test("never sends a token over http:", async () => {
  await assert.rejects(
    fetchFlagsDocument("http://flags.example.com", "secret", "abc"),
    /must use https/
  );
});
