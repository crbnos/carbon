// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";
import { drawingRecordsOf } from "./onshape-drawing-source";

// Import stub: the package opens Redis and Supabase clients at import.
vi.mock("@carbon/ee/onshape", () => ({ selectInBatches: vi.fn() }));

describe("drawingRecordsOf", () => {
  it("reads each drawing's file name, source key and size flag", () => {
    expect(
      drawingRecordsOf({
        drawings: {
          drw1: { sourceKey: "k1", fileName: "Plate.pdf" },
          drw2: { sourceKey: "k2", fileName: "Pin.pdf", tooLarge: true },
          drw3: { sourceKey: null, fileName: "Bracket.pdf" }
        }
      })
    ).toEqual({
      drw1: { sourceKey: "k1", fileName: "Plate.pdf" },
      drw2: { sourceKey: "k2", fileName: "Pin.pdf", tooLarge: true },
      drw3: { sourceKey: null, fileName: "Bracket.pdf" }
    });
  });

  it("drops a record with no file name, so its drawing exports again", () => {
    expect(
      drawingRecordsOf({ drawings: { drw1: "k1", drw2: { sourceKey: "k2" } } })
    ).toEqual({});
    expect(drawingRecordsOf(null)).toEqual({});
  });
});
