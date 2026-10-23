// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ColorPicker, useDebounce } from "@carbon/react";
import { useState } from "react";

/**
 * A grid cell's color: the shared `ColorPicker`, saved 500 ms after the
 * last change (dragging in the picker changes the value many times). The
 * parent keys it by the saved color, so a reload shows the stored value.
 */
export function ColorCell({
  value,
  isDisabled,
  onSave
}: {
  value: string;
  isDisabled: boolean;
  onSave: (color: string) => unknown;
}) {
  // The color being picked; the saved value until the first change.
  const [picked, setPicked] = useState<string | null>(null);
  const save = useDebounce((color: string) => onSave(color), 500, true);

  if (isDisabled) {
    return (
      <span className="flex items-center gap-2">
        <span
          aria-hidden
          className="size-4 rounded ring-1 ring-inset ring-black/10"
          style={{ backgroundColor: value }}
        />
        <span className="text-xs uppercase text-muted-foreground tabular-nums">
          {value}
        </span>
      </span>
    );
  }

  return (
    <div className="w-36" onClick={(event) => event.stopPropagation()}>
      <ColorPicker
        value={picked ?? value}
        onChange={(color) => {
          setPicked(color);
          if (color !== value) save(color);
        }}
      />
    </div>
  );
}

/** `base`, or `base 2`, `base 3`… — the first that no existing name takes. */
export function nextName(base: string, existing: string[]) {
  const taken = new Set(existing.map((name) => name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`.toLowerCase())) n++;
  return `${base} ${n}`;
}
