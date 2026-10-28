// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { type MemberPage, memberPageCustomCardValidator } from "../models";
import {
  editCard,
  editPage,
  editSection,
  moveCard,
  moveCardToSection,
  moveSection,
  newCustomKey,
  pageCardIds,
  parseOptionLines,
  placeCard,
  removeCard,
  removeSection,
  rowItem
} from "./page-edit";

const base = (overrides: Partial<MemberPage> = {}): MemberPage => ({
  version: 1,
  user: "ops@example.com",
  sections: [
    {
      title: "Before go-live",
      cards: [{ item: "setup:locations" }, { item: "task:first-quote" }]
    },
    {
      title: "First week",
      cards: [{ custom: { key: "walk-the-floor", title: "Walk the floor" } }]
    }
  ],
  ...overrides
});

describe("placeCard", () => {
  it("adds the card at the end of the chosen section", () => {
    expect(placeCard(base(), { item: "data:items" }, { section: 1 })).toEqual(
      base({
        sections: [
          base().sections[0]!,
          {
            title: "First week",
            cards: [
              { custom: { key: "walk-the-floor", title: "Walk the floor" } },
              { item: "data:items" }
            ]
          }
        ]
      })
    );
  });

  it("starts a new section at the end of the page with the card", () => {
    const placed = placeCard(
      base(),
      { item: "data:items" },
      { newSection: "  Data  " }
    );
    expect(placed?.sections.at(-1)).toEqual({
      title: "Data",
      cards: [{ item: "data:items" }]
    });
    expect(placed?.sections).toHaveLength(3);
  });

  it.each([{ section: 5 }, { newSection: "   " }])(
    "places nothing for a missing section or an untitled new one (%o)",
    (target) => {
      expect(placeCard(base(), { item: "data:items" }, target)).toBeNull();
    }
  );
});

describe("removeCard", () => {
  it("removes the card and keeps the section while it has others", () => {
    expect(removeCard(base(), 0, 0)?.sections[0]).toEqual({
      title: "Before go-live",
      cards: [{ item: "task:first-quote" }]
    });
  });

  it("removes a section with its last card", () => {
    expect(removeCard(base(), 1, 0)?.sections).toEqual([base().sections[0]]);
  });

  it("refuses the page's only card", () => {
    const one = base({
      sections: [{ title: "Only", cards: [{ item: "setup:locations" }] }]
    });
    expect(removeCard(one, 0, 0)).toBeNull();
  });
});

describe("removeSection", () => {
  it("removes the section with all its cards", () => {
    expect(removeSection(base(), 0)?.sections).toEqual([base().sections[1]]);
  });

  it("refuses the page's only section", () => {
    expect(
      removeSection(base({ sections: [base().sections[0]!] }), 0)
    ).toBeNull();
  });
});

describe("moving", () => {
  it("swaps a card with its neighbour", () => {
    expect(moveCard(base(), 0, 0, 1).sections[0]?.cards).toEqual([
      { item: "task:first-quote" },
      { item: "setup:locations" }
    ]);
  });

  it("leaves a card at the end of its section where it is", () => {
    expect(moveCard(base(), 0, 1, 1)).toEqual(base());
    expect(moveCard(base(), 0, 0, -1)).toEqual(base());
  });

  it("swaps a section with its neighbour", () => {
    expect(
      moveSection(base(), 1, -1).sections.map((section) => section.title)
    ).toEqual(["First week", "Before go-live"]);
  });

  it("moves a card to the end of another section", () => {
    expect(moveCardToSection(base(), 0, 0, 1)?.sections).toEqual([
      { title: "Before go-live", cards: [{ item: "task:first-quote" }] },
      {
        title: "First week",
        cards: [
          { custom: { key: "walk-the-floor", title: "Walk the floor" } },
          { item: "setup:locations" }
        ]
      }
    ]);
  });

  it("drops the section a moved card leaves empty", () => {
    expect(
      moveCardToSection(base(), 1, 0, 0)?.sections.map(
        (section) => section.cards.length
      )
    ).toEqual([3]);
  });

  it("moves nothing to the same or a missing section", () => {
    expect(moveCardToSection(base(), 0, 0, 0)).toBeNull();
    expect(moveCardToSection(base(), 0, 0, 4)).toBeNull();
  });
});

describe("editing text", () => {
  it("sets and clears the page's title and intro", () => {
    const titled = editPage(base(), { title: " Ops ", intro: "Start here" });
    expect(titled).toEqual(base({ title: "Ops", intro: "Start here" }));
    expect(editPage(titled, { title: "", intro: "  " })).toEqual(base());
  });

  it("keeps a section's title when it is cleared, and drops a cleared intro", () => {
    const edited = editSection(base(), 0, {
      title: "",
      intro: "Do these first"
    });
    expect(edited.sections[0]).toEqual({
      ...base().sections[0],
      intro: "Do these first"
    });
    expect(editSection(edited, 0, { intro: "" }).sections[0]).toEqual(
      base().sections[0]
    );
  });

  it("sets a hub item's title, note and due date, and clears them again", () => {
    const edited = editCard(base(), 0, 0, {
      title: "Add your sites",
      note: "Both plants",
      due: "2026-11-20"
    });
    expect(edited.sections[0]?.cards[0]).toEqual({
      item: "setup:locations",
      title: "Add your sites",
      note: "Both plants",
      due: "2026-11-20"
    });
    expect(
      editCard(edited, 0, 0, { title: "", note: "", due: "" }).sections[0]
        ?.cards[0]
    ).toEqual({ item: "setup:locations" });
  });

  it("edits a custom card inside custom, and keeps its title and key when the title is cleared", () => {
    const edited = editCard(base(), 1, 0, {
      title: "",
      text: "With the shift lead",
      link: "/x/resources/work-centers"
    });
    expect(edited.sections[1]?.cards[0]).toEqual({
      custom: {
        key: "walk-the-floor",
        title: "Walk the floor",
        text: "With the shift lead",
        link: "/x/resources/work-centers"
      }
    });
  });
});

describe("newCustomKey", () => {
  it("makes a key the page format accepts from the title", () => {
    const key = newCustomKey("Review the Q4 forecast!", []);
    expect(key).toBe("review-the-q4-forecast");
    expect(
      memberPageCustomCardValidator.safeParse({ key, title: "x" }).success
    ).toBe(true);
  });

  it("counts up past keys already on the page", () => {
    expect(newCustomKey("Walk the floor", ["walk-the-floor"])).toBe(
      "walk-the-floor-2"
    );
    expect(
      newCustomKey("Walk the floor", ["walk-the-floor", "walk-the-floor-2"])
    ).toBe("walk-the-floor-3");
  });

  it("falls back to card for a title with no letters or digits", () => {
    expect(newCustomKey("¿¿??", [])).toBe("card");
  });
});

describe("rowItem", () => {
  it.each([
    ["golive", "cutover:row_1"],
    ["question", "question:row_1"],
    ["setup", "setup:row_1"]
  ])("places a %s row by its catalogue key", (collection, item) => {
    expect(rowItem(collection, "row_1")).toBe(item);
  });

  it("has no key for a collection no page shows", () => {
    expect(rowItem("contact", "row_1")).toBeNull();
  });
});

describe("page helpers", () => {
  it("lists every card on the page by its page id", () => {
    expect(pageCardIds(base())).toEqual(
      new Set(["setup:locations", "task:first-quote", "custom:walk-the-floor"])
    );
  });

  it("reads options one per line, without blanks or repeats", () => {
    expect(parseOptionLines(" Yes \n\nNo\nYes\n")).toEqual(["Yes", "No"]);
  });
});
