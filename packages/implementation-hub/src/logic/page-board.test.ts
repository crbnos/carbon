// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import type { PageCard, PageSection } from "./page";
import { buildPageBoard } from "./page-board";

const card = (id: string, overrides: Partial<PageCard> = {}): PageCard => ({
  id,
  kind: "setup",
  title: id,
  evidence: [],
  tick: {
    itemKey: `check:${id}`,
    kind: "check",
    on: "1",
    off: "0",
    meaning: "done"
  },
  ...overrides
});

const section = (cards: PageCard[]): PageSection => ({
  id: "section-0",
  title: "Before go-live",
  cards
});

// Today is 2026-11-01; "due soon" runs to 2026-11-15.
const board = (
  pages: { userId: string; sections: PageSection[] }[],
  ticked: string[] = []
) =>
  buildPageBoard(
    pages,
    new Map(ticked.map((id) => [`check:${id}`, "1"])),
    new Map(),
    "2026-11-01",
    "2026-11-15"
  );

const ids = (column: { card: PageCard }[]) =>
  column.map((entry) => entry.card.id);

describe("buildPageBoard", () => {
  it("puts each open card in its column by due date", () => {
    const result = board([
      {
        userId: "alex",
        sections: [
          section([
            card("late", { due: "2026-10-30" }),
            card("today", { due: "2026-11-01" }),
            card("in-two-weeks", { due: "2026-11-15" }),
            card("next-month", { due: "2026-12-01" }),
            card("undated")
          ])
        ]
      }
    ]);
    expect(ids(result.overdue)).toEqual(["late"]);
    expect(ids(result.dueSoon)).toEqual(["today", "in-two-weeks"]);
    expect(ids(result.later)).toEqual(["next-month", "undated"]);
    expect(result.done).toEqual([]);
  });

  it("puts a ticked card in done, whatever its due date", () => {
    const result = board(
      [
        {
          userId: "alex",
          sections: [section([card("late", { due: "2026-10-30" })])]
        }
      ],
      ["late"]
    );
    expect(ids(result.done)).toEqual(["late"]);
    expect(result.overdue).toEqual([]);
  });

  it("leaves out cards that cannot be done and cards removed from the catalogue", () => {
    const result = board([
      {
        userId: "alex",
        sections: [
          section([
            card("training", { kind: "training", tick: null }),
            card("decision", {
              kind: "requirement",
              tick: {
                itemKey: "flag:x",
                kind: "scopeFlag",
                on: "1",
                off: "0",
                meaning: "scope"
              }
            }),
            card("removed", { missing: true })
          ])
        ]
      }
    ]);
    expect(Object.values(result).flat()).toEqual([]);
  });

  it("orders cards from several pages by due date and keeps whose they are", () => {
    const result = board([
      {
        userId: "alex",
        sections: [section([card("a", { due: "2026-10-31" })])]
      },
      { userId: "sam", sections: [section([card("b", { due: "2026-10-20" })])] }
    ]);
    expect(
      result.overdue.map((entry) => [entry.userId, entry.card.id])
    ).toEqual([
      ["sam", "b"],
      ["alex", "a"]
    ]);
  });
});
