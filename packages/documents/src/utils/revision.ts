// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * The one definition of the revision suffix: `PO000123-1`. Revision 0 stays
 * bare, and a missing id yields "" rather than a stray "-1".
 */
export function withRevisionSuffix(
  readableId?: string | null,
  revisionId?: number | null
) {
  if (!readableId) return "";
  return (revisionId ?? 0) > 0 ? `${readableId}-${revisionId}` : readableId;
}
