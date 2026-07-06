import { Checkbox } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { MouseEvent } from "react";
import { useRef } from "react";

type IndeterminateCheckboxProps = {
  checked: boolean;
  indeterminate: boolean;
  onChange: (checked: boolean, shiftKey: boolean) => void;
  [key: string]: any;
};

const IndeterminateCheckbox = ({
  indeterminate,
  checked,
  onChange,
  ...rest
}: IndeterminateCheckboxProps) => {
  // onCheckedChange carries no DOM event, so capture the modifier on click.
  // Radix composes our onClick before firing onCheckedChange.
  const shiftKeyRef = useRef(false);

  const handleMouseDown = (event: MouseEvent<HTMLButtonElement>) => {
    // Prevent the browser from selecting text when shift-clicking a range.
    if (event.shiftKey) event.preventDefault();
  };

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
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
      {...rest}
    >
      <span className="sr-only">
        <Trans>Select Row</Trans>
      </span>
    </Checkbox>
  );
};

IndeterminateCheckbox.displayName = "IndeterminateCheckbox";

export default IndeterminateCheckbox;
