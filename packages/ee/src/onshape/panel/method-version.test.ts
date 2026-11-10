// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import {
  correlateCopiedLines,
  pairOwnedCopiedLines,
  pickReusableDraft
} from "./method-version";

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

describe("pairOwnedCopiedLines", () => {
  const owned = (id: string, itemId: string, order: number, quantity = 1) => ({
    id,
    itemId,
    order,
    quantity
  });

  it("does not let an owned line take a manual line's copy", () => {
    // Manual m1 sits before owned o1 on the same component.
    const paired = pairOwnedCopiedLines(
      [owned("m1", "item-a", 1), owned("o1", "item-a", 2)],
      [line("t1", "item-a", 1), line("t2", "item-a", 2)],
      new Set(["o1"])
    );
    expect(paired.get("o1")).toBe("t2");
    expect(paired.has("m1")).toBe(false);
  });

  it("skips source lines the copy dropped for a zero quantity", () => {
    const paired = pairOwnedCopiedLines(
      [owned("z1", "item-a", 1, 0), owned("o1", "item-a", 2)],
      [line("t1", "item-a", 2)],
      new Set(["z1", "o1"])
    );
    expect(paired.get("o1")).toBe("t1");
    expect(paired.has("z1")).toBe(false);
  });

  it("keeps a null quantity, which the copy keeps too", () => {
    const paired = pairOwnedCopiedLines(
      [{ id: "o1", itemId: "item-a", order: 1, quantity: null }],
      [line("t1", "item-a", 1)],
      new Set(["o1"])
    );
    expect(paired.get("o1")).toBe("t1");
  });
});

describe("pickReusableDraft", () => {
  const draft = (
    id: string,
    version: number,
    changeOrderId: string | null = null
  ) => ({
    id,
    version,
    changeOrderId
  });

  it("reuses the newest Draft this integration made from the Active method", () => {
    const chosen = pickReusableDraft(
      [draft("d2", 2), draft("d3", 3)],
      [
        { draftId: "d2", sourceMethodId: "active" },
        { draftId: "d3", sourceMethodId: "active" }
      ],
      "active"
    );
    expect(chosen?.id).toBe("d3");
  });

  it("never reuses a Draft without a marker (a person's, or a failed copy)", () => {
    expect(pickReusableDraft([draft("d2", 2)], [], "active")).toBeNull();
  });

  it("never reuses a change notice's Draft", () => {
    expect(
      pickReusableDraft(
        [draft("d2", 2, "co-1")],
        [{ draftId: "d2", sourceMethodId: "active" }],
        "active"
      )
    ).toBeNull();
  });

  it("never reuses a Draft copied from an older Active version", () => {
    expect(
      pickReusableDraft(
        [draft("d2", 2)],
        [{ draftId: "d2", sourceMethodId: "older-active" }],
        "active"
      )
    ).toBeNull();
  });
});
