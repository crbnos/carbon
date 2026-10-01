// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Badge } from "@carbon/react";
import { Trans } from "@lingui/react/macro";

export function ItemWithRevision({
  item
}: {
  item?: {
    readableId?: string | null;
    revision?: string | null;
  } | null;
}) {
  if (!item) return null;
  const { readableId, revision } = item;
  if (!readableId) return null;
  return (
    <div className="flex items-center gap-1">
      <span>{readableId}</span>
      {revision && revision !== "0" && (
        <Badge variant="outline" className="font-mono">
          <Trans>Rev {revision}</Trans>
        </Badge>
      )}
    </div>
  );
}
