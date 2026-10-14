// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ContractLine } from "./types";

/** A contract line as a column header or a row label: its description, else
 *  its service item's name. */
export function contractLineName(line: ContractLine) {
  return line.description || line.item?.name || line.itemId;
}

/** The editable cells' column key for the line at `index`. Line ids are not
 *  used: the Table treats a key with `_` as a nested path. */
export const lineColumnKey = (index: number) => `line${index}`;
