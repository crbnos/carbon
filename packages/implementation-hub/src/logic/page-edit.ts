// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Editing a person's page in the app: every change Carbon staff make to a
// page is one of these, applied to the page as the editor has it, and the
// whole page is saved. Pure, so the page and the server place cards the same
// way. A page needs a section; a section may be left with no cards, and the
// page shows that it has none. A change that would remove the last section
// returns null and nothing is saved.

import type { MemberPage, MemberPageCard } from "../models";

// Where a new card goes: the end of a section, or a new section at the end.
export type PageTarget = { section: number } | { newSection: string };

// The company rows a page can place, and the catalogue prefix of each.
const ROW_ITEM_PREFIX = {
  setup: "setup",
  data: "data",
  golive: "cutover",
  requirement: "requirement",
  objective: "objective",
  question: "question",
  customization: "customization"
} as const;

export type PageRowCollection = keyof typeof ROW_ITEM_PREFIX;

export const PAGE_ROW_COLLECTIONS = Object.keys(
  ROW_ITEM_PREFIX
) as PageRowCollection[];

export const isPageRowCollection = (
  collection: string
): collection is PageRowCollection => collection in ROW_ITEM_PREFIX;

// The payload fields that hold a row's title, its longer text and its link,
// as the catalogue reads them (logic/page.ts).
export const PAGE_ROW_FIELDS: Record<
  PageRowCollection,
  { title: string; detail?: string; link?: string }
> = {
  setup: { title: "object", detail: "today", link: "url" },
  data: { title: "object", detail: "today" },
  golive: { title: "label" },
  requirement: { title: "requirement" },
  objective: { title: "title", detail: "detail" },
  question: { title: "question" },
  customization: { title: "title", detail: "detail" }
};

// The catalogue key a company row is placed by; null for a collection no page
// shows.
export function rowItem(collection: string, rowId: string): string | null {
  return isPageRowCollection(collection)
    ? `${ROW_ITEM_PREFIX[collection]}:${rowId}`
    : null;
}

// Every card on the page, by the id the page check uses: the item key, or
// custom:<key>.
export function pageCardIds(page: MemberPage): Set<string> {
  return new Set(
    page.sections.flatMap((section) =>
      section.cards.map(
        (card) => card.item ?? `custom:${card.custom?.key ?? ""}`
      )
    )
  );
}

const clean = (value: string) => value.trim();

// An optional text: kept when it has text, dropped when it is cleared.
function withText<T extends object, K extends string>(
  value: T,
  key: K,
  text: string | undefined
): T {
  if (text === undefined) return value;
  const next = { ...value } as Record<string, unknown>;
  const trimmed = clean(text);
  if (trimmed) next[key] = trimmed;
  else delete next[key];
  return next as T;
}

export function editPage(
  page: MemberPage,
  patch: { title?: string; intro?: string }
): MemberPage {
  return withText(withText(page, "title", patch.title), "intro", patch.intro);
}

// A section keeps its title: clearing it changes nothing.
export function editSection(
  page: MemberPage,
  index: number,
  patch: { title?: string; intro?: string }
): MemberPage {
  return {
    ...page,
    sections: page.sections.map((section, s) => {
      if (s !== index) return section;
      const title = patch.title === undefined ? "" : clean(patch.title);
      return withText(
        title ? { ...section, title } : section,
        "intro",
        patch.intro
      );
    })
  };
}

export interface CardPatch {
  // A custom card's title; for a hub item, the title this page shows instead
  // of the item's own (cleared, the item's own shows again).
  title?: string;
  // A custom card's text and link.
  text?: string;
  link?: string;
  note?: string;
  due?: string;
}

export function editCard(
  page: MemberPage,
  sectionIndex: number,
  cardIndex: number,
  patch: CardPatch
): MemberPage {
  return mapCard(page, sectionIndex, cardIndex, (card) => {
    let next: MemberPageCard = withText(
      withText(card, "note", patch.note),
      "due",
      patch.due
    );
    if (next.custom) {
      const title = patch.title === undefined ? "" : clean(patch.title);
      next = {
        ...next,
        custom: withText(
          withText(
            title ? { ...next.custom, title } : next.custom,
            "text",
            patch.text
          ),
          "link",
          patch.link
        )
      };
    } else {
      next = withText(next, "title", patch.title);
    }
    return next;
  });
}

