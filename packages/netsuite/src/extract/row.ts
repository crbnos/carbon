/**
 * SuiteQL returns loosely-typed rows: column names come back LOWERCASED unless
 * quoted-aliased, numbers arrive as strings, and NetSuite's booleans are the
 * single characters `'T'` and `'F'`. These coercions are the one place that is
 * dealt with, so no mapper has to remember it.
 */

export type SuiteQLRow = Record<string, unknown>;

export function str(row: SuiteQLRow, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

export function requiredStr(
  row: SuiteQLRow,
  key: string,
  fallback: string
): string {
  return str(row, key) ?? fallback;
}

export function num(row: SuiteQLRow, key: string): number | null {
  const value = row[key];
  if (value === null || value === undefined || value === "") return null;
  const parsed =
    typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function numOr(row: SuiteQLRow, key: string, fallback: number): number {
  return num(row, key) ?? fallback;
}

/** NetSuite booleans are `'T'` / `'F'` text, not SQL booleans. */
export function bool(row: SuiteQLRow, key: string): boolean {
  const value = row[key];
  if (typeof value === "boolean") return value;
  const text = String(value ?? "")
    .trim()
    .toUpperCase();
  return text === "T" || text === "TRUE" || text === "Y" || text === "1";
}

/** A NetSuite date column, normalized to `YYYY-MM-DD` or null. */
export function date(row: SuiteQLRow, key: string): string | null {
  const value = str(row, key);
  if (!value) return null;

  // Already ISO.
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // NetSuite's default Analytics format is `DD/MM/YYYY` or `MM/DD/YYYY`
  // depending on the account's preference, and the API gives no way to tell
  // them apart from the value alone. A date that is ambiguous is left unset
  // rather than guessed — a promised date silently off by months is worse than
  // a blank one, and the mapper reports it.
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (slash) {
    const [, a, b, year] = slash;
    const first = Number(a);
    const second = Number(b);
    if (first > 12 && second <= 12) {
      return `${year}-${String(second).padStart(2, "0")}-${String(first).padStart(2, "0")}`;
    }
    if (second > 12 && first <= 12) {
      return `${year}-${String(first).padStart(2, "0")}-${String(second).padStart(2, "0")}`;
    }
    return null;
  }

  return null;
}
