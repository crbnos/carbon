// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import { workInstructionFromText } from "./shared.service";

it("clears to {} rather than null, which the NOT NULL column refuses", () => {
  expect(workInstructionFromText("")).toEqual({});
  expect(workInstructionFromText("  \n ")).toEqual({});
});

it("stores text as the editor's document", () => {
  expect(workInstructionFromText("Torque to **12 Nm**")).toMatchObject({
    type: "doc"
  });
});
