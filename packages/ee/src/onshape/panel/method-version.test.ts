import { describe, expect, it } from "vitest";
import { correlateCopiedLines } from "./method-version";

const line = (id: string, itemId: string | null, order: number | null) => ({
  id,
  itemId,
  order
});

describe("correlateCopiedLines", () => {
  it("pairs each source line with the copy of the same component", () => {
    const paired = correlateCopiedLines(
      [line("s1", "item-a", 1), line("s2", "item-b", 2)],
      [line("t1", "item-a", 1), line("t2", "item-b", 2)]
    );
    expect(paired.get("s1")).toBe("t1");
    expect(paired.get("s2")).toBe("t2");
  });

  it("keeps repeated components distinct, in order", () => {
    const paired = correlateCopiedLines(
      [line("s1", "item-a", 1), line("s2", "item-a", 5)],
      [line("t2", "item-a", 5), line("t1", "item-a", 1)]
    );
    expect(paired.get("s1")).toBe("t1");
    expect(paired.get("s2")).toBe("t2");
  });

  it("ignores a component the copy does not contain", () => {
    const paired = correlateCopiedLines(
      [line("s1", "item-a", 1), line("s2", "item-gone", 2)],
      [line("t1", "item-a", 1)]
    );
    expect(paired.get("s1")).toBe("t1");
    expect(paired.has("s2")).toBe(false);
  });

  it("leaves the surplus unmapped when the copy has fewer of a component", () => {
    const paired = correlateCopiedLines(
      [line("s1", "item-a", 1), line("s2", "item-a", 2)],
      [line("t1", "item-a", 1)]
    );
    expect(paired.get("s1")).toBe("t1");
    expect(paired.has("s2")).toBe(false);
    expect(paired.size).toBe(1);
  });

  it("never maps two source lines onto the same copy", () => {
    const paired = correlateCopiedLines(
      [line("s1", "item-a", 1), line("s2", "item-a", 1)],
      [line("t1", "item-a", 1), line("t2", "item-a", 1)]
    );
    expect(new Set(paired.values()).size).toBe(paired.size);
  });

  it("skips lines with no component rather than guessing", () => {
    const paired = correlateCopiedLines(
      [line("s1", null, 1)],
      [line("t1", null, 1)]
    );
    expect(paired.size).toBe(0);
  });

  it("tolerates a null order on either side", () => {
    const paired = correlateCopiedLines(
      [line("s1", "item-a", null)],
      [line("t1", "item-a", null)]
    );
    expect(paired.get("s1")).toBe("t1");
  });
});
