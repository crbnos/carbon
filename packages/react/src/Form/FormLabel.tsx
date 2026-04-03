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
  const showRequiredIndicator = field.isRequired && !isOptional;

  return (
    <label
      {...labelProps}
      ref={ref}
      className="flex items-center justify-between"
      // {...props}
    >
      <span
        className={cn("text-xs font-medium text-muted-foreground", className)}
      >
        {children}
        {showRequiredIndicator && (
          <span className="ml-0.5 text-destructive" aria-hidden>
            *
          </span>
        )}
      </span>
      {onConfigure && (
        <div className="flex items-center gap-1">
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
        </div>
      )}
    </label>
  );
});

FormLabel.displayName = "FormLabel";
