// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Tooltip, TooltipContent, TooltipTrigger } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuZap } from "react-icons/lu";

/**
 * Small indicator on a model file row when the upload has been through the
 * optimise/compact pipeline (its `modelPath` was repointed at a compacted
 * `.zst` artifact). Reassures that this is internal-only: the customer's
 * original file is preserved and is exactly what a download serves.
 */
export function ModelOptimizedIndicator({
  modelPath
}: {
  modelPath: string | null;
}) {
  if (!modelPath?.toLowerCase().endsWith(".zst")) return null;
  return (
    <Tooltip>
      <TooltipTrigger>
        <LuZap className="size-3 text-emerald-500" />
      </TooltipTrigger>
      <TooltipContent>
        <Trans>
          Optimized for fast previews — downloads always serve the original
          uploaded file
        </Trans>
      </TooltipContent>
    </Tooltip>
  );
}
