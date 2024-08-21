import type { ComponentPropsWithoutRef, ElementRef } from "react";
import { forwardRef } from "react";
import { useFormControlContext } from "./FormControl";

import * as ReactAria from "react-aria-components";
import { cn } from "../utils/cn";

export const FormLabel = forwardRef<
  ElementRef<typeof ReactAria.Label>,
  ComponentPropsWithoutRef<typeof ReactAria.Label> & {
    isOptional?: boolean;
  }
>((props, ref) => {
  const { className, children, isOptional = false, ...rest } = props;

  const field = useFormControlContext();
  const labelProps = field?.getLabelProps(rest, ref) ?? { ref, ...rest };

  return (
    <ReactAria.Label
      {...labelProps}
      ref={ref}
      className="flex items-center justify-between"
      {...props}
    >
      <span className={cn("text-xs text-muted-foreground", className)}>
        {children}
      </span>
      {isOptional && (
        <span className="text-muted-foreground font-light text-xxs">
          Optional
        </span>
      )}
    </ReactAria.Label>
  );
});

FormLabel.displayName = "FormLabel";
