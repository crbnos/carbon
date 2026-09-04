import {
  CreatableMultiSelect,
  DatePicker,
  DateTimePicker,
  Input,
  NumberDecrementStepper,
  NumberField,
  NumberIncrementStepper,
  NumberInput,
  NumberInputGroup,
  NumberInputStepper,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch
} from "@carbon/react";
import type { ValueOrRef, ValueType } from "@carbon/workflows";
import {
  parseAbsolute,
  parseDate,
  toCalendarDateTime,
  toZoned
} from "@internationalized/date";
import { useLingui } from "@lingui/react/macro";
import type { KeyboardEvent, ReactNode } from "react";
import { LuChevronDown, LuChevronUp } from "react-icons/lu";
import { useCompanyTimeZone } from "~/hooks";
import { isWritableList } from "./control";
import { RECORD_PICKERS } from "./recordPickers";

/** Stored dates are the `YYYY-MM-DD` the picker itself writes. Anything else is a
 * value from elsewhere, and an empty picker beats a crash. */
function asCalendarDate(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  try {
    return parseDate(value.slice(0, 10));
  } catch {
    return null;
  }
}

/** Stored datetimes are the full ISO instant the picker itself writes. A value
 * saved before datetime inputs existed is a bare `YYYY-MM-DD`, which
 * `parseAbsolute` rejects — read it as midnight on the company's calendar, the
 * moment it already effectively meant. Anything else leaves the picker empty
 * rather than crashing the node form. */
function asCalendarDateTime(value: unknown, timeZone: string) {
  if (typeof value !== "string" || !value) return null;
  try {
    return toCalendarDateTime(parseAbsolute(value, timeZone));
  } catch {
    const date = asCalendarDate(value);
    return date ? toCalendarDateTime(date) : null;
  }
}

type LiteralControlProps = {
  type: ValueType;
  choices?: readonly string[];
  /** The input is a moment, not a calendar day: render a date AND time picker
   * and store a full ISO instant, resolved against the company's timezone. */
  precision?: "datetime";
  value: string | number | boolean | string[] | null | undefined;
  /** The catalog's default, shown when nothing is stored yet. A boolean control
   * especially must display what the run will actually send — an untouched
   * toggle rendered OFF while the effective default was ON lied twice over. */
  defaultValue?: unknown;
  onChange: (next: ValueOrRef | undefined) => void;
  /** Opens the variable menu. Every control here has two modes, and `{` is the one
   * way into the second. */
  onRequestVariable: () => void;
  /** The version is published: show the value, refuse every edit. */
  isReadOnly?: boolean;
};

