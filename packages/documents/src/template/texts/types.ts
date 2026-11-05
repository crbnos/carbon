// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { DocumentBlockType, DocumentTemplateType } from "../schema";

/**
 * What a printed text is. `field` (a row, usually a label and its value) and
 * `column` (a table header) can be hidden; the others cannot. `value` prints a
 * record's value in a place of its own, such as a table cell or an amount; it
 * follows the text named by `of`. A table's main column (description, item,
 * operation) is a `text`: it holds the row's details and takes the width of the
 * hidden columns, so it can never be hidden.
 */
export type TextKind = "heading" | "field" | "column" | "text" | "value";

/**
 * Which part of a block a text belongs to, for the editor only: it tells
 * apart two texts with the same default, such as the supplier's "VAT:" and the
 * company's "VAT:". The editor shows it translated.
 */
export type TextSection =
  | "supplier"
  | "company"
  | "buyer"
  | "column"
  | "lineDetail"
  | "rental";

export interface TextEntry {
  key: string;
  kind: TextKind;
  /** The English text printed when the user changed nothing. */
  default: string;
  section?: TextSection;
  /** The key of the column or label this `value` belongs to. */
  of?: string;
  /**
   * Printed once per table row. Names the row's variables by their prefix:
   * `line` for `{line.quantity}`. A document with two tables has two prefixes.
   */
  row?: string;
}

/** One document's texts: per block type, plus `document` for texts outside any block. */
export type DocumentTextCatalog = Partial<
  Record<DocumentBlockType | "document", readonly TextEntry[]>
>;

export type TextCatalog = Record<DocumentTemplateType, DocumentTextCatalog>;

export const HIDEABLE_KINDS: readonly TextKind[] = ["field", "column"];
