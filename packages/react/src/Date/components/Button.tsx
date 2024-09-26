import { useButton } from "@react-aria/button";
import type { AriaButtonProps } from "@react-types/button";
import { useRef } from "react";
import { LuCalendar } from "react-icons/lu";
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
  className?: string;
}

export const FieldButton = (props: FieldButtonProps) => {
  const ref = useRef<HTMLButtonElement>(null);
  const { buttonProps } = useButton(props, ref);
  return (
    <IconButton
      {...buttonProps}
      ref={ref}
      aria-label="Toggle"
      className="flex-shrink-0 h-10 w-10 px-3 rounded-l-none border-l-0 shadow-sm"
      icon={<LuCalendar />}
      variant="secondary"
      size="md"
    />
  );
};
