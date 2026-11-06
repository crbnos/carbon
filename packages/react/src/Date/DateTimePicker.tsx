// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { DateValue } from "@internationalized/date";
import { useLingui } from "@lingui/react/macro";
import { useDatePicker } from "@react-aria/datepicker";
import { useDatePickerState } from "@react-stately/datepicker";
import type { DatePickerProps } from "@react-types/datepicker";
import { cva } from "class-variance-authority";
import type { ReactNode } from "react";
import { useRef } from "react";
import { LuBan, LuInfo } from "react-icons/lu";
import { cn } from "..";
import { Button } from "../Button";
import { useClearLabel, useFormControl } from "../Form/useFormControl";
import { HStack } from "../HStack";
import { IconButton } from "../IconButton";
import { InlineTrigger } from "../InlineTrigger";
import { InputGroup } from "../Input";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverFooter,
  PopoverTrigger
} from "../Popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "../Tooltip";
import { FieldButton } from "./components/Button";
import { Calendar } from "./components/Calendar";
import DateField from "./components/DateField";
import { dateTimePickerOptions } from "./dateTimePickerOptions";
import { TimeCombobox } from "./TimeCombobox";

const dateTimePickerFieldVariants = cva("flex w-full px-4", {
  variants: {
    size: {
      sm: "py-1",
      md: "py-2",
      lg: "py-3"
    }
  },
  defaultVariants: {
    size: "md"
  }
});

const DateTimePicker = (
  props: DatePickerProps<DateValue> & {
    className?: string;
    size?: "sm" | "md" | "lg";
    withButton?: boolean;
    inline?: ReactNode;
    /** Inline mode: what the empty field reads, "Add due date". */
    inlinePlaceholder?: ReactNode;
    helperText?: string;
    /** The field's name for assistive tech; defaults to `label`. */
    "aria-label"?: string;
  }
) => {
  const { t } = useLingui();
  const timeOptions = dateTimePickerOptions(props.hourCycle);

  const state = useDatePickerState({
    ...props,
    ...timeOptions,
    shouldCloseOnSelect: false
  });
  const ref = useRef<HTMLDivElement>(null);
  // Opened from an anchor, not a Radix trigger: holds the calendar button so
  // focus can return to it on close.
  const anchorRef = useRef<HTMLDivElement>(null);
  // Set when the popover closes from a click or focus outside it: focus then
  // stays where the user put it, as Radix does for a trigger. A click on
  // nothing focusable (a sheet's overlay) still returns it to the button.
  const closedFromOutside = useRef(false);
  // The same options must reach `useDatePicker`, not just the state: it builds
  // `fieldProps`, so without them the visible field ignores what the state says.
  // The label is drawn by the form field, not here, so name the group with it
  // directly (as DatePicker does).
  const fieldName =
    props["aria-label"] ??
    (typeof props.label === "string" ? props.label : undefined);
  const clearLabel = useClearLabel(fieldName);
  // Inside a FormControl the field's error, helper text and glossary
  // definition describe it.
  const { ariaProps } = useFormControl(props);
  const { groupProps, fieldProps, buttonProps, dialogProps, calendarProps } =
    useDatePicker(
      {
        ...props,
        ...timeOptions,
        label: undefined,
        "aria-label": fieldName,
        "aria-describedby": ariaProps["aria-describedby"]
      },
      state,
      ref
    );

  return (
    <Popover open={state.isOpen} onOpenChange={state.setOpen}>
      <div className="relative inline-flex flex-col w-full">
        <HStack className="w-full" spacing={0}>
          {props.inline ? (
            <div className="flex w-full min-w-0 items-center gap-1">
              <PopoverTrigger asChild>
                <InlineTrigger
                  isEmpty={!state.value}
                  placeholder={props.inlinePlaceholder ?? t`Add`}
                  isDisabled={props.isDisabled}
                >
                  {props.inline}
                </InlineTrigger>
              </PopoverTrigger>
              {props.helperText && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <IconButton
                      icon={<LuInfo />}
                      variant="ghost"
                      size="sm"
                      aria-label="Helper information"
                    />
                  </TooltipTrigger>
                  <TooltipContent>{props.helperText}</TooltipContent>
                </Tooltip>
              )}
            </div>
          ) : (
            <>
              <InputGroup
                {...groupProps}
                ref={ref}
                className={cn("w-full inline-flex", props.className)}
                size={props.size}
              >
                <div
                  className={dateTimePickerFieldVariants({ size: props.size })}
                >
                  <DateField {...fieldProps} size={props.size} />
                  {state.isInvalid && (
                    <LuBan className="!text-destructive-foreground ml-auto shrink-0 self-center" />
                  )}
                </div>
                {/* Anchor (not Trigger) so the calendar button isn't wrapped
                    in a second <button>; react-aria's buttonProps open it. */}
                {props.withButton !== false && (
                  <PopoverAnchor asChild>
                    <div
                      ref={anchorRef}
                      className={cn(
                        "flex-shrink-0 -mr-px",
                        props.size === "sm" ? "mt-[-3px]" : "-mt-px"
                      )}
                    >
                      <FieldButton
                        {...buttonProps}
                        isPressed={state.isOpen}
                        size={props.size}
                      />
                    </div>
                  </PopoverAnchor>
                )}
              </InputGroup>
            </>
          )}
        </HStack>
        <PopoverContent
          align="end"
          {...dialogProps}
          onInteractOutside={() => {
            closedFromOutside.current = true;
          }}
          onCloseAutoFocus={
            props.inline
              ? undefined
              : (event) => {
                  const fromOutside = closedFromOutside.current;
                  closedFromOutside.current = false;
                  const focused = document.activeElement;
                  if (fromOutside && focused && focused !== document.body) {
                    return;
                  }
                  const button = anchorRef.current?.querySelector("button");
                  if (!button) return;
                  event.preventDefault();
                  button.focus();
                }
          }
        >
          <Calendar {...calendarProps} />
          <div className="pt-3">
            <TimeCombobox
              value={state.timeValue}
              onChange={state.setTimeValue}
              isDisabled={props.isDisabled}
              hour24={props.hourCycle === 24}
              aria-label={t`Time`}
            />
          </div>
          {props.inline && (
            <PopoverFooter>
              <Button
                onClick={() => state.setValue(null)}
                variant="secondary"
                aria-label={clearLabel}
              >
                Clear
              </Button>
            </PopoverFooter>
          )}
        </PopoverContent>
      </div>
    </Popover>
  );
};

export default DateTimePicker;
