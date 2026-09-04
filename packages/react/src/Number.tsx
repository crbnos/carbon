import type React from "react";
import { forwardRef, useRef } from "react";
import * as ReactAria from "react-aria-components";
import type { InputProps } from "./Input";
import { Input } from "./Input";
import { cn } from "./utils/cn";

export type NumberFieldProps = ReactAria.NumberFieldProps;

/** Shallow compare — exact here, since every option value is a primitive. */
export function areNumberFormatOptionsEqual(
  a: Intl.NumberFormatOptions | undefined,
  b: Intl.NumberFormatOptions | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;

  const aKeys = Object.keys(a) as (keyof Intl.NumberFormatOptions)[];
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;

  return aKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(b, key) && Object.is(a[key], b[key])
  );
}

/**
 * react-aria compares `formatOptions` by reference and, on a change, rewrites the
 * input text with the last committed value. An inline literal at the call site is a
 * new reference every render, so a parent re-render mid-typing discards what the
 * operator has typed — decimals never survive.
 */
function useStableFormatOptions(formatOptions?: Intl.NumberFormatOptions) {
  const ref = useRef(formatOptions);
  if (!areNumberFormatOptionsEqual(ref.current, formatOptions)) {
    ref.current = formatOptions;
  }
  return ref.current;
}

const NumberField = ({
  className,
  formatOptions,
  ...props
}: ReactAria.NumberFieldProps) => {
  const stableFormatOptions = useStableFormatOptions(formatOptions);
  return (
    <ReactAria.NumberField
      className={cn("w-full", className)}
      {...props}
      formatOptions={stableFormatOptions}
    />
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
  ({ className, isReadOnly, isDisabled, onFocus, ...props }, ref) => {
    return (
      <Input
        ref={ref}
        isReadOnly={isDisabled || isReadOnly}
        isDisabled={isDisabled}
        className={cn("pr-6", className)}
        onFocus={(e) => {
          (e.target as HTMLInputElement).select();
          onFocus?.(e);
        }}
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
          "disabled:opacity-40 disabled:cursor-not-allowed"
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
          "disabled:opacity-40 disabled:cursor-not-allowed"
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
  NumberInputStepper
};
