export type EntityRef = { table: string; id: string };

const MAX_DEPTH = 6;

function walk(value: unknown, out: EntityRef[], depth: number): void {
  if (depth > MAX_DEPTH || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const entry of value) walk(entry, out, depth + 1);
    return;
  }
  const obj = value as Record<string, unknown>;
  if (
    obj.kind === "entity" &&
    typeof obj.of === "string" &&
    typeof obj.id === "string"
  ) {
    out.push({ table: obj.of, id: obj.id });
  }
  for (const entry of Object.values(obj)) walk(entry, out, depth + 1);
}

/** Every record referenced anywhere in a run, so the loader can resolve their names
 * in one pass instead of the components fetching per value. */
export function collectEntityRefs(value: unknown): EntityRef[] {
  const out: EntityRef[] = [];
  walk(value, out, 0);
  const seen = new Set<string>();
  return out.filter((ref) => {
    const key = `${ref.table}:${ref.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
