// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { NumberFieldProps } from "@carbon/react";
import { cn, NumberField, NumberInput } from "@carbon/react";
import { useLocale } from "@react-aria/i18n";
import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import type { ReactNode } from "react";
import { useRef, useState } from "react";
import type { EditableTableCellComponentProps } from "~/components/Editable";

// The numbering systems the NumberField reads besides Latin digits (React
// Aria's NumberParser): Arabic-Indic, with its own decimal and group marks,
// and Chinese decimal digits.
const ARAB_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const HANIDEC_DIGITS = "〇一二三四五六七八九";
const ARAB_DECIMAL = "٫";
const ARAB_GROUP = "٬";

// The number in text being typed, read with the locale's own group and decimal
// marks (as the NumberField reads it on commit). Null until it is a number.
function parseLocaleNumber(text: string, locale: string): number | null {
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
  const group = parts.find((part) => part.type === "group")?.value ?? ",";
  const decimal = parts.find((part) => part.type === "decimal")?.value ?? ".";
  const latin = text
    .replace(/[\s\u00a0\u202f]/g, "")
    .replace(/[٠-٩]/g, (digit) => String(ARAB_DIGITS.indexOf(digit)))
    .replace(/[〇一二三四五六七八九]/g, (digit) =>
      String(HANIDEC_DIGITS.indexOf(digit))
    );
  const normalized =
    latin.includes(ARAB_DECIMAL) || latin.includes(ARAB_GROUP)
      ? latin.split(ARAB_GROUP).join("").replace(ARAB_DECIMAL, ".")
      : latin
          .split(group.trim() || group)
          .join("")
          .replace(decimal, ".");
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

const EditableNumber = <T extends object>(
  mutation: (
    accessorKey: string,
    newValue: string,
    row: T
  ) => Promise<PostgrestSingleResponse<unknown>>,
  numberFieldProps?: NumberFieldProps | ((row: T) => NumberFieldProps),
  options?: {
    clearable?: boolean;
    /** Classes for the editor's input — e.g. `text-right` for an amount
     *  column, so the value does not jump sides when the cell opens. */
    inputClassName?: string;
    /** Classes from the value being typed, before it is committed — e.g. a
     *  red fill while an inspection reading is out of tolerance. Starts from
     *  the saved value, so an open cell keeps the fill its display showed. */
    liveInputClassName?: (row: T, value: number | null) => string | undefined;
    /** Content drawn at the input's end from the value being typed — e.g. an
     *  inspection reading's ↑ / ↓ marker. */
    liveAdornment?: (row: T, value: number | null) => ReactNode;
  }
) => {
  const EditableNumberEditor = ({
    value,
    row,
    accessorKey,
    label,
    onError,
    onUpdate
  }: EditableTableCellComponentProps<T>) => {
    const resolvedProps =
      typeof numberFieldProps === "function"
        ? numberFieldProps(row)
        : numberFieldProps;

    const numericValue =
      value === null || value === undefined || value === ""
        ? undefined
        : Number(value);

    const { locale } = useLocale();
    const latestValue = useRef<number | undefined>(numericValue);
    // Escape cancels the edit. The table then moves focus back to the cell,
    // and the blur that follows must not commit what was typed.
    const cancelled = useRef(false);
    const [liveValue, setLiveValue] = useState<number | null>(
      numericValue ?? null
    );
    const tracksLiveValue = Boolean(
      options?.liveInputClassName || options?.liveAdornment
    );
    const adornment = options?.liveAdornment?.(row, liveValue);

    const clamp = (n: number) => {
      const { minValue, maxValue } = resolvedProps ?? {};
      let v = n;
      if (typeof maxValue === "number") v = Math.min(v, maxValue);
      if (typeof minValue === "number") v = Math.max(v, minValue);
      return v;
    };

    const commit = (raw: number | undefined) => {
      const isEmpty = raw === undefined || !Number.isFinite(raw);
      const next = isEmpty ? null : clamp(raw as number);
      if (next === (numericValue ?? null)) return;
      if (
        isEmpty &&
        (!options?.clearable || value === null || value === undefined)
      )
        return;

      onUpdate({ [accessorKey]: next });

      // @ts-expect-error
      mutation(accessorKey, isEmpty ? "" : next, row)
        .then(({ error }) => {
          if (error) {
            onError();
            onUpdate({ [accessorKey]: value });
          }
        })
        .catch(() => {
          onError();
          onUpdate({ [accessorKey]: value });
        });
    };

    return (
      <NumberField
        {...resolvedProps}
        aria-label={resolvedProps?.["aria-label"] ?? label}
        defaultValue={numericValue}
        onChange={(next) => {
          latestValue.current = Number.isNaN(next) ? undefined : next;
          resolvedProps?.onChange?.(next);
        }}
      >
        <div className="relative h-full w-full">
          <NumberInput
            size="sm"
            className={cn(
              "w-full rounded-none outline-none border-none shadow-none focus-visible:ring-0",
              options?.inputClassName,
              options?.liveInputClassName?.(row, liveValue)
            )}
            onInput={
              tracksLiveValue
                ? (e) =>
                    setLiveValue(
                      parseLocaleNumber(e.currentTarget.value, locale)
                    )
                : undefined
            }
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === "Escape") cancelled.current = true;
            }}
            onBlur={() => {
              if (!cancelled.current) commit(latestValue.current);
            }}
          />
          {adornment && (
            <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center">
              {adornment}
            </span>
          )}
        </div>
      </NumberField>
    );
  };

  return EditableNumberEditor;
};

export default EditableNumber;
