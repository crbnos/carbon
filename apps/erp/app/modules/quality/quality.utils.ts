// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * The issue type a receipt inspection lot's NCR opens with: one for supplier or
 * receiving problems, else the first.
 */
export function receiptLotIssueType<Type extends { id: string; name: string }>(
  types: readonly Type[] | null | undefined
): Type | undefined {
  const list = types ?? [];
  return (
    list.find((type) =>
      /supplier|vendor|receiv|incoming|goods.in/i.test(type.name)
    ) ?? list[0]
  );
}
