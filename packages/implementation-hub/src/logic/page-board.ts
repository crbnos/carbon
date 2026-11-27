// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ImplementationRowData } from "../types";
import { isOverdue } from "./assignments";
import { cardState, type PageCard, type PageSection } from "./page";

// Carbon staff's board of every card on every page in a company, so late and
// coming work is seen without opening each page. Only cards that can be done
// are on it: training and decisions have no done state.
export type PageBoardColumn = "overdue" | "dueSoon" | "later" | "done";

export const PAGE_BOARD_COLUMNS: PageBoardColumn[] = [
  "overdue",
  "dueSoon",
  "later",
  "done"
];

export interface PageBoardCard {
  userId: string;
  section: string;
  card: PageCard;
}

// Pure: each card in its column. Overdue: open and past its due date. Due
// soon: open and due today up to `soonUntil`. Later: open, due after that or
// with no date. Done. Columns run by due date, undated cards last.
export function buildPageBoard(
  pages: { userId: string; sections: PageSection[] }[],
  states: Map<string, string>,
  rows: Map<string, ImplementationRowData>,
  today: string,
  soonUntil: string
): Record<PageBoardColumn, PageBoardCard[]> {
  const board: Record<PageBoardColumn, PageBoardCard[]> = {
    overdue: [],
    dueSoon: [],
    later: [],
    done: []
  };
  for (const { userId, sections } of pages) {
    for (const section of sections) {
      for (const card of section.cards) {
        if (card.missing) continue;
        const { done } = cardState(card, states, rows);
        if (done === null) continue;
        const entry = { userId, section: section.title, card };
        if (done) board.done.push(entry);
        else if (isOverdue(card.due, done, today)) board.overdue.push(entry);
        else if (card.due && card.due <= soonUntil) board.dueSoon.push(entry);
        else board.later.push(entry);
      }
    }
  }
  const byDue = (a: PageBoardCard, b: PageBoardCard) =>
    (a.card.due ?? "9999-12-31").localeCompare(b.card.due ?? "9999-12-31");
  for (const column of PAGE_BOARD_COLUMNS) board[column].sort(byDue);
  return board;
}
