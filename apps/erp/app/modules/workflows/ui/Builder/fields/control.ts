import type { ValueOrRef, ValueType } from "@carbon/workflows";

/** Which control a value field renders. */
export type ControlKind = "inline" | "chip" | "literal";

/**
 * One ordered decision instead of a branch per case. Order is the whole point:
 * `choices` has to disqualify the free-text rule, or every enum column loses its
 * dropdown to the inline editor.
 *
 * `literal` covers everything `LiteralControl` already dispatches internally
 * (choices, number, boolean, date, record, list) — this only decides which of the
 * three shells wraps the value.
 */
export function pickControl(
  type: ValueType,
  value: ValueOrRef | undefined,
  choices: readonly string[] | undefined
): ControlKind {
  const isFreeText =
    type.kind === "primitive" && type.of === "string" && !choices?.length;
  // Text wins over the chip: a lone variable in a text field renders as a token
  // inside the editor, so the user can still type around it.
  if (isFreeText) return "inline";
  if (value?.kind === "ref" || value?.kind === "item") return "chip";
  return "literal";
}
