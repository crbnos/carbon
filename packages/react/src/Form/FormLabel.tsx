import type { ComponentPropsWithoutRef, ElementRef } from "react";
import { forwardRef } from "react";
import { useFormControlContext } from "./FormControl";

import { LuSquareFunction } from "react-icons/lu";
import { cn } from "../utils/cn";

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
      className="flex items-center justify-between"
      {...props}
    >
      <span
        className={cn("text-xs font-medium text-muted-foreground", className)}
      >
        {children}
      </span>
      {(isOptional || onConfigure) && (
        <div className="flex items-center gap-1">
          {isOptional && (
            <span className="text-muted-foreground text-xxs">Optional</span>
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
