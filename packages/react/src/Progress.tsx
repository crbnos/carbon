// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

"use client";

import { useLingui } from "@lingui/react/macro";
import * as ProgressPrimitive from "@radix-ui/react-progress";
import type { ComponentPropsWithoutRef, ElementRef } from "react";
import { forwardRef } from "react";

import { cn } from "./utils/cn";

type ProgressProps = ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> & {
  indicatorClassName?: string;
  numerator?: string;
  denominator?: string;
};

const Progress = forwardRef<
  ElementRef<typeof ProgressPrimitive.Root>,
  ProgressProps
>(
  (
    { className, indicatorClassName, numerator, denominator, value, ...props },
    ref
  ) => {
    const { t } = useLingui();
    const max = props.max ?? 100;
    const hasFraction = numerator !== undefined && denominator !== undefined;
    return (
      <ProgressPrimitive.Root
        ref={ref}
        className={cn(
          "relative h-4 w-full overflow-hidden rounded-full bg-muted min-w-[120px]",
          className
        )}
        // The value reaches the progressbar's aria-valuenow; Radix rejects one
        // outside 0..max, so clamp it.
        value={
          value === null || value === undefined
            ? value
            : Math.min(Math.max(value, 0), max)
        }
        getValueLabel={
          hasFraction ? () => t`${numerator} of ${denominator}` : undefined
        }
        {...props}
      >
        <ProgressPrimitive.Indicator
          className={cn(
            "h-full w-full flex-1 bg-emerald-500 transition-transform",
            indicatorClassName
          )}
          style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
        />
        {hasFraction && (
          <span
            aria-hidden
            className="absolute text-[0.5625rem] tabular-nums text-foreground right-2 top-1/2 transform -translate-y-1/2"
          >
            {numerator} of {denominator}
          </span>
        )}
      </ProgressPrimitive.Root>
    );
  }
);
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
