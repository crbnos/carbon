// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useDebounce } from "@carbon/react";
import type { CalendarDate } from "@internationalized/date";
import { parseDate } from "@internationalized/date";
import { useEffect, useRef, useState } from "react";
import DateRangeFields, {
  type DateRangeValue
} from "~/components/DateRangeFields";
import { formatRangeFilter, parseRangeFilter } from "~/utils/query";
import { findFilterValue, useFilters } from "./useFilters";

function toCalendarDate(value: string | null): CalendarDate | null {
  if (!value) return null;
  try {
    return parseDate(value);
  } catch {
    return null;
  }
}

type DateRangeFilterProps = {
  accessorKey: string;
};

function toRange(value: string | null): DateRangeValue {
  const { from, to } = parseRangeFilter(value ?? "");
  return { from: toCalendarDate(from), to: toCalendarDate(to) };
}

/** `DateRangeFields` bound to the URL as `?filter=<key>:between:from,to`. */
const DateRangeFilter = ({ accessorKey }: DateRangeFilterProps) => {
  const { getFilterValue, removeKey, setFilter } = useFilters();
  const current = getFilterValue(accessorKey);

  // The URL values this draft builds on: the one it was seeded from, then
  // every value it has written since, oldest first. The URL landing on any
  // other value is a change made elsewhere (Back / Forward, the filter
  // removed), and that change wins over the draft.
  const knownRef = useRef<(string | null)[]>([current]);
  // A change made elsewhere re-seeds the fields with the URL's bounds, and an
  // update still waiting on the debounce is dropped: it carries the
  // generation it was typed in.
  const generationRef = useRef(0);
  const [seed, setSeed] = useState({ generation: 0, value: current });

  useEffect(() => {
    const index = knownRef.current.indexOf(current);
    if (index >= 0) {
      // One of our writes landed; older values are history now, so going
      // Back to one of them counts as a change made elsewhere
      knownRef.current = knownRef.current.slice(index);
      return;
    }
    knownRef.current = [current];
    generationRef.current += 1;
    setSeed({ generation: generationRef.current, value: current });
  }, [current]);

  const apply = (range: DateRangeValue | null, generation: number) => {
    // From after To: keep whatever the URL already says
    if (!range || generation !== generationRef.current) return;
    // The browser's URL, not this render's: on Back the popover can unmount
    // (and flush) after the URL changed but before this component re-rendered
    const live = findFilterValue(
      new URLSearchParams(window.location.search).getAll("filter"),
      accessorKey
    );
    if (!knownRef.current.includes(live)) return;

    const value = formatRangeFilter(
      range.from?.toString(),
      range.to?.toString()
    );
    // Already the latest value — closing the popover replays the last change
    if (value === knownRef.current[knownRef.current.length - 1]) return;
    knownRef.current.push(value);
    if (value) {
      setFilter(accessorKey, value, "between");
    } else {
      removeKey(accessorKey);
    }
  };

  // A typed date emits every intermediate keystroke, so wait for it to
  // settle. The ref keeps the delayed call (and the flush on close) on the
  // current URL rather than the one from the render that scheduled it.
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const debouncedApply = useDebounce(
    (next: DateRangeValue | null, generation: number) =>
      applyRef.current(next, generation),
    400,
    true
  );

  return (
    <DateRangeFields
      key={seed.generation}
      defaultValue={toRange(seed.value)}
      onChange={(range) => debouncedApply(range, seed.generation)}
    />
  );
};

export default DateRangeFilter;
