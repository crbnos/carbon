// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Pure: the prompt staff copy from the load dialog to have Claude, or any
// assistant, draft one person's page file. Everything it needs is in the text:
// the person, the page format and its rules, the company's priority set with
// the cards that serve each feature, and every card the page can place.

import type { PriorityCategory } from "../content/priority-set";

export interface PagePromptCard {
  item: string;
  type: string;
  group?: string;
  title: string;
}

export interface PagePromptFeature {
  key: string;
  name: string;
  category: PriorityCategory;
}

export interface PagePromptInput {
  person: { name: string; email: string };
  today: string;
  catalogue: PagePromptCard[];
  // Placed features of the company's priority set, category 0 and 1.
  features: PagePromptFeature[];
  // The priority set as staff download it, for its answers; null when unanswered.
  prioritySet: string | null;
  // Whether this person may hold the priority set's questionnaire card.
  mayHoldPriorityCard: boolean;
  priorityCard: string;
  featureCards: Partial<Record<string, readonly string[]>>;
}

const CATEGORY_HEADING: Partial<Record<PriorityCategory, string>> = {
  0: "Needed before go-live",
  1: "Needed in the first months"
};

export function pageDraftPrompt(input: PagePromptInput): string {
  const { person, today, catalogue, features, prioritySet } = input;
  const known = new Set(catalogue.map((card) => card.item));
  const lines: string[] = [];
  const out = (...more: string[]) => lines.push(...more);

  out(
    "Draft one person's page for Carbon's Implementation Hub.",
    "The page lists what this person does to get their company live on Carbon. Carbon staff review your draft and load it.",
    "",
    "## The person",
    `- Name: ${person.name}`,
    `- Email: ${person.email}`,
    "- Role and what they own: (add what you know before sending)",
    "",
    "## Answer with the page as JSON and nothing else",
    "```json",
    JSON.stringify(
      {
        version: 1,
        user: person.email,
        sections: [
          {
            title: "Before go-live",
            cards: [
              {
                item: "setup:parts",
                due: "YYYY-MM-DD",
                note: "Start with the parts on open orders."
              },
              {
                custom: {
                  key: "agree-approval-limits",
                  title: "Agree approval limits",
                  text: "Optional longer text.",
                  link: "/x/settings/approval-rules"
                }
              }
            ]
          }
        ]
      },
      null,
      2
    ),
    "```",
    "",
    "## Rules",
    `- "user" is exactly ${person.email}.`,
    '- A card is either "item", a key from the card list below, or "custom": a key of lowercase letters, digits and hyphens that is unique on the page, a title, and optional "text" and "link" (a Carbon path starting with /x/, or an https link).',
    "- Use each item key once.",
    `- "due" is optional: a date after ${today}, as YYYY-MM-DD. "note" is optional: one or two sentences for this person.`,
    "- Keep the page short: two to four sections, five to fifteen cards, only what this person owns. Put setup before the work that needs it.",
    input.mayHoldPriorityCard
      ? `- Use "${input.priorityCard}" only if this person answers the priority set for the company.`
      : `- Do not use "${input.priorityCard}": someone else answers the priority set.`,
    ""
  );

  out("## What the company needs");
  const placed = features.filter(
    (feature) => CATEGORY_HEADING[feature.category]
  );
  if (placed.length === 0) {
    out(
      "The priority set is not answered yet. Build the page from the person's role.",
      ""
    );
  }
  for (const category of [0, 1] as const) {
    const inCategory = placed.filter(
      (feature) => feature.category === category
    );
    if (inCategory.length === 0) continue;
    out("", `### ${CATEGORY_HEADING[category]}`);
    for (const feature of inCategory) {
      const cards = (input.featureCards[feature.key] ?? []).filter((item) =>
        known.has(item)
      );
      out(`- ${feature.name}${cards.length ? `: ${cards.join(", ")}` : ""}`);
    }
  }
  if (prioritySet) {
    out("", "### The priority set as staff see it", "", prioritySet.trim());
  }

  out("", "## Cards", "key | type | group | title");
  for (const card of catalogue) {
    out(`${card.item} | ${card.type} | ${card.group ?? ""} | ${card.title}`);
  }
  return `${lines.join("\n")}\n`;
}
