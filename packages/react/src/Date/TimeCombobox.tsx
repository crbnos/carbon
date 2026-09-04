import { formatTimeOfDay, parseTypedTime } from "@carbon/utils";
import { Time } from "@internationalized/date";
import { useLocale } from "@react-aria/i18n";
import type { TimeValue } from "@react-types/datepicker";
import { useEffect, useMemo, useState } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInputTextField,
  CommandItem,
  CommandList
} from "../Command";
import { cn } from "../utils/cn";

/** How far apart the suggested times are. Quarter hours is what calendar apps
 * offer: half hours miss the :15 and :45 people actually book. */
const STEP_MINUTES = 15;

/** Only the wall-clock fields are read. `TimeValue` is a union — react-stately
 * hands back a `CalendarDateTime` once a date is also set, and a bare `Time`
 * only in the transient time-before-date state — so this deliberately accepts
 * the narrowest shape both share rather than pretending it is always a `Time`. */
function toTimeString(time: { hour: number; minute: number }) {
  return `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`;
}

function useTimeOptions(locale: string, hour24: boolean) {
  return useMemo(() => {
    const options: { value: string; label: string; time: Time }[] = [];
    // Counted as hour/minute rather than dividing a minute total: the numeric
    // standard bans raw rounding, and there is nothing to round here anyway.
    for (let hour = 0; hour < 24; hour++) {
      for (let minute = 0; minute < 60; minute += STEP_MINUTES) {
        const time = new Time(hour, minute);
        const value = toTimeString(time);
        options.push({
          value,
          label: formatTimeOfDay(value, locale, hour24),
          time
        });
      }
    }
    return options;
  }, [locale, hour24]);
}

type TimeComboboxProps = {
  value: TimeValue | null;
  onChange: (value: TimeValue) => void;
  isDisabled?: boolean;
  /** Show and accept a 24-hour clock ("15:30") instead of the locale's. */
  hour24?: boolean;
  "aria-label"?: string;
  className?: string;
};

/**
 * A time field a person can TYPE into, with a list of quarter hours to pick.
 *
 * Replaces the segmented spinner (`TimePicker`), where every digit had to be
 * tabbed through and there was nothing to choose from. Free text is held while
 * focused and interpreted when the person is done — on blur or Enter. Text that
 * is not a time reverts to the last good value rather than being clamped into a
 * plausible wrong one: a silently corrected time is a meeting at the wrong hour
 * that nobody notices.
 *
 * Built on `Command` (cmdk) rather than a hand-rolled list so arrow-key
 * navigation, `aria-activedescendant` and the option roles come from the same
 * place every other Carbon picker gets them.
 *
 * There is deliberately no way to clear from here: the caller's `onChange` is
 * react-stately's `setTimeValue`, and passing it `null` while a date is set
 * emits no change at all — the field would blank and then silently snap back.
 * Clearing belongs to whatever owns the whole date-time value.
 */
export const TimeCombobox = ({
  value,
  onChange,
  isDisabled = false,
  hour24 = false,
  "aria-label": ariaLabel,
  className
}: TimeComboboxProps) => {
  const { locale } = useLocale();
  const options = useTimeOptions(locale, hour24);

  const committed = value
    ? formatTimeOfDay(toTimeString(value), locale, hour24)
    : "";
  const [draft, setDraft] = useState(committed);
  const [isOpen, setOpen] = useState(false);
  const [isEditing, setEditing] = useState(false);

  // The single writer of `draft` outside of typing: a value set elsewhere (the
  // calendar, a reset) is adopted, but never yanked out from under someone
  // mid-edit. Every commit path below sets state and lets this do the display.
  useEffect(() => {
    if (!isEditing) setDraft(committed);
  }, [committed, isEditing]);

  /** Interpret what was typed. Anything unreadable — including empty — reverts. */
  const commit = () => {
    setEditing(false);
    setOpen(false);
    const parsed = parseTypedTime(draft);
    if (!parsed) {
      setDraft(committed);
      return;
    }
    onChange(parsed);
  };

  const choose = (time: Time) => {
    setEditing(false);
    setOpen(false);
    onChange(time);
  };

  // Narrows to what the text could still become: "15" shows the 15:00 quarters,
  // "15:3" shows 15:30. Labels may be zero-padded, so a single-digit hour is
  // matched unpadded too. A draft that parses also matches its own formatted
  // form, so "1530" finds 15:30 and "3pm" lands on 15:00 in either clock.
  const visible = useMemo(() => {
    const text = draft.trim().toLowerCase();
    if (!text || !isEditing) return options;
    const parsed = parseTypedTime(text);
    const parsedValue = parsed ? toTimeString(parsed) : null;
    return options.filter((option) => {
      const label = option.label.toLowerCase();
      return (
        label.startsWith(text) ||
        label.replace(/^0/, "").startsWith(text) ||
        option.value.startsWith(text) ||
        option.value === parsedValue
      );
    });
  }, [draft, isEditing, options]);

  const activeValue = value ? toTimeString(value) : null;

  return (
    <div className={cn("relative w-full", className)}>
      {/* cmdk owns filtering by default; ours is time-aware, so it is off. */}
      <Command shouldFilter={false} className="bg-transparent overflow-visible">
        <CommandInputTextField
          value={draft}
          onValueChange={(next) => {
            setEditing(true);
            setOpen(true);
            setDraft(next);
          }}
          // Opened by typing or ArrowDown, never by focus alone: this sits
          // inside the date picker's own popover, and opening on focus threw a
          // 96-row list over the calendar as soon as the field was tabbed into.
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
              return;
            }
            if (event.key === "Escape") {
              // Abandon the edit rather than commit it.
              event.preventDefault();
              setEditing(false);
              setDraft(committed);
              setOpen(false);
              return;
            }
            if (event.key === "Tab") {
              setOpen(false);
              return;
            }
            if (event.key === "ArrowDown" && !isOpen) setOpen(true);
          }}
          onFocus={() => setEditing(true)}
          onBlur={commit}
          isDisabled={isDisabled}
          autoComplete="off"
          placeholder={formatTimeOfDay("09:00", locale, hour24)}
          aria-label={ariaLabel}
          className="tabular-nums"
        />
        {isOpen && (
          <CommandList
            // Rendered in flow rather than a portal: the only consumer is the
            // date picker's popover, and a portalled list inside a Drawer hits
            // the scroll-lock problem in .claude/rules/conventions-ui.md.
            className="absolute w-full top-10 z-50 rounded-md border bg-popover text-popover-foreground shadow-md p-1 max-h-52"
          >
            <CommandEmpty>No matching time</CommandEmpty>
            <CommandGroup>
              {visible.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  className={cn(
                    "cursor-pointer tabular-nums",
                    option.value === activeValue && "font-medium"
                  )}
                  onSelect={() => choose(option.time)}
                  // The input's blur would otherwise fire first and commit the
                  // half-typed draft instead of this choice.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(option.time);
                  }}
                >
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        )}
      </Command>
    </div>
  );
};

export default TimeCombobox;
