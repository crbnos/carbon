export function parseBoolean<T>(
  value: string | undefined,
  defaultValue: T
): boolean | T;
export function parseBoolean(value: string | undefined): boolean | undefined;
export function parseBoolean<T>(
  value: string | undefined,
  defaultValue?: T
): boolean | T | undefined {
  if (!value) return defaultValue;

  if (typeof value === "boolean") return value;

  // Fast-path the canonical lowercased forms before allocating
  // `trim().toLowerCase()` strings.
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;

  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return defaultValue; // or throw an error if invalid
}

/**
 * Returns the singular or plural form of a word based on count.
 * @param count - The number to check
 * @param singular - The singular form of the word
 * @param plural - The plural form (defaults to singular + "s")
 * @returns The appropriate form of the word
 */
export function pluralize(
  count: number,
  singular: string,
  plural?: string
): string {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}
