"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { LuCheck, LuChevronDown } from "react-icons/lu";
import { Checkbox } from "./Checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "./Select";
import { cn } from "./utils/cn";

/**
 * Hybrid of {@link ChoiceCardGroup} and {@link Select}: a compact dropdown
 * trigger paired with a rich popover where each option carries an icon,
 * title, and description — the same shape as a ChoiceCard, just rendered
 * inside a dropdown instead of inline cards.
 *
 * Two modes via the `multiple` prop:
 *
 *   - `multiple={false}` (default) — single-select. Renders a Radix Select.
 *     `value: V`, `onChange: (v: V) => void`.
 *   - `multiple={true}`  — multi-select. Renders a Popover + checkbox list
 *     with the same visual trigger. `value: V[]`, `onChange: (v: V[]) => void`.
 *
 * Closed state: trigger shows the icon + title of the selected option(s).
 * Open state: each option renders its icon + title + muted description.
 *
 * Pure controlled component — callers own the value via `value` / `onChange`.
 * Generic over `V extends string` so a tighter union flows through.
 */
export type ChoiceSelectOption<V extends string = string> = {
  value: V;
  /** Bold label rendered in the trigger and in the dropdown row. */
  title: string;
  /** Optional muted helper line shown only inside the dropdown. */
  description?: string;
  /** Optional left-aligned glyph. Shown in trigger and in the dropdown. */
  icon?: ReactNode;
  /** Greys the option out and blocks selection. */
  disabled?: boolean;
};

type CommonProps<V extends string> = {
  /** Choices to render. */
  options: ChoiceSelectOption<V>[];
  /** Optional placeholder when nothing is selected. */
  placeholder?: string;
  /** Disables the trigger entirely. */
  disabled?: boolean;
  /** Extra classes for the trigger button. */
  className?: string;
  /** Optional aria-label for the trigger. */
  "aria-label"?: string;
  /**
   * Popover alignment relative to the trigger. Defaults to `"start"` so the
   * dropdown's left edge lines up with the trigger's left edge.
   */
  align?: "start" | "center" | "end";
};

type SingleProps<V extends string> = CommonProps<V> & {
  multiple?: false;
  value: V;
  onChange: (value: V) => void;
};

type MultiProps<V extends string> = CommonProps<V> & {
  multiple: true;
  value: V[];
  onChange: (value: V[]) => void;
};

type ChoiceSelectProps<V extends string> = SingleProps<V> | MultiProps<V>;

export function ChoiceSelect<V extends string = string>(
  props: ChoiceSelectProps<V>
) {
  if (props.multiple) {
    return <ChoiceSelectMulti {...props} />;
  }
  return <ChoiceSelectSingle {...props} />;
}

function ChoiceSelectSingle<V extends string>({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  className,
  align = "start",
  "aria-label": ariaLabel
}: SingleProps<V>) {
  const selected = options.find((o) => o.value === value);

  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v as V)}
      disabled={disabled}
    >
      {/* The trigger renders a div (not a span) so SelectTrigger's
          `[&>span]:line-clamp-1` rule doesn't kick in and turn the inline
          icon+title row into a block. */}
      <SelectTrigger className={className} aria-label={ariaLabel}>
        {selected ? (
          <div className="flex items-center gap-2 min-w-0 flex-1 text-left">
            {selected.icon && (
              <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center text-muted-foreground">
                {selected.icon}
              </span>
            )}
            <span className="text-sm font-medium truncate">
              {selected.title}
            </span>
          </div>
        ) : (
          <SelectValue placeholder={placeholder} />
        )}
      </SelectTrigger>
      <SelectContent
        align={align}
        className="min-w-[var(--radix-select-trigger-width)] w-auto"
      >
        {options.map((opt) => (
          <SelectItem
            key={opt.value}
            value={opt.value}
            disabled={opt.disabled}
            className="py-2 pr-8"
          >
            <span className="flex items-start gap-3">
              {opt.icon && (
                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground mt-0.5">
                  {opt.icon}
                </span>
              )}
              <span className="flex flex-col gap-0.5 min-w-0">
                <span className="text-sm font-medium">{opt.title}</span>
                {opt.description && (
                  <span className="text-xs text-muted-foreground leading-snug">
                    {opt.description}
                  </span>
                )}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ChoiceSelectMulti<V extends string>({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  className,
  align = "start",
  "aria-label": ariaLabel
}: MultiProps<V>) {
  const [open, setOpen] = useState(false);
  const selectedSet = new Set(value);
  const selected = options.filter((o) => selectedSet.has(o.value));

  const toggle = (v: V) => {
    if (selectedSet.has(v)) {
      onChange(value.filter((x) => x !== v));
    } else {
      // Preserve canonical ordering from `options`.
      const next = options
        .filter((o) => selectedSet.has(o.value) || o.value === v)
        .map((o) => o.value);
      onChange(next);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn(
            "flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-sm",
            "ring-offset-background hover:bg-accent/40",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-50",
            selected.length === 0 && "text-muted-foreground",
            className
          )}
        >
          {selected.length > 0 ? (
            <div className="flex min-w-0 flex-1 items-center gap-2 text-left">
              {selected[0]!.icon && (
                <div className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
                  {selected[0]!.icon}
                </div>
              )}
              <div className="truncate text-sm font-medium">
                {selected.length === 1
                  ? selected[0]!.title
                  : `${selected[0]!.title} +${selected.length - 1}`}
              </div>
            </div>
          ) : (
            <span className="truncate">{placeholder}</span>
          )}
          <LuChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        className="min-w-[var(--radix-popover-trigger-width)] w-auto p-1"
      >
        <ul className="flex flex-col">
          {options.map((opt) => {
            const isSelected = selectedSet.has(opt.value);
            return (
              <li key={opt.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={opt.disabled}
                  onClick={() => toggle(opt.value)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-md px-2 py-2 text-left",
                    "hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                    opt.disabled && "cursor-not-allowed opacity-50"
                  )}
                >
                  {opt.icon && (
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground mt-0.5">
                      {opt.icon}
                    </span>
                  )}
                  <span className="flex flex-1 flex-col gap-0.5 min-w-0">
                    <span className="text-sm font-medium">{opt.title}</span>
                    {opt.description && (
                      <span className="text-xs text-muted-foreground leading-snug">
                        {opt.description}
                      </span>
                    )}
                  </span>
                  <Checkbox
                    isChecked={isSelected}
                    disabled={opt.disabled}
                    className="mt-1 shrink-0 pointer-events-none"
                    tabIndex={-1}
                  />
                  <LuCheck className="hidden" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
