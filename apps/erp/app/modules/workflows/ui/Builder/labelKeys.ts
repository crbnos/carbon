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

/** Resolves a catalog label key to display text. */
export type LabelFor = (key: string, fallback: string) => string;

const FALLBACK_LABEL: LabelFor = (_key, fallback) => fallback;

/** A step's stored name is a slug (`purchase_order_created`); everywhere it is shown
 * to a customer it reads as a title. One place, so the card and the picker agree. */
export function nodeNameLabel(name: string): string {
  return name
    .split(/[_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** A change trigger hands out `record`, `before` and `after` — the same row as it is
 * now, as it was, and as it became. The raw names read as jargon, so name them. */
const OUTPUT_LABELS: Record<string, string> = {
  record: "Record",
  before: "Previous version",
  after: "Updated version"
};

/** Display text for a step's output. Unknown outputs keep their own name. */
export function outputLabel(output: string): string {
  return OUTPUT_LABELS[output] ?? output;
}

/**
 * The sub-line under a variable in any menu: what it is, and whether it might be
 * missing on this path. One place, so the two menus always agree.
 */
export function describeVariable(
  type: ValueType,
  guaranteed: boolean,
  labelFor: LabelFor = FALLBACK_LABEL
): string {
  const described = describeValueType(type, entityLabelOf(type, labelFor));
  return guaranteed ? described : `${described} · may be empty on this path`;
}

/** The catalog's name for whichever entity a type refers to, if any. */
function entityLabelOf(
  type: ValueType,
  labelFor: LabelFor
): string | undefined {
  const entity =
    type.kind === "entity"
      ? type.of
      : type.kind === "list" && type.of.kind === "entity"
        ? type.of.of
        : undefined;
  return entity === undefined
    ? undefined
    : labelFor(entityLabelKey(entity), entity);
}

/** Human-readable type description for the picker and chips. */
export function describeValueType(
  type: ValueType,
  entityLabel?: string
): string {
  if (type.kind === "entity") {
    // "record", not "object" — an ERP user thinks in records.
    return `${entityLabel ?? type.of} record`;
  }
  if (type.kind === "list") {
    return type.of.kind === "entity"
      ? `a list of ${entityLabel ?? type.of.of} records`
      : `a list of ${type.of.of}`;
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

/** Matches the auto-generated names `nextNodeName` hands out (`action_0`, `trigger_1`).
 * A name the user never changed carries no meaning, so callers fall back instead.
 * `entity` is the old spelling of `compute` and stays here forever: a node's name is an
 * identifier other nodes reference, so the rename left already-saved `entity_0` names
 * alone. Drop it and every one of them starts rendering as "Entity 0". */
const DEFAULT_NODE_NAME =
  /^(trigger|action|condition|compute|entity|lookup|filter)_\d+$/;

export function isDefaultNodeName(name: string): boolean {
  return DEFAULT_NODE_NAME.test(name);
}

/** What a step row is called: the name the user typed, or — when they never renamed
 * it — what the step actually does. Never "Action 0". */
export function nodeTitle(name: string | undefined, fallback: string): string {
  if (name === undefined || name === "" || isDefaultNodeName(name)) {
    return fallback;
  }
  return nodeNameLabel(name);
}
