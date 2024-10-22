import * as ReactAria from "react-aria-components";
import { Input, type InputProps } from "./Input";

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

const NumberInput = ({ className, ...props }: InputProps) => {
  return (
    <Input
      ref={(input) => {
        if (input) {
          const handleFocus = () => input.select();

          // Check if the event listener is already added
          if (!input.hasAttribute("data-focus-listener")) {
            input.addEventListener("focus", handleFocus);
            input.setAttribute("data-focus-listener", "true");

            // Remove the event listener when the component unmounts
            return () => {
              input.removeEventListener("focus", handleFocus);
              input.removeAttribute("data-focus-listener");
            };
          }
        }
      }}
      className={cn("pr-6", className)}
      {...props}
    />
  );
};

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
