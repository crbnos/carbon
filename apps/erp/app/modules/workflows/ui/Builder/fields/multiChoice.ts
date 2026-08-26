import type { ValueOrRef, ValueType } from "@carbon/workflows";

// The value round-trip for a multi-select input, with no React and no macro, so the
// part that decides what gets STORED can be unit-tested.

/**
 * The choices a stored value holds. Anything that is not a literal list of the offered
 * strings reads as nothing picked: a variable-bound or hand-edited value must not have
 * its members half-rendered as ticks.
 */
export function readChoices(
  value: ValueOrRef | undefined,
  choices: readonly string[]
): string[] {
  if (value?.kind !== "literal") return [];
  if (!Array.isArray(value.value)) return [];
  return value.value.filter(
    (entry): entry is string =>
      typeof entry === "string" && choices.includes(entry)
  );
}

/**
 * What renders as ticked, and which options the author may not touch.
 *
 * `locked` is a choice the platform sends regardless (in-app): always ticked, never
 * togglable. An UNAVAILABLE choice — one the company has no plan or integration for — is
 * a different statement and must not be frozen the same way: it can never be added, but
 * one that is already stored has to stay removable, or a node seeded with a channel the
 * company cannot use is a dead end the author can see and not clear.
 */
export function choiceState(
  options: readonly { value: string; disabled?: boolean }[],
  value: ValueOrRef | undefined,
  locked: readonly string[] = []
): { shown: string[]; frozen: string[] } {
  const stored = readChoices(
    value,
    options.map((option) => option.value)
  );
  const shown = options
    .filter(
      (option) => locked.includes(option.value) || stored.includes(option.value)
    )
    .map((option) => option.value);
  const frozen = options
    .filter(
      (option) =>
        locked.includes(option.value) ||
        (option.disabled === true && !shown.includes(option.value))
    )
    .map((option) => option.value);
  return { shown, frozen };
}

/**
 * What to store for a set of picks. Ordered by the options rather than by the clicks —
 * `ChoiceSelect` already does this, but two authors ticking the same channels must
 * produce the same definition or autosave churns, and that is too load-bearing to
 * leave to a caller. An emptied set stores as absent, like `pairsRows.ts`.
 */
export function writeChoices(
  picked: readonly string[],
  choices: readonly string[],
  type: ValueType
): ValueOrRef | undefined {
  const ordered = choices.filter((choice) => picked.includes(choice));
  if (ordered.length === 0) return undefined;
  return { kind: "literal", type, value: ordered };
}
