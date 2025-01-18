import * as ReactAria from "react-aria-components";
import { Input, type InputProps } from "./Input";

import { forwardRef } from "react";
import { cn } from "./utils/cn";

export type NumberFieldProps = ReactAria.NumberFieldProps;

const NumberField = ({ className, ...props }: ReactAria.NumberFieldProps) => {
  return (
    <ReactAria.NumberField className={cn("w-full", className)} {...props} />
  );
};

const NumberInputGroup = (props: ReactAria.GroupProps) => {
  return <ReactAria.Group {...props} />;
};

const NumberInputStepper = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>) => {
  return (
    <div
      className={cn(
        "absolute right-0 top-0 z-10 m-px flex h-[calc(100%-2px)] w-6 flex-col",
        className
      )}
      {...props}
    />
  );
};

const NumberInput = forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => {
    const handleFocus = (input: HTMLInputElement) => {
      input.select();
    };

    const internalRef = (input: HTMLInputElement | null) => {
      if (input && !input.hasAttribute("data-focus-listener")) {
        input.addEventListener("focus", () => handleFocus(input));
        input.setAttribute("data-focus-listener", "true");

        return () => {
          input.removeEventListener("focus", () => handleFocus(input));
          input.removeAttribute("data-focus-listener");
        };
      }
    };

    return (
      <Input
        ref={(input) => {
          if (typeof ref === "function") {
            ref(input);
          } else if (ref) {
            ref.current = input;
          }
          internalRef(input);
        }}
        className={cn("pr-6", className)}
        {...props}
      />
    );
  }
);

NumberInput.displayName = "NumberInput";

const NumberIncrementStepper = ({
  className,
  ...props
}: ReactAria.ButtonProps) => {
  return (
    <ReactAria.Button
      slot="increment"
      className={cn(
        [
          "flex flex-1 select-none items-center justify-center rounded-tr-md border-l border-border leading-none text-foreground transition-colors duration-100",
          // Pressed
          "pressed:bg-slate-100 dark:pressed:bg-slate-700",
          // Disabled
          "disabled:opacity-40 disabled:cursor-not-allowed",
        ],
        className
      )}
      {...props}
    />
  );
};

const NumberDecrementStepper = ({
  className,
  ...props
}: ReactAria.ButtonProps) => {
  return (
    <ReactAria.Button
      slot="decrement"
      className={cn(
        [
          "flex flex-1 select-none items-center justify-center rounded-br-md border-l border-t border-border leading-none text-foreground transition-colors duration-100",
          // Pressed
          "pressed:bg-slate-100 dark:pressed:bg-slate-700",
          // Disabled
          "disabled:opacity-40 disabled:cursor-not-allowed",
        ],
        className
      )}
      {...props}
    />
  );
};

export {
  NumberDecrementStepper,
  NumberField,
  NumberIncrementStepper,
  NumberInput,
  NumberInputGroup,
  NumberInputStepper,
};
