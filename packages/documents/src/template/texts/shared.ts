// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { TextEntry } from "./types";

/** The words around the page number in the footer of every full-page document. */
export const FOOTER_TEXTS = [
  { key: "page", kind: "text", default: "Page" },
  { key: "of", kind: "text", default: "of" }
] as const satisfies readonly TextEntry[];

export type AddressKey<K extends string> =
  | `${K}Name`
  | `${K}AddressLine1`
  | `${K}AddressLine2`
  | `${K}City`
  | `${K}StatePostal`
  | `${K}Country`;

/**
 * A party's address, one text per line. `key` names the texts, `token` the
 * variables they print (the invoice's `billTo*` texts print `{customer.*}`).
 */
export function addressTexts<K extends string>(
  key: K,
  token: string = key
): readonly { key: AddressKey<K>; kind: "field"; default: string }[] {
  const line = (suffix: string, field: string) => ({
    key: `${key}${suffix}` as AddressKey<K>,
    kind: "field" as const,
    default: `{${token}.${field}}`
  });
  return [
    line("Name", "name"),
    line("AddressLine1", "addressLine1"),
    line("AddressLine2", "addressLine2"),
    line("City", "city"),
    line("StatePostal", "statePostal"),
    line("Country", "country")
  ];
}

/**
 * A table cell: a value printed once per row, under the column or label `of`.
 * `row` names the row's variables by their prefix.
 */
export const cell = <K extends string>(
  key: K,
  text: string,
  of: string,
  row: string
) => ({ key, kind: "value" as const, default: text, of, row });

/** A value in a place of its own, printed with the label or column `of`. */
export const valueOf = <K extends string>(
  key: K,
  text: string,
  of: string
) => ({ key, kind: "value" as const, default: text, of });
