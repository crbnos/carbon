// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Trans } from "@lingui/react/macro";
import type { ComponentPropsWithoutRef, ElementRef } from "react";
import { forwardRef } from "react";
import { LuSquareFunction } from "react-icons/lu";
import { cn } from "../utils/cn";
import { useFormControlContext } from "./FormControl";

export const FormLabel = forwardRef<
  ElementRef<"label">,
  ComponentPropsWithoutRef<"label"> & {
    isOptional?: boolean;
    isConfigured?: boolean;
    onConfigure?: () => void;
  }
>((props, ref) => {
  const {
    className,
    children,
    isConfigured = false,
    isOptional = false,
    onConfigure,
    ...rest
  } = props;

  const field = useFormControlContext();
  const labelProps = field?.getLabelProps(rest, ref) ?? { ref, ...rest };

  return (
    <label
      {...labelProps}
      ref={ref}
      className="flex items-center justify-between max-md:gap-2"
      // {...props}
    >
      <span
        className={cn("text-xs font-medium text-muted-foreground", className)}
      >
        {children}
      </span>
      {(isOptional || onConfigure) && (
        <div className="flex items-center gap-1 max-md:gap-2">
          {isOptional && (
            <span className="text-muted-foreground text-xxs max-md:text-xs">
              <Trans>Optional</Trans>
            </span>
          )}
          {onConfigure && (
            <LuSquareFunction
              aria-label="Configure"
              role="button"
              onClick={onConfigure}
              className={cn(
                "size-4",
                isConfigured
                  ? "text-emerald-500"
                  : "opacity-50 hover:opacity-100"
              )}
            />
          )}
        </div>
      )}
    </label>
  );
});

FormLabel.displayName = "FormLabel";
