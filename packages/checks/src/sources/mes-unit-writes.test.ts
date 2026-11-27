// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  UNIT_PICK_ALLOW_LIST,
  UNIT_WRITE_ALLOW_LIST,
  unitPickers,
  unitWriters
} from "./mes-unit-writes";
import { repoRoot } from "./migrations";
import { loadTypescriptFiles } from "./typescript";

describe("the MES unit writers", () => {
  const files = loadTypescriptFiles(repoRoot());

  it("are still what every allow-list entry names", () => {
    // A stale entry would pre-approve the next writer added under its name.
    expect(unitWriters(files)).toEqual(
      expect.arrayContaining(Object.keys(UNIT_WRITE_ALLOW_LIST))
    );
    expect(unitPickers(files)).toEqual(
      Object.keys(UNIT_PICK_ALLOW_LIST).sort()
    );
  });
});
