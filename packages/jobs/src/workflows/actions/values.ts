import type { RuntimeValue } from "@carbon/workflows";

/** A RuntimeValue as the plain value a column or a service function expects.
 * Shared so the create and update executors convert identically. */
export function toPlainValue(value: RuntimeValue): unknown {
  if (value.kind === "entity") return value.id;
  if (value.kind === "list") return value.items.map(toPlainValue);
  if (value.kind === "pairs") {
    return Object.fromEntries(
      value.entries.map((e) => [e.name, toPlainValue(e.value)])
    );
  }
  if (value.kind === "record") {
    return Object.fromEntries(
      Object.entries(value.fields).map(([name, field]) => [
        name,
        toPlainValue(field)
      ])
    );
  }
  // A date primitive already carries its ISO string; see runtime `fromColumn`.
  return value.value;
}
