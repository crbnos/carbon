import { Slot, Slottable } from "@radix-ui/react-slot";
import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";
import type { ButtonHTMLAttributes, ReactElement } from "react";
import { cloneElement, forwardRef } from "react";
import { Spinner } from "./Spinner";
import { cn } from "./utils/cn";

export const buttonVariants = cva(
  [
    "relative font-medium shrink-0 group inline-flex items-center justify-center select-none transform-gpu initial:border-none disabled:opacity-50",
    "focus:!outline-none focus:!ring-0 active:!outline-none active:!ring-0 whitespace-nowrap",
    "after:pointer-events-none after:absolute after:-inset-[3px] after:rounded-lg after:border after:border-blue-500 after:opacity-0 after:ring-2 after:ring-blue-500/20 after:transition-opacity focus-visible:after:opacity-100 active:after:opacity-0",
    "before:pointer-events-none before:bg-gradient-to-b before:transition-opacity before:from-white/[0.12] before:absolute before:inset-0 before:z-[1] before:rounded before:opacity-0",
  ],
  {
    variants: {
      variant: {
        primary:
          "bg-gradient-to-br from-primary/90 to-primary text-primary-foreground hover:bg-primary/90 saturate-[105%] shadow-[inset_0px_0.5px_0px_rgb(255_255_255_/_0.32)]",
        active:
          "bg-active text-active-foreground hover:bg-active/90 hover:text-active-foreground shadow-button-base",
        secondary:
          "bg-background hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50 shadow-button-base",
        solid:
          "bg-accent text-accent-foreground hover:bg-accent/90 shadow-button-base",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-[inset_0px_0.5px_0px_rgb(255_255_255_/_0.32)]",
        ghost:
          "bg-transparent hover:bg-primary/10 text-accent-foreground hover:text-accent-foreground/90",
        link: "text-foreground hover:text-foreground underline-offset-4 hover:underline px-0 py-0",
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
      {
        variant: "link",
        size: "sm",
        class: "px-0 py-0",
      },
      {
        variant: "link",
        size: "md",
        class: "px-0 py-0",
      },
      {
        variant: "link",
        size: "lg",
        class: "px-0 py-0",
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
              ? cn("mr-2 h-4 w-4 flex-shrink-0", leftIcon.props.className)
              : cn("mr-2 flex-shrink-0", leftIcon.props.className),
          })}
        <Slottable>{children}</Slottable>
        {rightIcon &&
          cloneElement(rightIcon, {
            className: !rightIcon.props?.size
              ? cn("ml-2 h-4 w-4 flex-shrink-0", rightIcon.props.className)
              : cn("ml-2 flex-shrink-0", rightIcon.props.className),
          })}
      </Comp>
    );
  }
);
Button.displayName = "Button";

export { Button };
