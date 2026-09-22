/** Turn arbitrary user text into a legal node name. Empty input yields "". */
export function slugifyNodeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * The next free `{type}_{n}` for this node type. `taken` is every name already in
 * use in the definition, of any type, so a generated name never collides.
 */
export function nextNodeName(type: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  let n = 0;
  while (used.has(`${type}_${n}`)) n += 1;
  return `${type}_${n}`;
}

/** Append/increment a numeric suffix until the name is free. Used for collision repair. */
export function uniqueNodeName(
  desired: string,
  taken: Iterable<string>
): string {
  const used = new Set(taken);
  if (!used.has(desired)) return desired;
  let n = 2;
  while (used.has(`${desired}_${n}`)) n += 1;
  return `${desired}_${n}`;
}
