// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { forwardRef } from "react";
import { LuChevronDown } from "react-icons/lu";
import {
  ActionPresentationBoundary,
  useActionPresentation
} from "./ActionPresentation";
import { Button } from "./Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "./Dropdown";
import { cn } from "./utils/cn";

interface SplitButtonProps {
  children: React.ReactNode;
  leftIcon?: React.ReactElement;
  variant?: "primary" | "secondary" | "ghost" | "destructive";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  className?: string;
  isLoading?: boolean;
  isDisabled?: boolean;
  onClick?: () => void;
  dropdownItems: {
    label: React.ReactNode;
    onClick: () => void;
    icon?: React.ReactElement;
    disabled?: boolean;
  }[];
}

const SplitButton = forwardRef<HTMLButtonElement, SplitButtonProps>(
  (
    {
      children,
      onClick,
      leftIcon,
      variant = "primary",
      size,
      isLoading,
      isDisabled,
      className,
      dropdownItems
    },
    ref
  ) => {
    // Phones, in a record action's bar cell or sheet row: the main Button
    // reads the presentation itself; the chevron keeps a 44pt cell.
    const presentation = useActionPresentation();
    const presented = presentation !== null;
    // A bar cell shows the main action only; the dropdown's items become
    // rows of the record's ⋯, so the 44pt bar has one target.
    const inBar = presentation?.kind === "bar";
    const chevronVariant = presentation?.kind === "row" ? "ghost" : variant;
    return (
      <div className={cn("flex", presented && "w-full min-w-0")}>
        <Button
          ref={ref}
          onClick={onClick}
          leftIcon={leftIcon}
          variant={variant}
          size={size}
          isLoading={isLoading}
          isDisabled={isDisabled}
          className={cn(
            !inBar &&
              `rounded-r-none before:rounded-r-none hover:scale-100 focus-visible:scale-100`,
            className
          )}
        >
          {children}
        </Button>
        {inBar ? (
          presentation.overflow?.(
            dropdownItems.map((item, index) => (
              <Button
                key={index}
                variant="secondary"
                leftIcon={item.icon}
                isDisabled={item.disabled}
                onClick={item.onClick}
              >
                {item.label}
              </Button>
            ))
          )
        ) : (
          <ActionPresentationBoundary>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant={chevronVariant}
                  size={presented ? "lg" : size}
                  isDisabled={isDisabled || isLoading}
                  className={cn(
                    "rounded-l-none border-l px-1 before:rounded-l-none border-none shadow-none",
                    chevronVariant === "primary" &&
                      "dark:shadow-[inset_0px_0.5px_0px_rgb(255_255_255_/_0.32)] dark:hover:shadow-button-primary hover:scale-100 focus-visible:scale-100",
                    presented && "w-11 shrink-0 justify-center px-0"
                  )}
                >
                  <LuChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {dropdownItems.map((item, index) => (
                  <DropdownMenuItem
                    key={index}
                    onClick={item.onClick}
                    disabled={item.disabled}
                  >
                    {item.icon && <DropdownMenuIcon icon={item.icon} />}
                    {item.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </ActionPresentationBoundary>
        )}
      </div>
    );
  }
);

SplitButton.displayName = "SplitButton";

export { SplitButton };
