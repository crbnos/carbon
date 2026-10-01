// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ReactElement } from "react";
import { cloneElement, forwardRef, isValidElement } from "react";

import type { ButtonProps } from "./Button";
import { Button } from "./Button";
import { cn } from "./utils/cn";

export interface IconButtonProps
  extends Omit<ButtonProps, "leftIcon" | "rightIcon"> {
  /** Required for accessibility - describes the button action */
  "aria-label": string;
  /** The icon element to display */
  icon: ReactElement;
  /** Makes the button fully rounded */
  isRound?: boolean;
}

/**
 * Icon sizes matching button sizes for visual consistency
 * Slightly smaller than text button icons for better proportions
 */
const iconSizes = {
  sm: "size-3.5",
  md: "size-4",
  lg: "size-5"
} as const;

/**
 * IconButton - A button variant optimized for icon-only usage
 *
 * Accessibility:
 * - aria-label is required to provide context for screen readers
 * - Icon is marked as aria-hidden since the label provides the meaning
 *
 * Animation:
 * - Inherits all animation improvements from Button component
 * - Uses same easing (ease-out) and timing (150ms)
 */
const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      icon,
      "aria-label": ariaLabel,
      isRound = false,
      children,
      size = "md",
      ...props
    },
    ref
  ) => {
    // Support passing icon as prop or children
    const element = icon || children;

    const _children = isValidElement(element)
      ? cloneElement(element as any, {
          "aria-hidden": true,
          focusable: false,
          className: cn(
            iconSizes[size ?? "md"],
            (element as any).props?.className
          )
        })
      : null;

    return (
      <Button
        aria-label={ariaLabel}
        ref={ref}
        isIcon
        isRound={isRound}
        size={size}
        {...props}
      >
        {_children}
      </Button>
    );
  }
);
IconButton.displayName = "IconButton";

export { IconButton };
