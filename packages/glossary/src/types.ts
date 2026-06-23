/**
 * One glossary entry: a domain term, a one-sentence definition, and an optional
 * link to where it's explained in the docs.
 *
 * Definitions are deliberately short — one crisp, grounded sentence to identify
 * the term — the full story lives behind the "Learn more" link.
 */
export type GlossaryEntry = {
  /** Canonical name shown as the popover heading. */
  term: string;
  /** One crisp, grounded sentence. */
  definition: string;
  /** Optional internal route + section anchor for the "Learn more" link. */
  href?: string;
  /**
   * Alternate slugs that resolve to this entry. Used so the term→slug round-trip
   * test in `terms.test.ts` can skip alias keys without false negatives.
   */
  aliases?: readonly string[];
};
