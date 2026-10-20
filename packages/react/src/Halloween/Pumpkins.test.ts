// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { MOUTH } from "./Pumpkins";

const commands = (d: string) => d.replace(/[^A-Za-z]/g, "");
const numbers = (d: string) => d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];

describe("the cackling mouth", () => {
  // SMIL only morphs a path between shapes with the same commands; any
  // difference and the mouth snaps instead of opening.
  it("opens and shuts through shapes SMIL can morph between", () => {
    expect(commands(MOUTH.half)).toBe(commands(MOUTH.shut));
    expect(commands(MOUTH.wide)).toBe(commands(MOUTH.shut));
    expect(numbers(MOUTH.wide)).toHaveLength(numbers(MOUTH.shut).length);
  });
});
