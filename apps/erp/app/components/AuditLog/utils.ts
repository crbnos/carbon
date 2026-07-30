/**
 * Whether a diff side holds no real value (null/undefined, empty string,
 * empty object/array). Rendered as a muted "Empty" pill instead of the
 * literal "null" — first-time sets read as "Empty → Net 15", not
 * "null → Net 15". Scalars like 0 and false are real values.
 */
export function isEmptyDiffValue(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}
