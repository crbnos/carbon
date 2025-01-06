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
  size?: "sm" | "md" | "lg";
}

export const FieldButton = ({ size = "md", ...props }: FieldButtonProps) => {
  const ref = useRef<HTMLButtonElement>(null);
  const { buttonProps } = useButton(props, ref);

  const sizeClasses = {
    sm: "h-8 w-8 px-2",
    md: "h-10 w-10 px-3",
    lg: "h-12 w-12 px-4",
  };

  return (
    <IconButton
      {...buttonProps}
      ref={ref}
      aria-label="Toggle"
      className={`flex-shrink-0 ${sizeClasses[size]} rounded-l-none border-l-0 shadow-sm`}
      icon={<LuCalendar />}
      variant="secondary"
      size={size}
    />
  );
};
