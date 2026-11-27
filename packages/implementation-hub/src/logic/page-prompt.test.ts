// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { FEATURE_CARDS } from "../content/feature-cards";
import { PRIORITY_CARD } from "../content/page";
import { PRIORITY_FEATURES } from "../content/priority-set";
import { buildPageCatalogue } from "./page";
import { type PagePromptInput, pageDraftPrompt } from "./page-prompt";

const templateKeys = new Set(buildPageCatalogue([]).map((entry) => entry.item));

describe("FEATURE_CARDS", () => {
  it("names only priority set features", () => {
    const features = new Set(PRIORITY_FEATURES.map((feature) => feature.key));
    for (const key of Object.keys(FEATURE_CARDS)) {
      expect(features, key).toContain(key);
    }
  });

  it("names only cards the template catalogue places", () => {
    for (const [feature, cards] of Object.entries(FEATURE_CARDS)) {
      for (const card of cards ?? []) {
        expect(templateKeys, `${feature}: ${card}`).toContain(card);
      }
    }
  });
});

const input = (overrides: Partial<PagePromptInput> = {}): PagePromptInput => ({
  person: { name: "Alex Planner", email: "alex@example.com" },
  today: "2026-11-01",
  catalogue: [
    { item: "setup:parts", type: "Setup", group: "Items", title: "Parts" },
    {
      item: "data:parts",
      type: "Data",
      group: "Master records",
      title: "Parts & items"
    }
  ],
  features: [
    { key: "items.parts", name: "Parts", category: 0 },
    { key: "sales.quotes", name: "Quotes", category: 1 },
    { key: "sales.rentals", name: "Rental agreements", category: 3 }
  ],
  prioritySet: "# Priority set: Example Co",
  mayHoldPriorityCard: false,
  priorityCard: PRIORITY_CARD.item,
  featureCards: FEATURE_CARDS,
  ...overrides
});

describe("pageDraftPrompt", () => {
  it("names the person and asks for their email as the page's user", () => {
    const prompt = pageDraftPrompt(input());
    expect(prompt).toContain("- Name: Alex Planner");
    expect(prompt).toContain('"user" is exactly alex@example.com.');
    expect(prompt).toContain('"user": "alex@example.com"');
  });

  it("lists the features before go-live and in the first months, with the cards in the list", () => {
    const prompt = pageDraftPrompt(input());
    expect(prompt).toContain(
      "### Needed before go-live\n- Parts: setup:parts, data:parts"
    );
    // Quotes' cards are not in this catalogue, so none are suggested.
    expect(prompt).toContain("### Needed in the first months\n- Quotes\n");
    expect(prompt).not.toContain("Rental agreements");
  });

  it("says when the priority set is not answered", () => {
    const prompt = pageDraftPrompt(input({ features: [], prioritySet: null }));
    expect(prompt).toContain("The priority set is not answered yet.");
    expect(prompt).not.toContain("### The priority set as staff see it");
  });

  it("allows the priority set card only to a person who may hold it", () => {
    expect(pageDraftPrompt(input())).toContain(
      `Do not use "${PRIORITY_CARD.item}"`
    );
    expect(pageDraftPrompt(input({ mayHoldPriorityCard: true }))).toContain(
      `Use "${PRIORITY_CARD.item}" only if this person answers`
    );
  });

  it("lists every card with its key", () => {
    const prompt = pageDraftPrompt(input());
    expect(prompt).toContain("setup:parts | Setup | Items | Parts");
    expect(prompt).toContain(
      "data:parts | Data | Master records | Parts & items"
    );
  });
});
