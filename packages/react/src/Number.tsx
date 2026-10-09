// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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

// `relative` anchors the absolutely positioned NumberInputStepper to the input;
// without it the arrows attach to the nearest positioned ancestor (e.g. a modal).
const NumberInputGroup = ({ className, ...props }: ReactAria.GroupProps) => {
  return (
    <ReactAria.Group
      className={
        typeof className === "function"
          ? (values) => cn("relative", className(values))
          : cn("relative", className)
      }
      {...props}
    />
  );
};

const NumberInputStepper = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>) => {
  return (
    <div
      data-number-stepper
      className={cn(
        "absolute right-0 top-0 z-10 m-px flex h-[calc(100%-2px)] w-6 flex-col",
        // Phones: − and + side by side, each a 44pt target.
        "max-md:w-[88px] max-md:flex-row-reverse",
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
        className={cn(
          "pr-6 max-md:[&:has(~[data-number-stepper])]:pr-[92px]",
          className
        )}
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
          "flex flex-1 select-none items-center justify-center rounded-tr-md border-l border-border leading-none text-foreground transition-colors duration-100 max-md:rounded-none max-md:rounded-r-md max-md:hit-area",
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
          "flex flex-1 select-none items-center justify-center rounded-br-md border-l border-t border-border leading-none text-foreground transition-colors duration-100 max-md:rounded-none max-md:border-t-0 max-md:hit-area",
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