export function LiteralControl({
  type,
  choices,
  precision,
  value,
  defaultValue,
  onChange,
  onRequestVariable,
  isReadOnly = false
}: LiteralControlProps) {
  const { t } = useLingui();
  const companyTimeZone = useCompanyTimeZone();

  function emit(raw: string | number | boolean | null | undefined) {
    if (raw === undefined || raw === "" || raw === null) {
      onChange(undefined);
    } else {
      onChange({ kind: "literal", type, value: raw });
    }
  }

  // A `{` opens the menu rather than landing in the buffer. On the shell rather than
  // each input, so a dropdown and a switch answer the key the same way a text box does.
  const braceOpens = (e: KeyboardEvent) => {
    if (isReadOnly) return;
    if (e.key === "{") {
      e.preventDefault();
      onRequestVariable();
    }
  };

  // `min-w-0` so the control can shrink inside a flex row instead of forcing its
  // content width onto the card.
  const shell = (children: ReactNode) => (
    <div className="min-w-0 flex-1" onKeyDown={braceOpens}>
      {children}
    </div>
  );

  // 1. Choices → Select
  if (choices && choices.length > 0) {
    const strValue = typeof value === "string" ? value : "";
    return shell(
      <Select
        value={strValue}
        onValueChange={(v) => emit(v || undefined)}
        disabled={isReadOnly}
      >
        <SelectTrigger disabled={isReadOnly}>
          <SelectValue className="truncate" placeholder={t`Select…`} />
        </SelectTrigger>
        <SelectContent>
          {choices.map((c) => (
            <SelectItem key={c} value={c}>
              {c}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  // 2. A list of plain text — recipients, attendees — typed one entry at a time,
  //    each becoming a chip. The vendor's field is an ARRAY, and the chips make
  //    "this goes to several people" visible where a text box would not; the
  //    stored value is a literal list. A list from an earlier step is still `{`.
  if (isWritableList(type)) {
    const entries = Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : [];
    const emitList = (next: readonly string[]) => {
      const cleaned = [
        ...new Set(next.map((entry) => entry.trim()).filter(Boolean))
      ];
      onChange(
        cleaned.length === 0
          ? undefined
          : { kind: "literal", type, value: cleaned }
      );
    };
    return shell(
      <CreatableMultiSelect
        size="md"
        value={entries}
        options={entries.map((entry) => ({ label: entry, value: entry }))}
        onChange={emitList}
        onCreateOption={(input) => emitList([...entries, input])}
        placeholder={t`Type a value and press Enter…`}
        isReadOnly={isReadOnly}
        className="w-full"
      />
    );
  }

  // 3. Primitive kinds
  if (type.kind === "primitive") {
    switch (type.of) {
      // Unreachable via pickControl; kept so LiteralControl stays total over ValueType.
      case "string": {
        const strValue = typeof value === "string" ? value : "";
        return shell(
          <Input
            size="md"
            type="text"
            className="truncate"
            value={strValue}
            onChange={(e) => emit(e.target.value)}
            placeholder={t`Enter text…`}
            isDisabled={isReadOnly}
          />
        );
      }

      case "number": {
        const numValue =
          typeof value === "number"
            ? value
            : typeof value === "string" && value !== ""
              ? Number(value)
              : undefined;
        return shell(
          <NumberField
            value={numValue}
            onChange={(n) =>
              emit(typeof n === "number" && !Number.isNaN(n) ? n : undefined)
            }
            aria-label={t`Number`}
            isDisabled={isReadOnly}
          >
            <NumberInputGroup className="relative">
              <NumberInput
                className="truncate"
                placeholder={t`Enter number…`}
              />
              <NumberInputStepper>
                <NumberIncrementStepper>
                  <LuChevronUp size="1em" strokeWidth="3" />
                </NumberIncrementStepper>
                <NumberDecrementStepper>
                  <LuChevronDown size="1em" strokeWidth="3" />
                </NumberDecrementStepper>
              </NumberInputStepper>
            </NumberInputGroup>
          </NumberField>
        );
      }

      case "boolean": {
        const boolValue =
          typeof value === "boolean"
            ? value
            : typeof defaultValue === "boolean"
              ? defaultValue
              : false;
        return shell(
          <Switch
            checked={boolValue}
            onCheckedChange={(checked) => emit(checked)}
            aria-label={t`Toggle`}
            disabled={isReadOnly}
          />
        );
      }

      case "date": {
        // A vendor's DATE_TIME. The picked wall clock is resolved against the
        // COMPANY's timezone, not the browser's — two admins in different
        // offices must not store different moments for the same typed time — and
        // stored as a full ISO instant, so the piece's own
        // `dayjs(value).format(...)` reproduces that moment whatever zone the
        // worker runs in.
        if (precision === "datetime") {
          return shell(
            <DateTimePicker
              // A workflow step's time is read by a machine in another system,
              // not by whoever happens to be looking at the canvas, so it is
              // shown as an unambiguous 24-hour clock. Carbon's own date-and-time
              // fields (timecards, maintenance) keep their locale's clock.
              hourCycle={24}
              value={asCalendarDateTime(value, companyTimeZone)}
              onChange={(date) =>
                emit(
                  date
                    ? toZoned(date, companyTimeZone).toAbsoluteString()
                    : undefined
                )
              }
              aria-label={t`Date and time`}
              isDisabled={isReadOnly}
            />
          );
        }
        return shell(
          <DatePicker
            value={asCalendarDate(value)}
            onChange={(date) => emit(date?.toString() ?? undefined)}
            aria-label={t`Date`}
            isDisabled={isReadOnly}
          />
        );
      }

      case "null":
        return null;
    }
  }

  // 4. Entity → the Carbon selector for that record
  if (type.kind === "entity") {
    const Picker = RECORD_PICKERS[type.of];
    if (Picker) {
      const strValue = typeof value === "string" ? value : undefined;
      return shell(
        <Picker
          value={strValue}
          onChange={(id) => emit(id ?? undefined)}
          isDisabled={isReadOnly}
        />
      );
    }
  }

  // A record with no picker, or a list: `pickControl` sends both to the variable
  // select before they reach here. Kept so this stays total over ValueType.
  return shell(
    <Input
      size="md"
      type="text"
      className="truncate"
      placeholder={t`Pick a value from an earlier step`}
      isDisabled
    />
  );
}
