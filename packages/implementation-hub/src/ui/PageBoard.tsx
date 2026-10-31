// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Badge, Card, CardHeader, CardTitle, cn } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { PAGE_CARD_TYPE, PAGE_CARD_TYPE_LABEL } from "../content/page";
import {
  PAGE_BOARD_COLUMNS,
  type PageBoardCard,
  type PageBoardColumn
} from "../logic/page-board";

const COLUMN_LABEL: Record<PageBoardColumn, MessageDescriptor> = {
  overdue: msg`Overdue`,
  dueSoon: msg`Due in the next two weeks`,
  later: msg`Later or no date`,
  done: msg`Done`
};

// Carbon staff only: every card on every page in the company, in columns by
// due date. Read only; a card opens its person's page, where it is ticked.
export function PageBoard({
  board,
  nameOf,
  onOpen
}: {
  board: Record<PageBoardColumn, PageBoardCard[]>;
  nameOf: (userId: string) => string;
  onOpen: (userId: string) => void;
}) {
  const { i18n } = useLingui();
  const empty = PAGE_BOARD_COLUMNS.every((column) => !board[column].length);
  if (empty) {
    return (
      <p className="w-full max-w-xl mx-auto py-24 text-center text-sm text-muted-foreground">
        <Trans>No page has a card to tick yet.</Trans>
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {PAGE_BOARD_COLUMNS.map((column) => (
        <section key={column} className="flex min-w-0 flex-col gap-2">
          <h2 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {i18n._(COLUMN_LABEL[column])}
            <span className="tabular-nums">{board[column].length}</span>
          </h2>
          {board[column].map(({ userId, section, card }) => {
            const title =
              typeof card.title === "string" ? card.title : i18n._(card.title);
            return (
              <button
                key={`${userId}:${card.id}`}
                type="button"
                className="text-left"
                onClick={() => onOpen(userId)}
              >
                <Card
                  className={cn(
                    "transition-colors hover:bg-muted/60",
                    column === "done" && "bg-muted/40"
                  )}
                >
                  <CardHeader className="gap-1.5 p-3">
                    <span className="truncate text-xxs font-medium uppercase tracking-wide text-muted-foreground">
                      {i18n._(PAGE_CARD_TYPE_LABEL[PAGE_CARD_TYPE[card.kind]])}
                      {section ? ` · ${section}` : ""}
                    </span>
                    <CardTitle
                      className={cn(
                        "text-sm leading-snug",
                        column === "done" &&
                          "line-through text-muted-foreground"
                      )}
                    >
                      {title}
                    </CardTitle>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="truncate">{nameOf(userId)}</span>
                      {card.due && column !== "done" ? (
                        <Badge
                          variant={column === "overdue" ? "red" : "outline"}
                          className="font-normal"
                        >
                          {formatDate(card.due, undefined, i18n.locale)}
                        </Badge>
                      ) : null}
                    </div>
                  </CardHeader>
                </Card>
              </button>
            );
          })}
        </section>
      ))}
    </div>
  );
}
