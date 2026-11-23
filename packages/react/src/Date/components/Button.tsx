// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
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
  const { t } = useLingui();
  const ref = useRef<HTMLButtonElement>(null);
  const { buttonProps } = useButton(props, ref);

  const sizeClasses = {
    sm: "h-8 w-8 px-2 max-md:h-11 max-md:w-11",
    md: "h-10 w-10 px-3 max-md:h-11 max-md:w-11",
    lg: "h-12 w-12 px-4"
  };

  return (
    <IconButton
      {...buttonProps}
      ref={ref}
      // react-aria's aria-labelledby adds the field's name after this:
      // "Open calendar Due Date".
      aria-label={t`Open calendar`}
      className={`flex-shrink-0 ${sizeClasses[size]} rounded-l-none border border-l-0 before:rounded-l-none`}
      icon={<LuCalendar />}
      variant="secondary"
      size={size}
    />
  );
};
