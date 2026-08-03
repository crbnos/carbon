import type { ValueType } from "@carbon/workflows";

// Pure label helpers, kept out of `catalog.ts` so they can be imported without
// pulling in the Lingui macro (which the unit-test runner does not transform).

/** Key builders — no call site should format keys by hand. */
export const entityLabelKey = (entity: string) => `entity.${entity}`;
export const propertyLabelKey = (entity: string, column: string) =>
  `entity.${entity}.${column}`;
export const actionInputLabelKey = (action: string, input: string) =>
  `action.${action}.input.${input}`;
export const operationInputLabelKey = (operation: string, input: string) =>
  `operation.${operation}.input.${input}`;

/**
 * The sub-line under a variable in any menu: what it is, why it might not be
 * there, or why it cannot be picked. One place, so the two menus always agree.
 */
export function describeVariable(
  type: ValueType,
  guaranteed: boolean,
  incompatibleWith?: ValueType
): string {
  if (incompatibleWith) {
    return `This is ${describeValueType(type)}; this field takes ${describeValueType(incompatibleWith)}.`;
  }
  return guaranteed
    ? describeValueType(type)
    : `${describeValueType(type)} · may be empty on this path`;
}

/** Human-readable type description for the picker and chips. */
export function describeValueType(
  type: ValueType,
  entityLabel?: string
): string {
  if (type.kind === "entity") {
    return `one ${entityLabel ?? type.of}`;
  }
  if (type.kind === "list") {
    const inner =
      type.of.kind === "entity" ? (entityLabel ?? type.of.of) : type.of.of;
    return `a list of ${inner}`;
  }
  // primitive
  switch (type.of) {
    case "string":
      return "text";
    case "number":
      return "a number";
    case "boolean":
      return "yes or no";
    case "date":
      return "a date";
    default:
      return type.of;
  }
}
