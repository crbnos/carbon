import { fnv1a64 } from "@carbon/utils";
import type { RuntimeValue } from "./types";
import { capItems } from "./values";

/** One turn of a batched action per item, capped like every other list. */
export function planBatch(list: RuntimeValue): {
  items: RuntimeValue[];
  dropped: number;
} {
  if (list.kind !== "list") return { items: [list], dropped: 0 };
  return capItems(list.items);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)
    );
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** The stable key a step row is claimed under. Never the position in the list. */
export function itemKeyFor(value: RuntimeValue): string {
  if (value.kind === "entity") return value.id;
  return `h:${fnv1a64(stableStringify(value))}`;
}
