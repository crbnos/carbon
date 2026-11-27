// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The table a person's page is shown in, one row per card, for the person
// and for Carbon staff editing it. A row that opens its card is a button
// stretched over the row; the controls in a row sit above it. Below the md
// breakpoint each row stacks into a block, so a phone never scrolls sideways.

import { Badge, cn, Table, Tbody, Td, Th, Thead, Tr } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import type { MessageDescriptor } from "@lingui/core";
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { LuChevronRight } from "react-icons/lu";
import { PAGE_CARD_TYPE, PAGE_CARD_TYPE_LABEL } from "../content/page";
import type { PageCard } from "../logic/page";

type Text = MessageDescriptor | string | undefined;

export function useCardText() {
  const { i18n } = useLingui();
  return (value: Text) =>
    value === undefined || typeof value === "string" ? value : i18n._(value);
}

export interface PageTableHeader {
  key: string;
  label: string;
  className?: string;
}

export function PageTable({
  headers,
  children
}: {
  headers: PageTableHeader[];
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card">
      <Table full className="max-md:block">
        <Thead className="max-md:hidden">
          <Tr>
            {headers.map((header) => (
              <Th
                key={header.key}
                className={cn(
                  "h-9 px-3 text-xs font-medium text-muted-foreground group-hover:bg-transparent",
                  header.className
                )}
              >
                {header.label}
              </Th>
            ))}
          </Tr>
        </Thead>
        <Tbody className="max-md:block">{children}</Tbody>
      </Table>
    </div>
  );
}

export function PageRow({
  done,
  children
}: {
  done?: boolean;
  children: ReactNode;
}) {
  return (
    <Tr
      className={cn(
        "relative border-b last:border-b-0",
        // Stacked, the row is hovered as one block, not cell by cell.
        "max-md:flex max-md:flex-wrap max-md:items-center max-md:gap-x-3 max-md:gap-y-1.5 max-md:px-4 max-md:py-3 max-md:hover:bg-muted/50",
        done && "bg-muted/30"
      )}
    >
      {children}
    </Tr>
  );
}

export function PageCell({
  controls,
  wide,
  className,
  children
}: {
  // Holds controls: above the row's open button.
  controls?: boolean;
  // Takes the row's full width once rows stack.
  wide?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Td
      className={cn(
        "h-auto px-3 py-2.5 align-top text-sm text-foreground",
        "max-md:block max-md:p-0 max-md:group-hover:bg-transparent",
        // A cell with nothing in it (`NoValue`) leaves the stacked row.
        "max-md:has-[>[data-no-value]]:hidden",
        controls && "relative z-10",
        wide && "max-md:w-full",
        className
      )}
    >
      {children}
    </Td>
  );
}

// The card's type, and where the item sits in the Implementation Hub.
export function CardTypeLabel({
  card,
  group
}: {
  card: PageCard;
  group?: string;
}) {
  const { i18n } = useLingui();
  return (
    <span className="block text-xxs font-medium uppercase tracking-wide text-muted-foreground">
      {i18n._(PAGE_CARD_TYPE_LABEL[PAGE_CARD_TYPE[card.kind]])}
      {group ? (
        <span className="block normal-case tracking-normal font-normal">
          {group}
        </span>
      ) : null}
    </span>
  );
}

// The card's title, the first line of its details and what else it holds.
// With `onOpen` the title is the button that opens the card, stretched over
// the row.
export function CardTitle({
  title,
  detail,
  done,
  openLabel,
  onOpen,
  meta
}: {
  title: string;
  detail?: string;
  done?: boolean;
  openLabel?: string;
  onOpen?: () => void;
  meta?: ReactNode;
}) {
  const firstLine = detail?.split("\n")[0];
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          aria-label={openLabel}
          className={cn(
            "text-left text-sm font-medium leading-snug text-pretty outline-none",
            "after:absolute after:inset-0 after:content-[''] focus-visible:after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-ring",
            done && "text-muted-foreground line-through"
          )}
        >
          {title}
        </button>
      ) : (
        <span
          className={cn(
            "text-sm font-medium leading-snug text-pretty",
            done && "text-muted-foreground line-through"
          )}
        >
          {title}
        </span>
      )}
      {firstLine ? (
        <span className="line-clamp-1 text-xs text-muted-foreground">
          {firstLine}
        </span>
      ) : null}
      {meta ? (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">{meta}</div>
      ) : null}
    </div>
  );
}

// A small fact under a card's title: "Note", "2 files", "Checklist 1/3".
export function MetaChip({
  icon,
  tone = "muted",
  children
}: {
  icon?: ReactNode;
  tone?: "muted" | "attention";
  children: ReactNode;
}) {
  return (
    <Badge
      variant={tone === "attention" ? "yellow" : "gray"}
      className="gap-1 px-1.5 py-0 text-xxs font-normal"
    >
      {icon}
      {children}
    </Badge>
  );
}

export function DueBadge({
  due,
  overdue
}: {
  due: string | undefined;
  overdue: boolean;
}) {
  const { t, i18n } = useLingui();
  if (!due) return <NoValue />;
  return (
    <Badge
      variant={overdue ? "red" : "outline"}
      className="whitespace-nowrap font-normal tabular-nums"
    >
      {overdue ? `${t`Overdue`} ` : ""}
      {formatDate(due, undefined, i18n.locale)}
    </Badge>
  );
}

// A cell with nothing to show: a dash in the table, gone once rows stack.
export function NoValue() {
  return (
    <span data-no-value className="text-xs text-muted-foreground">
      —
    </span>
  );
}

// The hint that a row opens to more than it shows.
export function OpensHint() {
  return (
    <LuChevronRight
      aria-hidden
      className="size-4 text-muted-foreground max-md:hidden"
    />
  );
}
