import { describe, expect, it } from "vitest";
import { planPartPush } from "./push-plan";

const part = (over: Record<string, unknown> = {}) => ({
  partId: "p1",
  name: "Foot pad",
  partNumber: "PAD-005" as string | null,
  revision: null,
  microversionId: "m2",
  ...over
});

const mapping = {
  entityId: "item-1",
  externalId: "d:e:p1",
  lastSyncedAt: null
};
const item = { id: "item-2", readableId: "PAD-005", revision: "0", name: "x" };

describe("planPartPush", () => {
  it("skips an unmapped part without a part number", () => {
    expect(
      planPartPush({
        part: part({ partNumber: null }),
        mapping: undefined,
        mappingMicroversionId: undefined,
        matchedItem: undefined
      })
    ).toEqual({ action: "skip-no-part-number" });
  });

  it("creates when nothing matches, adopts a part-number match", () => {
    expect(
      planPartPush({
        part: part(),
        mapping: undefined,
        mappingMicroversionId: undefined,
        matchedItem: undefined
      })
    ).toEqual({ action: "create" });
    expect(
      planPartPush({
        part: part(),
        mapping: undefined,
        mappingMicroversionId: undefined,
        matchedItem: item
      })
    ).toEqual({ action: "adopt", itemId: "item-2" });
  });

  it("mapping wins over a match; microversion equality means unchanged", () => {
    expect(
      planPartPush({
        part: part(),
        mapping,
        mappingMicroversionId: "m1",
        matchedItem: item
      })
    ).toEqual({ action: "update", itemId: "item-1" });
    expect(
      planPartPush({
        part: part(),
        mapping,
        mappingMicroversionId: "m2",
        matchedItem: item
      })
    ).toEqual({ action: "unchanged", itemId: "item-1" });
  });

  it("a mapped part with no microversion info re-pushes rather than skips", () => {
    expect(
      planPartPush({
        part: part({ microversionId: undefined }),
        mapping,
        mappingMicroversionId: "m1",
        matchedItem: undefined
      })
    ).toEqual({ action: "update", itemId: "item-1" });
  });
});
