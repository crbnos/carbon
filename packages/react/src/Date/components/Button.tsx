import { useButton } from "@react-aria/button";
import type { AriaButtonProps } from "@react-types/button";
import { useRef } from "react";
import { Button } from "../../Button";
import type { IconButtonProps } from "../../IconButton";
import { IconButton } from "../../IconButton";

export const CalendarButton = (props: AriaButtonProps & IconButtonProps) => {
  const ref = useRef<HTMLButtonElement>(null);
  let { buttonProps } = useButton(props, ref);
  return (
    <IconButton
      {...buttonProps}
      ref={ref}
      variant="solid"
      className="rounded-full"
      {...props}
    />
  );
};

export interface FieldButtonProps extends AriaButtonProps {
  isPressed: boolean;
}

export const FieldButton = (props: FieldButtonProps) => {
  const ref = useRef<HTMLButtonElement>(null);
  const { buttonProps } = useButton(props, ref);
  return (
    <Button
      className="rounded-sm"
      {...buttonProps}
      ref={ref}
      isIcon
      variant="solid"
    >
      {props.children}
    </Button>
  );
};
