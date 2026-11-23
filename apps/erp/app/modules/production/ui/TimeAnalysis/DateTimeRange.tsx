// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { DateTimePicker, HStack } from "@carbon/react";
import type { DateValue } from "@internationalized/date";
import {
  parseAbsolute,
  toCalendarDateTime,
  toZoned
} from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { useCompanyTimeZone } from "~/hooks/useCompanyTimeZone";

type Range = { from: string; to: string };

/**
 * Two instants picked on the company's clock. An edit is applied when focus
 * leaves a picker or its calendar closes, not on every keystroke, and never
 * while the range is inverted. Remount it (a `key`) when the applied range
 * changes, so it shows that range.
 */
export function DateTimeRange({
  from,
  to,
  onChange
}: Range & { onChange: (changed: Partial<Range>) => void }) {
  const { t } = useLingui();
  const timeZone = useCompanyTimeZone();
  // The range as it was when this mounted. An untouched end is never sent, so
  // a range that runs "up to now" stays that way.
  const [applied] = useState(() => ({
    from: toCalendarDateTime(parseAbsolute(from, timeZone)),
    to: toCalendarDateTime(parseAbsolute(to, timeZone))
  }));
  const [draft, setDraft] = useState(applied);
  const inverted = draft.from.compare(draft.to) > 0;

  const apply = () => {
    if (inverted) return;
    const changed: Partial<Range> = {};
    for (const name of ["from", "to"] as const) {
      if (draft[name].compare(applied[name]) !== 0) {
        changed[name] = toZoned(draft[name], timeZone).toAbsoluteString();
      }
    }
    if (changed.from || changed.to) onChange(changed);
  };
  const picker = (name: keyof Range) => ({
    size: "sm" as const,
    value: draft[name],
    isInvalid: inverted,
    onChange: (value: DateValue | null) =>
      value && setDraft({ ...draft, [name]: toCalendarDateTime(value) }),
    onBlur: apply,
    onOpenChange: (open: boolean) => !open && apply()
  });

  return (
    <HStack>
      <div className="w-60">
        <DateTimePicker {...picker("from")} aria-label={t`From`} />
      </div>
      <span className="text-sm text-muted-foreground">
        <Trans>to</Trans>
      </span>
      <div className="w-60">
        <DateTimePicker {...picker("to")} aria-label={t`To`} />
      </div>
    </HStack>
  );
}
