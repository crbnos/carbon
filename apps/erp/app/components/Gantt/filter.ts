// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { GanttEvent } from "./types";

/** The toolbar's search text and In Process switch. */
export type GanttFilterValue = { text: string; wipOnly: boolean };

/** What the board shows under a filter: the tree rows and the lit bars. */
export type GanttVisibility = {
  active: boolean;
  /**
   * Row (tree node) ids the filter keeps. Collapse is not applied, so a kept
   * row under a collapsed parent is in the set but not on screen.
   */
  rows: Set<string>;
  /** Inline bars (`data.items`) on a shown row that the filter keeps lit. */
  bars: Set<string>;
};

function matchesText(event: GanttEvent, text: string) {
  return event.data.message.toLowerCase().includes(text.toLowerCase());
}

/**
 * The tree's filter: a row passes when it or one of its inline bars is in
 * process (with the switch on), and it or one of its bars matches the search.
 * The two tests may pass on different bars, so a station's name finds its
 * in-process work.
 */
export function rowMatchesFilter(
  value: GanttFilterValue,
  row: GanttEvent
): boolean {
  const events = [row, ...(row.data.items ?? [])];
  return (
    (!value.wipOnly || events.some((event) => event.data.isPartial)) &&
    (value.text === "" ||
      events.some((event) => matchesText(event, value.text)))
  );
}

/** A bar on `row` passes when it is in process and it or its row matches. */
function barPasses(value: GanttFilterValue, bar: GanttEvent, row: GanttEvent) {
  return (
    (!value.wipOnly || bar.data.isPartial) &&
    (value.text === "" ||
      matchesText(bar, value.text) ||
      matchesText(row, value.text))
  );
}

/**
 * The rows and bars a filter leaves on screen, by the tree's own rule: a
 * matching row, its ancestors and its direct children. On a shown row the
 * bars that pass stay lit and the rest dim; when none pass (the row is shown
 * for its name or its parent), every bar stays lit.
 */
export function visibleUnderFilter(
  events: GanttEvent[],
  value: GanttFilterValue
): GanttVisibility {
  const active = value.text !== "" || value.wipOnly;
  const rows = new Set<string>();
  if (!active) {
    for (const event of events) rows.add(event.id);
  } else {
    const byId = new Map(events.map((event) => [event.id, event]));
    const childrenOf = new Map<string, string[]>();
    for (const event of events) {
      if (!event.parentId) continue;
      const siblings = childrenOf.get(event.parentId) ?? [];
      siblings.push(event.id);
      childrenOf.set(event.parentId, siblings);
    }
    for (const event of events) {
      if (!rowMatchesFilter(value, event)) continue;
      for (let row: GanttEvent | undefined = event; row; ) {
        rows.add(row.id);
        row = row.parentId ? byId.get(row.parentId) : undefined;
      }
      for (const child of childrenOf.get(event.id) ?? []) rows.add(child);
    }
  }

  const bars = new Set<string>();
  for (const event of events) {
    const items = event.data.items;
    if (!items || !rows.has(event.id)) continue;
    const passing = active
      ? items.filter((item) => barPasses(value, item, event))
      : items;
    for (const item of passing.length > 0 ? passing : items) bars.add(item.id);
  }
  return { active, rows, bars };
}
