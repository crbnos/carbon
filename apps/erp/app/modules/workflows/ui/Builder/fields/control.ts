import type { ValueOrRef, ValueType } from "@carbon/workflows";
import { hasRecordPicker } from "./recordPickers";

/** Which control a value field renders. */
export type ControlKind = "inline" | "chip" | "pick" | "literal";

/** A value there is no way to write down: a list, or a record with no searchable
 * picker behind it. The only honest source for one is an earlier step. */
function variableOnly(type: ValueType): boolean {
  if (type.kind === "list") return true;
  return type.kind === "entity" && !hasRecordPicker(type.of);
}

/**
 * One ordered decision instead of a branch per case. Order is the whole point:
 * `choices` has to disqualify the free-text rule, or every enum column loses its
 * dropdown to the inline editor.
 *
 * `literal` covers everything `LiteralControl` still dispatches internally
 * (choices, number, boolean, date, searchable record) — this only decides which of
 * the four shells wraps the value.
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
  if (variableOnly(type)) return "pick";
  return "literal";
}
