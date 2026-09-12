/**
 * The gap register.
 *
 * A "one click" migration that quietly leaves things behind is worse than one
 * that leaves the same things behind and says so: the customer discovers the
 * hole at month-end close instead of on day one. So every known limit is a row
 * here, the run report renders them, and the catalog is the single place a
 * reviewer can read what this feature does NOT do.
 *
 * A gap is a property of the MIGRATION, not of an account. Whether a given gap
 * MATTERS to a given customer is decided at extract time by `detect.ts`, which
 * attaches a count ("412 open invoices") — an account with no invoices does not
 * need to read about invoices.
 */

export type GapArea =
  | "accounting"
  | "customers"
  | "suppliers"
  | "items"
  | "manufacturing"
  | "inventory"
  | "sales"
  | "purchasing"
  | "platform";

export type GapSeverity =
  /** Data a manufacturer is likely to need on day one, with no Carbon path to it. */
  | "high"
  /** Missing data with a practical workaround, or that only some accounts hold. */
  | "medium"
  /** A modelling difference a user would notice but not be blocked by. */
  | "low";

export type GapStatus =
  /** Nothing comes across. */
  | "not-migrated"
  /** Some of it comes across; the entry says which part does not. */
  | "partial"
  /** Carbon models it differently; the entry says how. */
  | "transformed";

export type MigrationGapDefinition = {
  /** Stable id — referenced by docs, tests, and the run report. Never renumber. */
  id: string;
  area: GapArea;
  severity: GapSeverity;
  status: GapStatus;
  /** One line, in the customer's language. */
  title: string;
  /** What NetSuite holds, what Carbon does instead, and why. */
  detail: string;
  /** What the customer should do about it. Always present — a gap with no answer is a bug report. */
  workaround: string;
};

/** A gap as it applies to one account: the definition plus what it costs THIS customer. */
export type DetectedGap = MigrationGapDefinition & {
  /**
   * How many source records this gap leaves behind, when it is countable.
   * `null` means "applies, but there is nothing to count" (a modelling
   * difference); the entry is still shown.
   */
  count: number | null;
  /** Free-text specifics gathered at extract time, e.g. the record types seen. */
  examples: string[];
};
