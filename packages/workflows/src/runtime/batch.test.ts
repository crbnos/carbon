import { describe, expect, it } from "vitest";
import { itemKeyFor, planBatch } from "./batch";
import { entityValue, listValue, primitiveValue } from "./values";

describe("planBatch", () => {
  it("slices past the cap and reports what was left out", () => {
    const list = listValue(
      { kind: "entity", of: "part" },
      Array.from({ length: 150 }, (_, i) => entityValue("part", `p${i}`))
    ).value;
    // listValue already caps, so build the oversized list directly.
    const oversized = {
      ...list,
      items: Array.from({ length: 150 }, (_, i) => entityValue("part", `p${i}`))
    };
    const { items, dropped } = planBatch(oversized);
    expect(items).toHaveLength(100);
    expect(dropped).toBe(50);
  });

  it("treats a single value as one turn", () => {
    expect(planBatch(entityValue("part", "p1"))).toEqual({
      items: [entityValue("part", "p1")],
      dropped: 0
    });
  });
});

describe("itemKeyFor", () => {
  it("uses a record's own id", () => {
    expect(itemKeyFor(entityValue("part", "p1"))).toBe("p1");
    expect(itemKeyFor(entityValue("job", "p1"))).toBe("p1");
  });

  it("is the same for equal values whatever their position", () => {
    const a = primitiveValue("string", "acme");
    const b = primitiveValue("string", "acme");
    expect(itemKeyFor(a)).toBe(itemKeyFor(b));
  });

  it("differs for different values", () => {
    expect(itemKeyFor(primitiveValue("number", 1))).not.toBe(
      itemKeyFor(primitiveValue("number", 2))
    );
  });

  it("hashes to sixteen hex characters", () => {
    expect(itemKeyFor(primitiveValue("string", "acme"))).toMatch(
      /^h:[0-9a-f]{16}$/
    );
  });
});
