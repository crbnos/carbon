import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";
import type { HTMLAttributes, InputHTMLAttributes } from "react";
import { cloneElement, createContext, forwardRef, useContext } from "react";
import * as ReactAria from "react-aria-components";

import { cn } from "./utils/cn";
import { getValidChildren } from "./utils/react";

const InputGroupContext = createContext<boolean>(false);

const inputGroupVariants = cva(
  "flex relative w-full bg-transparent text-foreground shadow-sm focus-within:outline-none border border-input",
  {
    variants: {
      size: {
        lg: "h-12 rounded-lg",
        md: "h-10 rounded-md",
        sm: "h-8 rounded",
        xs: "h-6 rounded",
      },
      isDisabled: {
        true: "opacity-50 disabled:cursor-not-allowed",
        false: "",
      },
      isInvalid: {
        true: "border-destructive focus-within:ring-destructive",
        false: "",
      },
      insetRing: {
        false:
          "ring-offset-background focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
        true: "focus-within:outline-none focus-within:box-shadow-[inset 0 0 0 2px var(--ring-color)]",
      },
    },
    defaultVariants: {
      size: "md",
      isDisabled: false,
      isInvalid: false,
      insetRing: false,
    },
  }
);

export interface InputGroupProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size">,
    VariantProps<typeof inputGroupVariants> {
  isDisabled?: boolean;
  isInvalid?: boolean;
}

const InputGroup = forwardRef<HTMLDivElement, InputGroupProps>(
  (
    {
      className,
      isInvalid = false,
      isDisabled = false,
      insetRing,
      size,
      children,
      ...props
    },
    ref
  ) => {
    const validChildren = getValidChildren(children);

    const _children = validChildren.map((child, index) =>
      cloneElement(child, {
        isFirstChild: index === 0,
        isLastChild: index === validChildren.length - 1,
        className: child.props.className,
        childtype: child.type,
        size,
        isInvalid,
        isDisabled,
        key: index,
      })
    );

    return (
      <InputGroupContext.Provider value={true}>
        <div
          className={cn(
            inputGroupVariants({
              size,
              isDisabled,
              isInvalid,
              insetRing,
              className,
            })
          )}
          {...props}
          ref={ref}
        >
          {_children}
        </div>
      </InputGroupContext.Provider>
    );
  }
);
InputGroup.displayName = "InputGroup";

export const inputVariants = cva(
  "flex w-full px-3 py-1 bg-transparent text-foreground transition-colors placeholder:text-muted-foreground disabled:opacity-50 rounded-md ",
  {
    variants: {
      size: {
        lg: "h-12 rounded-lg px-4 text-base",
        md: "h-10 rounded-md px-4 text-sm",
        sm: "h-8 rounded px-3 text-sm",
        xs: "h-6 rounded px-2 text-sm",
      },
      isInputGroup: {
        true: "h-auto outline-none focus-within:outline-none",
        false:
          "border border-input ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed shadow-sm file:border-0 file:bg-transparent file:text-sm file:font-medium",
      },
      isFirstChild: {
        true: "",
        false: "",
      },
      isLastChild: {
        true: "",
        false: "",
      },
      isInvalid: {
        true: "border-destructive ring-destructive focus-visible:ring-destructive",
        false: "",
      },
      isReadOnly: {
        true: "bg-muted text-muted-foreground",
        false: "",
      },
      isDisabled: {
        true: "bg-muted text-muted-foreground",
        false: "",
      },
    },
    compoundVariants: [
      {
        isFirstChild: false,
        isInputGroup: true,
        class: "rounded-l-none border-l-0",
      },
      {
        isLastChild: false,
        isInputGroup: true,
        class: "rounded-r-none border-r-0",
      },
      {
        isInvalid: true,
        isInputGroup: false,
        class: "focus-visible:ring-destructive",
      },
    ],
    defaultVariants: {
      size: "md",
      isInputGroup: false,
      isFirstChild: false,
      isLastChild: false,
      isInvalid: false,
    },
  }
);

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size">,
    VariantProps<typeof inputVariants> {
  isFirstChild?: boolean;
  isLastChild?: boolean;
  isInvalid?: boolean;
  isDisabled?: boolean;
  isReadOnly?: boolean;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      size,
      isFirstChild = true,
      isLastChild = true,
      isInvalid = false,
      isDisabled = false,
      isReadOnly = false,
      type,
      ...props
    },
    ref
  ) => {
    const isInputGroup = useContext(InputGroupContext) ?? false;

    return (
      <ReactAria.Input
        className={cn(
          inputVariants({
            size,
            isInputGroup,
            isFirstChild,
            isLastChild,
            isInvalid,
            isReadOnly,
            isDisabled,
          }),
          className
        )}
        {...props}
        disabled={isDisabled}
        readOnly={isReadOnly}
        ref={ref}
        type={type}
      />
    );
  }
);
Input.displayName = "Input";

