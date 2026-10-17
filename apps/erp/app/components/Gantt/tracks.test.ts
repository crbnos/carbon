// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { assignTracks } from "./tracks";

describe("assignTracks", () => {
  it("keeps back-to-back bars on one track", () => {
    expect(
      assignTracks([
        { offset: 0, duration: 10 },
        { offset: 10, duration: 5 },
        { offset: 20, duration: 5 }
      ])
    ).toEqual({ tracks: [0, 0, 0], trackCount: 1 });
  });

  it("opens a second track only for an overlap", () => {
    expect(
      assignTracks([
        { offset: 0, duration: 10 },
        { offset: 5, duration: 10 },
        { offset: 10, duration: 5 }
      ])
    ).toEqual({ tracks: [0, 1, 0], trackCount: 2 });
  });

  it("reports tracks in input order regardless of start order", () => {
    expect(
      assignTracks([
        { offset: 5, duration: 10 },
        { offset: 0, duration: 10 }
      ])
    ).toEqual({ tracks: [1, 0], trackCount: 2 });
  });

  it("uses one track for an empty row", () => {
    expect(assignTracks([])).toEqual({ tracks: [], trackCount: 1 });
  });
});
