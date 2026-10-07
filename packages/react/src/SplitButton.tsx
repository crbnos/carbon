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
    // Phones, in a record action's bar cell or sheet row: the main button
    // fills the space and the chevron keeps a 44pt cell. Its own Buttons
    // render plainly (the boundary) so only these classes apply.
    const presentation = useActionPresentation();
    const presented = presentation !== null;
    const mainVariant =
      presentation?.kind === "bar"
        ? presentation.emphasis
        : presentation?.kind === "row"
          ? "ghost"
          : variant;
    return (
      <ActionPresentationBoundary>
        <div className={cn("flex", presented && "w-full min-w-0")}>
          <Button
            ref={ref}
            onClick={
              presentation?.kind === "row"
                ? () => {
                    onClick?.();
                    setTimeout(presentation.onSelect, 0);
                  }
                : onClick
            }
            leftIcon={leftIcon}
            variant={mainVariant}
            size={presented ? "lg" : size}
            isLoading={isLoading}
            isDisabled={isDisabled}
            className={cn(
              `rounded-r-none before:rounded-r-none hover:scale-100 focus-visible:scale-100`,
              presented && "min-w-0 flex-1",
              presentation?.kind === "row" &&
                "h-12 justify-start rounded-sm px-3 text-[15px] font-normal text-foreground shadow-none",
              className
            )}
          >
            {children}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant={mainVariant}
                size={presented ? "lg" : size}
                isDisabled={isDisabled || isLoading}
                className={cn(
                  "rounded-l-none border-l px-1 before:rounded-l-none border-none shadow-none",
                  mainVariant === "primary" &&
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
        </div>
      </ActionPresentationBoundary>
    );
  }
);

SplitButton.displayName = "SplitButton";

export { SplitButton };