const inputAddonVariants = cva(
  "flex items-center justify-center bg-muted text-muted-foreground border border-input",
  {
    variants: {
      placement: {
        left: "",
        right: "",
      },
      size: {
        lg: "h-12 px-3",
        md: "h-10 px-3",
        sm: "h-8 px-2",
        xs: "h-6 px-1",
      },
    },
    compoundVariants: [
      {
        placement: "left",
        size: "lg",
        class: "rounded-l-lg",
      },
      {
        placement: "left",
        size: "md",
        class: "rounded-l-md",
      },
      {
        placement: "left",
        size: "sm",
        class: "rounded-l",
      },
      {
        placement: "left",
        size: "xs",
        class: "rounded-l",
      },
      {
        placement: "right",
        size: "lg",
        class: "rounded-r-lg",
      },
      {
        placement: "right",
        size: "md",
        class: "rounded-r-md",
      },
      {
        placement: "right",
        size: "sm",
        class: "rounded-r",
      },
      {
        placement: "right",
        size: "xs",
        class: "rounded-r",
      },
    ],
    defaultVariants: {
      size: "md",
    },
  }
);

export interface InputAddonProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof inputAddonVariants> {}

const InputLeftAddon = forwardRef<HTMLDivElement, InputAddonProps>(
  ({ className, size, ...props }, ref) => {
    return (
      <div
        className={cn(
          inputAddonVariants({
            placement: "left",
            size,
            className,
          })
        )}
        {...props}
        ref={ref}
      />
    );
  }
);
InputLeftAddon.displayName = "InputLeftAddon";

const InputRightAddon = forwardRef<HTMLDivElement, InputAddonProps>(
  ({ className, size, ...props }, ref) => {
    return (
      <div
        className={cn(
          inputAddonVariants({
            placement: "right",
            size,
            className,
          })
        )}
        {...props}
        ref={ref}
      />
    );
  }
);
InputRightAddon.displayName = "InputRightAddon";

const inputElementVariants = cva(
  "flex w-auto h-full space-x-2 whitespace-nowrap items-center justify-center",
  {
    variants: {
      size: {
        lg: "h-12",
        md: "h-10",
        sm: "h-8",
        xs: "h-6",
      },
      placement: {
        left: "pl-2",
        right: "pr-2",
      },
    },
  }
);

export interface InputElementProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof inputElementVariants> {
  isFirstChild?: boolean;
  isLastChild?: boolean;
}

const InputLeftElement = forwardRef<HTMLDivElement, InputElementProps>(
  ({ className, size, isFirstChild, isLastChild, ...props }, ref) => {
    return (
      <div
        className={cn(
          inputElementVariants({
            size,
            placement: "left",
            className,
          })
        )}
        {...props}
        ref={ref}
      />
    );
  }
);
InputLeftElement.displayName = "InputLeftElement";

const InputRightElement = forwardRef<HTMLDivElement, InputElementProps>(
  ({ className, size, isFirstChild, isLastChild, ...props }, ref) => {
    return (
      <div
        className={cn(
          inputElementVariants({
            size,
            placement: "right",
            className,
          })
        )}
        {...props}
        ref={ref}
      />
    );
  }
);
InputRightElement.displayName = "InputRightElement";

export {
  Input,
  InputGroup,
  InputLeftAddon,
  InputLeftElement,
  InputRightAddon,
  InputRightElement,
};
