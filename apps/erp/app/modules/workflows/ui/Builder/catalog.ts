import type { ValueType } from "@carbon/workflows";
import { createWorkflowCatalog } from "@carbon/workflows";
import { WORKFLOW_LABELS } from "@carbon/workflows/labels";
import { useLingui } from "@lingui/react";

/** One instance for the whole builder; the catalog is immutable committed data. */
export const catalog = createWorkflowCatalog();

/** Translates a catalog label key; falls back to the key's last segment when absent. */
export function useWorkflowLabel(): (key: string, fallback?: string) => string {
  const { i18n } = useLingui();
  return (key: string, fallback?: string) => {
    const descriptor = WORKFLOW_LABELS[key as keyof typeof WORKFLOW_LABELS];
    if (descriptor === undefined) {
      return fallback ?? key.split(".").pop() ?? key;
    }
    return i18n._(descriptor);
  };
}

/** Key builders — no call site should format keys by hand. */
export const entityLabelKey = (entity: string) => `entity.${entity}`;
export const propertyLabelKey = (entity: string, column: string) =>
  `entity.${entity}.${column}`;
export const actionInputLabelKey = (action: string, input: string) =>
  `action.${action}.input.${input}`;
export const operationInputLabelKey = (operation: string, input: string) =>
  `operation.${operation}.input.${input}`;

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
