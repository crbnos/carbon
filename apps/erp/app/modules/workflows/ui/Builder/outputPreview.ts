import type { ValueType } from "@carbon/workflows";

/** What the output-handle popover says about one output, beyond its type name.
 *
 * Kept apart from `OutputHandle.tsx` so it can be tested without the Lingui macro
 * transform — importing the component pulls in the glossary, whose `msg` calls
 * only exist after a Vite build. */

/** How many of an object's fields to name before trailing off. */
export const MAX_FIELDS = 4;

/**
 * The fields inside an output, when it holds an object.
 *
 * `describeVariable` can only say "a list of objects" — true, and useless: the
 * author is looking at this popover precisely to learn what is IN the object, and
 * a record carries its fields on the type itself.
 */
export function fieldsOf(type: ValueType): string[] {
  const shape =
    type.kind === "record"
      ? type
      : type.kind === "list" && type.of.kind === "record"
        ? type.of
        : undefined;
  return shape === undefined ? [] : Object.keys(shape.fields);
}

/**
 * What a person is most likely to want, lowest first.
 *
 * A structured value is what the step went and fetched; a plain field is usually
 * envelope detail. `availableVariables` breaks ties alphabetically — a fine default
 * across nodes, but on an integration step it buries `items` under `accessRole`,
 * and the row cap would then drop the payload rather than the noise.
 */
export function weightOf(type: ValueType): number {
  if (type.kind === "list") return type.of.kind === "record" ? 0 : 1;
  if (type.kind === "record") return 2;
  if (type.kind === "entity") return 3;
  return 4;
}

/**
 * The popover's sections: one per upstream node, in the order the picker gave
 * them, with each node's own values ranked inside it.
 *
 * Grouping must happen BEFORE ranking. Ranking the flat list and then merging only
 * ADJACENT rows split a single node into two sections with another node's values
 * wedged between — the same node heading appeared twice.
 */
export function groupOutputs<T extends { nodeName: string; type: ValueType }>(
  variables: readonly T[]
): { nodeName: string; rows: T[] }[] {
  const groups: { nodeName: string; rows: T[] }[] = [];
  for (const variable of variables) {
    const existing = groups.find((g) => g.nodeName === variable.nodeName);
    if (existing) existing.rows.push(variable);
    else groups.push({ nodeName: variable.nodeName, rows: [variable] });
  }
  for (const group of groups) {
    group.rows.sort((a, b) => weightOf(a.type) - weightOf(b.type));
  }
  return groups;
}
