// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Checkbox } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { MouseEvent } from "react";
import { useRef } from "react";

type IndeterminateCheckboxProps = {
  checked: boolean;
  indeterminate: boolean;
  onChange: (checked: boolean, shiftKey: boolean) => void;
  /** What it selects, for its name: every row, or the row at this position. */
  selects?: "all" | number;
  /** The row's name ("PO-000123"), preferred over its position. */
  rowLabel?: string;
  [key: string]: any;
};

const IndeterminateCheckbox = ({
  indeterminate,
  checked,
  onChange,
  selects,
  rowLabel,
  ...rest
}: IndeterminateCheckboxProps) => {
  const { t } = useLingui();
  // onCheckedChange carries no DOM event, so capture the modifier on click.
  // Radix composes our onClick before firing onCheckedChange.
  const shiftKeyRef = useRef(false);

  const handleMouseDown = (event: MouseEvent<HTMLButtonElement>) => {
    // Prevent the browser from selecting text when shift-clicking a range.
    if (event.shiftKey) event.preventDefault();
  };

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    // Selecting a row must not also expand it (an expandable row toggles on
    // click).
    event.stopPropagation();
    shiftKeyRef.current = event.shiftKey;
  };

  const handleChange = (nextChecked: boolean) => {
    onChange(nextChecked, shiftKeyRef.current);
    shiftKeyRef.current = false;
  };

  return (
    <Checkbox
      isChecked={!!checked || !!indeterminate}
      isIndeterminate={indeterminate}
      className="ml-2 left-0 sticky z-[1]"
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      onCheckedChange={handleChange}
      // Checkbox renders no children, so the name goes on the control.
      aria-label={
        selects === "all"
          ? t`Select all rows`
          : rowLabel
            ? t`Select ${rowLabel}`
            : selects
              ? t`Select row ${selects}`
              : t`Select row`
      }
      {...rest}
    />
  );
};

IndeterminateCheckbox.displayName = "IndeterminateCheckbox";

export default IndeterminateCheckbox;
