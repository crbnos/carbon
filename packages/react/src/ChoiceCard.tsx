import { type ReactNode, useEffect, useId, useRef } from "react";
import { RadioGroup, RadioGroupItem } from "./Radio";
import { cn } from "./utils/cn";

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
  /** Currently selected value. */
  value: V;
  /** Called with the new value when the user picks a different card. */
  onChange: (value: V) => void;
  /** Choices to render. */
  options: ChoiceCardOption<V>[];
  /**
   * Layout direction for the cards. `"column"` (default) stacks vertically;
   * `"row"` lays them out horizontally with equal-width columns.
   */
  direction?: "row" | "column";
  /**
   * Focus the selected card (falling back to the first) on mount, so a
   * choice screen is immediately arrow-key navigable without a Tab first.
   */
  autoFocus?: boolean;
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
  value,
  onChange,
  options,
  direction = "column",
  autoFocus = false,
  className
}: ChoiceCardGroupProps<V>) {
  const groupId = useId();
  const groupRef = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only focus
  useEffect(() => {
    if (!autoFocus) return;
    const radio =
      groupRef.current?.querySelector<HTMLElement>(
        '[role="radio"][data-state="checked"]'
      ) ?? groupRef.current?.querySelector<HTMLElement>('[role="radio"]');
    radio?.focus();
  }, []);

  return (
    <div className={cn("space-y-2 w-full", className)}>
      {label && (
        <span className="text-xs font-medium text-muted-foreground">
          {label}
        </span>
      )}
      <RadioGroup
        ref={groupRef}
        value={value}
        onValueChange={(v) => onChange(v as V)}
        className={cn(
          "gap-2",
          direction === "row" ? "grid grid-cols-2" : "flex flex-col"
        )}
      >
        {options.map((opt) => {
          const inputId = `${groupId}-${opt.value}`;
          return (
            <label
              key={opt.value}
              htmlFor={inputId}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-md border border-border bg-accent-40 p-3 transition-colors",
                "hover:bg-card",
                "has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-card",
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
