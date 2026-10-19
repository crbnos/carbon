// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// @ts-expect-error TS7016 - pg ships no types for its parameter serializer
import { prepareValue } from "pg/lib/utils";
import { describe, expect, it } from "vitest";
import { stepSlideCopies } from "./step-slides";

const slide = (stepId: string, annotations: unknown) => ({
  stepId,
  imagePath: "company/step.png",
  modelUploadId: null,
  caption: null,
  sortOrder: 1,
  size: "medium",
  annotations
});

// What node-postgres puts on the wire for a value, parsed the way a jsonb
// column parses it.
const asJsonb = (value: unknown) => JSON.parse(prepareValue(value) as string);

describe("stepSlideCopies", () => {
  it("sends pinned annotations as a JSON array", () => {
    const pins = [{ x: 0.25, y: 0.5, label: "1" }];
    const [row] = stepSlideCopies(
      [slide("old", pins)],
      [{ id: "old" }],
      [{ id: "new" }],
      "company",
      "user"
    );

    expect(row?.stepId).toBe("new");
    expect(asJsonb(row?.annotations)).toEqual(pins);
  });

  it("sends no annotations as an empty array, not an object", () => {
    const rows = stepSlideCopies(
      [slide("old", []), slide("old", null)],
      [{ id: "old" }],
      [{ id: "new" }],
      "company",
      "user"
    );

    expect(rows.map((row) => asJsonb(row.annotations))).toEqual([[], []]);
  });

  it("repairs a source stored as an object instead of passing it on", () => {
    const [row] = stepSlideCopies(
      [slide("old", {})],
      [{ id: "old" }],
      [{ id: "new" }],
      "company",
      "user"
    );

    expect(asJsonb(row?.annotations)).toEqual([]);
  });

  it("drops a slide whose step was not copied", () => {
    const rows = stepSlideCopies(
      [slide("old", []), slide("missing", [])],
      [{ id: "old" }],
      [{ id: "new" }],
      "company",
      "user"
    );

    expect(rows.map((row) => row.stepId)).toEqual(["new"]);
  });
});
