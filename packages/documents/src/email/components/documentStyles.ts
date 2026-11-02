// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Inline styles for the document emails (purchase order, quote, sales
 * order, invoice). Inline because Outlook drops most of the stylesheet, and
 * explicit margins because react-email's <Text> is a paragraph with 16px
 * above and below: every address line read double-spaced.
 */

/** One line of a value: an address line, an ID, a date. */
export const detailText = {
  margin: 0,
  fontSize: "12px",
  lineHeight: "20px"
} as const;

/** The uppercase label above a value. */
export const labelText = {
  margin: "12px 0 2px",
  fontSize: "10px",
  lineHeight: "16px",
  letterSpacing: "0.04em"
} as const;

/** A line item's name, and the lines of detail under it. */
export const lineTitle = {
  margin: 0,
  fontSize: "12px",
  lineHeight: "20px",
  fontWeight: 600,
  // A long unbroken item ID would otherwise widen the description column.
  wordBreak: "break-word",
  overflowWrap: "anywhere"
} as const;
export const lineDetail = {
  margin: 0,
  fontSize: "12px",
  lineHeight: "18px"
} as const;