function mapCard(
  page: MemberPage,
  sectionIndex: number,
  cardIndex: number,
  change: (card: MemberPageCard) => MemberPageCard
): MemberPage {
  return {
    ...page,
    sections: page.sections.map((section, s) =>
      s === sectionIndex
        ? {
            ...section,
            cards: section.cards.map((card, c) =>
              c === cardIndex ? change(card) : card
            )
          }
        : section
    )
  };
}

// A new card at the end of a section, or in a new section at the end of the
// page. Null when the section does not exist or the new one has no title.
export function placeCard(
  page: MemberPage,
  card: MemberPageCard,
  target: PageTarget
): MemberPage | null {
  if ("newSection" in target) {
    const title = clean(target.newSection);
    if (!title) return null;
    return {
      ...page,
      sections: [...page.sections, { title, cards: [card] }]
    };
  }
  if (!page.sections[target.section]) return null;
  return {
    ...page,
    sections: page.sections.map((section, s) =>
      s === target.section
        ? { ...section, cards: [...section.cards, card] }
        : section
    )
  };
}

// The card leaves the page. Its section stays, even with no cards left, until
// staff remove the section. Null for a card that does not exist.
export function removeCard(
  page: MemberPage,
  sectionIndex: number,
  cardIndex: number
): MemberPage | null {
  if (!page.sections[sectionIndex]?.cards[cardIndex]) return null;
  return {
    ...page,
    sections: page.sections.map((section, s) =>
      s === sectionIndex
        ? {
            ...section,
            cards: section.cards.filter((_, c) => c !== cardIndex)
          }
        : section
    )
  };
}

// The section and its cards leave the page. Null for the page's only section.
export function removeSection(
  page: MemberPage,
  sectionIndex: number
): MemberPage | null {
  if (page.sections.length <= 1 || !page.sections[sectionIndex]) return null;
  return {
    ...page,
    sections: page.sections.filter((_, s) => s !== sectionIndex)
  };
}

const swap = <T>(list: T[], from: number, to: number): T[] => {
  if (to < 0 || to >= list.length || !list[from]) return list;
  const next = [...list];
  [next[from], next[to]] = [next[to] as T, next[from] as T];
  return next;
};

// One place up (-1) or down (1) within its section; at either end, unchanged.
export function moveCard(
  page: MemberPage,
  sectionIndex: number,
  cardIndex: number,
  offset: -1 | 1
): MemberPage {
  return {
    ...page,
    sections: page.sections.map((section, s) =>
      s === sectionIndex
        ? {
            ...section,
            cards: swap(section.cards, cardIndex, cardIndex + offset)
          }
        : section
    )
  };
}

export function moveSection(
  page: MemberPage,
  sectionIndex: number,
  offset: -1 | 1
): MemberPage {
  return {
    ...page,
    sections: swap(page.sections, sectionIndex, sectionIndex + offset)
  };
}

// The card goes to the end of another section; the section it leaves stays,
// even when it is left empty. Null for a section that does not exist.
export function moveCardToSection(
  page: MemberPage,
  sectionIndex: number,
  cardIndex: number,
  toSection: number
): MemberPage | null {
  const card = page.sections[sectionIndex]?.cards[cardIndex];
  if (!card || toSection === sectionIndex || !page.sections[toSection]) {
    return null;
  }
  const sections = page.sections.map((section, s) => {
    if (s === sectionIndex) {
      return {
        ...section,
        cards: section.cards.filter((_, c) => c !== cardIndex)
      };
    }
    if (s === toSection) return { ...section, cards: [...section.cards, card] };
    return section;
  });
  return { ...page, sections };
}

// A custom card's key, from its title: a person's tick on the card is stored
// under it, so it is made once and kept when the title changes.
export function newCustomKey(title: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base =
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "card";
  let key = base;
  for (let n = 2; used.has(key); n += 1) key = `${base}-${n}`;
  return key;
}

// The custom card keys already on the page.
export function customKeys(page: MemberPage): string[] {
  return page.sections.flatMap((section) =>
    section.cards.flatMap((card) => (card.custom ? [card.custom.key] : []))
  );
}

// Options typed one per line: trimmed, blank lines and repeats dropped.
export function parseOptionLines(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
    )
  );
}
