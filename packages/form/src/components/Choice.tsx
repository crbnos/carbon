import type { TermId } from "@carbon/glossary";
import { cn, LabelWithHelp, RadioGroup, RadioGroupItem } from "@carbon/react";
import type { ReactNode } from "react";

/**
 * A single option in a {@link ChoiceCardGroup}.
 *
 * - `value`       — the underlying string value submitted/stored.
 * - `title`       — the bold label rendered in the card.
 * - `description` — optional secondary line for context.
 * - `icon`        — optional left-aligned glyph (e.g. a `react-icons` component).
 * - `disabled`    — greys the card out and blocks selection.
 */
export type ChoiceCardOption<V extends string = string> = {
  value: V;
  title: string;
  description?: string;
  icon?: ReactNode;
  disabled?: boolean;
};

type ChoiceCardGroupProps<V extends string = string> = {
  /** Optional small label rendered above the stack of cards. */
  label?: string;
  /** Glossary term id; renders a help-icon tooltip next to the label. */
  termId?: TermId;
  /** Currently selected value. */
  value: V;
  /** Called with the new value when the user picks a different card. */
  onChange: (value: V) => void;
  /** Choices to render. Rendered as a vertical stack. */
  options: ChoiceCardOption<V>[];
  /** Extra classes for the wrapping `<div>`. */
  className?: string;
};

/**
 * A reusable card-style radio group, generic over a string-enum value type.
 *
 * Mirrors shadcn/ui's choice card pattern: the radio indicator stays
 * visible on the right edge of each card, and the card's selected state
 * is driven by a CSS `:has([data-state=checked])` selector on the label.
 * No JavaScript-level "is this selected?" comparison is needed — Radix
 * flips `data-state="checked"` on the `RadioGroupItem` when selection
 * changes, and Tailwind's `has-[]` variant picks that up automatically.
 *
 * Cards are stacked vertically by design — each card is a full-width
 * row so the title and description have room to breathe. If you need a
 * grid, wrap the component in one at the call site.
 *
 * Generic over `V extends string` so callers can pass a tighter union
 * than `string` (e.g. `"all" | "item" | "category"`) and have `onChange`
 * infer the same type. Pure controlled component — callers own the state.
 */
export function ChoiceCardGroup<V extends string = string>({
  label,
  termId,
  value,
  onChange,
  options,
  className
}: ChoiceCardGroupProps<V>) {
  return (
    <div className={cn("space-y-2 w-full", className)}>
      {label && (
        <span className="text-xs font-medium text-muted-foreground">
          <LabelWithHelp termId={termId}>{label}</LabelWithHelp>
        </span>
      )}
      <RadioGroup
        value={value}
        onValueChange={(v) => onChange(v as V)}
        className="flex flex-col gap-2"
      >
        {options.map((opt) => {
          const inputId = `choice-${opt.value}`;
          return (
            <label
              key={opt.value}
              htmlFor={inputId}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-md border border-border bg-card p-3 transition-colors",
                "hover:bg-accent/40",
                "has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5",
                "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                opt.disabled && "cursor-not-allowed opacity-50"
              )}
            >
              {opt.icon && (
                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground mt-0.5">
                  {opt.icon}
                </span>
              )}
              <div className="flex flex-1 flex-col gap-0.5">
                <span className="text-sm font-medium">{opt.title}</span>
                {opt.description && (
                  <span className="text-xs text-muted-foreground leading-snug">
                    {opt.description}
                  </span>
                )}
              </div>
              <RadioGroupItem
                id={inputId}
                value={opt.value}
                disabled={opt.disabled}
                className="mt-1 flex-shrink-0"
              />
            </label>
          );
        })}
      </RadioGroup>
    </div>
  );
}
