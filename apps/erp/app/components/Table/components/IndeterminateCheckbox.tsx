import { Checkbox } from "@carbon/react";
import type { MouseEvent } from "react";

type IndeterminateCheckboxProps = {
  checked: boolean;
  indeterminate: boolean;
  onChange: (e: MouseEvent<HTMLInputElement>) => void;
  [key: string]: any;
};

const IndeterminateCheckbox = ({
  indeterminate,
  checked,
  onChange,
  ...rest
}: IndeterminateCheckboxProps) => {
  const handleChange = (checked: boolean) => {
    onChange({
      target: { checked },
    } as unknown as MouseEvent<HTMLInputElement>);
  };

  return (
    <Checkbox
      isChecked={!!checked || !!indeterminate}
      isIndeterminate={indeterminate}
      className="ml-2 left-0 sticky z-[1]"
      onCheckedChange={handleChange}
      {...rest}
    >
      <span className="sr-only">Select Row</span>
    </Checkbox>
  );
};

IndeterminateCheckbox.displayName = "IndeterminateCheckbox";

export default IndeterminateCheckbox;
