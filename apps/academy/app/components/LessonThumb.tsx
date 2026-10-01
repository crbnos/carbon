// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn } from "@carbon/react";
import { LuCircleCheck, LuCirclePlay } from "react-icons/lu";

/** A small 16:9 video slot for lesson lists — a play icon on a warm tile, with a
 *  check badge when completed. (Loom CDN thumbnails don't reliably load, so we
 *  show the icon rather than a broken image.) */
export function LessonThumb({
  completed,
  className
}: {
  completed?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "relative flex aspect-video shrink-0 items-center justify-center overflow-hidden rounded-md border border-ed-hairline bg-ed-warm-150",
        className
      )}
    >
      <LuCirclePlay className="size-4 text-ed-ink-45" />
      {completed && (
        <span className="absolute right-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-white/90 shadow-sm">
          <LuCircleCheck className="size-3.5 text-ed-green-strong" />
        </span>
      )}
    </span>
  );
}
