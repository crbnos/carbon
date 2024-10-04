import { Slot, Slottable } from "@radix-ui/react-slot";
import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";
import type { ButtonHTMLAttributes, ReactElement } from "react";
import { cloneElement, forwardRef } from "react";
import { Spinner } from "./Spinner";
import { cn } from "./utils/cn";

export const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md font-medium transition-colors ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm hover:shadow-[inset_0_1px_2px_0_theme(colors.white/15%)]",
        active:
          "bg-active text-active-foreground hover:bg-active/90 hover:text-active-foreground",
        secondary:
          "border border-input bg-card hover:bg-accent hover:text-accent-foreground",
        solid: "bg-accent text-accent-foreground hover:bg-accent/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm hover:shadow-[inset_0_1px_2px_0_theme(colors.white/10%)]",
        ghost:
          "bg-transparent hover:bg-primary/10 text-accent-foreground hover:text-accent-foreground/90",
        link: "text-foreground hover:text-foreground underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-6 rounded-sm text-xs",
        md: "h-8 rounded-md text-sm",
        lg: "h-11 rounded-lg text-base",
      },
      isDisabled: {
        true: "opacity-50 disabled:cursor-not-allowed",
      },
      isLoading: {
        true: "opacity-50 pointer-events-none",
      },
      isIcon: {
        true: "",
        false: "",
      },
      isRound: {
        true: "rounded-full",
        false: "rounded-md",
      },
    },
    compoundVariants: [
      {
        size: "sm",
        isIcon: true,
        class: "w-6 p-1",
      },
      {
        size: "md",
        isIcon: true,
        class: "w-8 p-2",
      },
      {
        size: "lg",
        isIcon: true,
        class: "w-11 p-2",
      },
      {
        size: "sm",
        isIcon: false,
        class: "px-2",
      },
      {
        size: "md",
        isIcon: false,
        class: "px-4",
      },
      {
        size: "lg",
        isIcon: false,
        class: "px-6",
      },
    ],
    defaultVariants: {
      variant: "primary",
      size: "md",
      isRound: false,
    },
  }
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  isDisabled?: boolean;
  isIcon?: boolean;
  isLoading?: boolean;
  leftIcon?: ReactElement;
  rightIcon?: ReactElement;
  isRound?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      asChild = false,
      className,
      variant,
      size,
      isDisabled,
      isIcon = false,
      isLoading,
      isRound = false,
      leftIcon,
      rightIcon,
      children,
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        {...props}
        className={cn(
          buttonVariants({
            variant,
            size,
            isDisabled,
            isIcon,
            isLoading,
            isRound,
            className,
          })
        )}
        type={asChild ? undefined : props.type ?? "button"}
        disabled={isDisabled || props.disabled}
        role={asChild ? undefined : "button"}
        ref={ref}
      >
        {isLoading && <Spinner className="mr-2" />}
        {!isLoading &&
          leftIcon &&
          cloneElement(leftIcon, {
            className: !leftIcon.props?.size
              ? cn("mr-2 h-4 w-4", leftIcon.props.className)
              : cn("mr-2", leftIcon.props.className),
          })}
        <Slottable>{children}</Slottable>
        {rightIcon &&
          cloneElement(rightIcon, {
            className: !rightIcon.props?.size
              ? cn("ml-2 h-4 w-4", rightIcon.props.className)
              : cn("ml-2", rightIcon.props.className),
          })}
      </Comp>
    );
  }
);
Button.displayName = "Button";

export { Button };
