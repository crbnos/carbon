// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import type * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { createContext, forwardRef, useContext, useRef, useState } from "react";
import { LuCheck } from "react-icons/lu";
import {
  BottomSheet,
  BottomSheetBody,
  BottomSheetContent,
  BottomSheetHeader,
  BottomSheetTitle,
  BottomSheetTrigger,
  SheetSectionLabel,
  sheetRowClassName
} from "./BottomSheet";
import { useIsomorphicLayoutEffect } from "./hooks/useIsomorphicLayoutEffect";
import type { PopperPositionProps } from "./PopupSheet";
import { cn } from "./utils/cn";

/*
 * Phones: a select shown as a real bottom sheet (a Radix Dialog) listing its
 * options, not Radix's select. Radix select items only work inside Radix's
 * select content, so the select's parts switch to these on compact.
 */

type SelectSheetState = {
  value: string | undefined;
  select: (value: string) => void;
  open: boolean;
  /** Each item's label by value, so the trigger can show the chosen one. */
  labelOf: (value: string) => ReactNode;
  register: (value: string, label: ReactNode) => void;
  disabled?: boolean;
};

const SelectSheetContext = createContext<SelectSheetState | null>(null);

function useSelectSheet() {
  const context = useContext(SelectSheetContext);
  if (!context) throw new Error("Select parts must be used within a Select");
  return context;
}

export function SelectSheetRoot({
  value: valueProp,
  defaultValue,
  onValueChange,
  open: openProp,
  defaultOpen,
  onOpenChange,
  name,
  disabled,
  required,
  children
}: {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  dir?: unknown;
  autoComplete?: unknown;
  form?: unknown;
  children?: ReactNode;
}) {
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(
    defaultOpen ?? false
  );
  const value = valueProp ?? uncontrolledValue;
  const open = openProp ?? uncontrolledOpen;
  const labels = useRef(new Map<string, ReactNode>());
  // Items register their labels after the trigger renders; re-render once
  // when the chosen value's label first arrives.
  const [, setVersion] = useState(0);

  const setOpen = (next: boolean) => {
    if (openProp === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  return (
    <SelectSheetContext.Provider
      value={{
        value,
        open,
        disabled,
        select: (next) => {
          if (valueProp === undefined) setUncontrolledValue(next);
          onValueChange?.(next);
          setOpen(false);
        },
        labelOf: (v) => labels.current.get(v),
        register: (v, label) => {
          const isNew = !labels.current.has(v);
          labels.current.set(v, label);
          if (isNew && v === value) setVersion((n) => n + 1);
        }
      }}
    >
      <BottomSheet open={open} onOpenChange={setOpen}>
        {children}
      </BottomSheet>
      {name ? (
        <input
          type="hidden"
          name={name}
          value={value ?? ""}
          required={required}
        />
      ) : null}
    </SelectSheetContext.Provider>
  );
}

/** Opens the sheet; the caller's Select trigger markup renders inside it. */
export const SelectSheetTrigger = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<"button"> & { asChild?: boolean }
>(({ disabled, asChild: _asChild, ...props }, ref) => {
  const { value, disabled: rootDisabled } = useSelectSheet();
  return (
    <BottomSheetTrigger asChild>
      <button
        ref={ref}
        type="button"
        disabled={disabled || rootDisabled}
        data-placeholder={value ? undefined : ""}
        {...props}
      />
    </BottomSheetTrigger>
  );
});
SelectSheetTrigger.displayName = "SelectSheetTrigger";

export function SelectSheetValue({
  placeholder,
  children,
  className
}: {
  placeholder?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const { value, labelOf } = useSelectSheet();
  const label = children ?? (value ? labelOf(value) : undefined);
  return (
    <span className={cn("pointer-events-none", className)}>
      {label ?? placeholder}
    </span>
  );
}

/** True while items only record their labels (the sheet is closed). */
const RegistryContext = createContext(false);

export const SelectSheetContent = forwardRef<
  HTMLDivElement,
  Omit<ComponentPropsWithoutRef<typeof DialogPrimitive.Content>, "title"> &
    PopperPositionProps & { position?: unknown }
>(
  (
    {
      className,
      children,
      position: _position,
      side: _side,
      sideOffset: _sideOffset,
      align: _align,
      alignOffset: _alignOffset,
      arrowPadding: _arrowPadding,
      avoidCollisions: _avoidCollisions,
      collisionBoundary: _collisionBoundary,
      collisionPadding: _collisionPadding,
      sticky: _sticky,
      hideWhenDetached: _hideWhenDetached,
      updatePositionStrategy: _updatePositionStrategy,
      ...props
    },
    ref
  ) => {
    const { t } = useLingui();
    const { open } = useSelectSheet();
    const label = props["aria-label"];
    return (
      <>
        {open ? null : (
          <RegistryContext.Provider value>{children}</RegistryContext.Provider>
        )}
        <BottomSheetContent ref={ref} {...props}>
          <BottomSheetHeader>
            <BottomSheetTitle className={label ? undefined : "sr-only"}>
              {label ?? t`Choose an option`}
            </BottomSheetTitle>
          </BottomSheetHeader>
          <BottomSheetBody>
            <div
              role="listbox"
              className={cn("flex flex-col", className, "w-full max-w-none")}
            >
              {children}
            </div>
          </BottomSheetBody>
        </BottomSheetContent>
      </>
    );
  }
);
SelectSheetContent.displayName = "SelectSheetContent";

export const SelectSheetItem = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<"button"> & {
    value: string;
    textValue?: string;
    helper?: string;
    helperRight?: string;
  }
>(
  (
    {
      value,
      textValue: _textValue,
      helper,
      helperRight,
      disabled,
      className,
      children,
      ...props
    },
    ref
  ) => {
    const sheet = useSelectSheet();
    const registryOnly = useContext(RegistryContext);
    // Before paint, so the trigger shows the label on its first frame.
    useIsomorphicLayoutEffect(() => {
      sheet.register(value, children);
    });
    if (registryOnly) return null;

    const checked = sheet.value === value;
    return (
      <button
        ref={ref}
        type="button"
        role="option"
        aria-selected={checked}
        disabled={disabled}
        className={cn(sheetRowClassName, className)}
        onClick={() => sheet.select(value)}
        {...props}
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{children}</span>
          {helper ? (
            <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="truncate">{helper}</span>
              {helperRight ? (
                <span className="shrink-0">{helperRight}</span>
              ) : null}
            </span>
          ) : null}
        </span>
        {checked ? <LuCheck className="size-5 shrink-0 text-primary" /> : null}
      </button>
    );
  }
);
SelectSheetItem.displayName = "SelectSheetItem";

export function SelectSheetGroup({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  const registryOnly = useContext(RegistryContext);
  return registryOnly ? (
    <>{props.children}</>
  ) : (
    <div role="group" className={className} {...props} />
  );
}

export const SelectSheetLabel = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<"div">
>(({ className, ...props }, ref) => {
  const registryOnly = useContext(RegistryContext);
  if (registryOnly) return null;
  return <SheetSectionLabel ref={ref} className={className} {...props} />;
});
SelectSheetLabel.displayName = "SelectSheetLabel";

export const SelectSheetSeparator = forwardRef<
  HTMLHRElement,
  ComponentPropsWithoutRef<"hr">
>(({ className, ...props }, ref) => {
  const registryOnly = useContext(RegistryContext);
  if (registryOnly) return null;
  return (
    <hr
      ref={ref}
      className={cn("my-2 h-px border-0 bg-border", className)}
      {...props}
    />
  );
});
SelectSheetSeparator.displayName = "SelectSheetSeparator";
