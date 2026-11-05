// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import { hidesSupersededJournals } from "./accounting.utils";

it.each([
  ["no status is asked for", { status: null }],
  [
    "a filter on another column has a value",
    { status: null, filters: [{ column: "sourceType", value: "Manual" }] }
  ],
  [
    "a status filter has no value",
    { status: null, filters: [{ column: "status", value: "" }] }
  ]
])("hides Superseded journals when %s", (_label, args) => {
  expect(hidesSupersededJournals(args)).toBe(true);
});

it.each([
  ["the status param asks for one", { status: "Superseded" }],
  [
    "a table filter on status has a value",
    { status: null, filters: [{ column: "status", value: "Superseded" }] }
  ]
])("shows Superseded journals when %s", (_label, args) => {
  expect(hidesSupersededJournals(args)).toBe(false);
});
