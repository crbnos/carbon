// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export function ComponentColorSwatch({
  color
}: {
  color: [number, number, number, number] | null;
}) {
  return (
    <span
      aria-hidden="true"
      className="h-3 w-3 shrink-0 rounded-sm border border-border bg-muted"
      style={
        color
          ? {
              backgroundColor: `rgba(${Math.round(color[0] * 255)}, ${Math.round(
                color[1] * 255
              )}, ${Math.round(color[2] * 255)}, ${color[3]})`
            }
          : undefined
      }
    />
  );
}
