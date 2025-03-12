import { LuChevronDown } from "react-icons/lu";
import { forwardRef } from "react";
import { Button } from "./Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./Dropdown";
import { cn } from "./utils/cn";

interface SplitButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  leftIcon?: React.ReactElement;
  variant?: "primary" | "secondary" | "ghost" | "destructive";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  className?: string;
  dropdownItems: {
    label: string;
    onClick: () => void;
    icon?: React.ReactElement;
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
      disabled,
      className,
      dropdownItems,
    },
    ref
  ) => {
    return (
      <div className="flex">
        <Button
          ref={ref}
          onClick={onClick}
          leftIcon={leftIcon}
          variant={variant}
          size={size}
          disabled={disabled}
          className={`rounded-r-none before:rounded-r-none ${className || ""}`}
        >
          {children}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant={variant}
              size={size}
              disabled={disabled}
              className={cn(
                "rounded-l-none border-l px-1 before:rounded-l-none border-none shadow-none hover:shadow-button-base",
                variant === "primary" &&
                  "shadow-[inset_0px_0.5px_0px_rgb(255_255_255_/_0.32)]"
              )}
            >
              <LuChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {dropdownItems.map((item, index) => (
              <DropdownMenuItem key={index} onClick={item.onClick}>
                {item.icon && <DropdownMenuIcon icon={item.icon} />}
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }
);

SplitButton.displayName = "SplitButton";

export { SplitButton };
