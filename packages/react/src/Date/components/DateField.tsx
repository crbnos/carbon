import type { DateValue } from "@internationalized/date";
import { createCalendar } from "@internationalized/date";
import type { AriaDateFieldProps } from "@react-aria/datepicker";
import { useDateField } from "@react-aria/datepicker";
import { useLocale } from "@react-aria/i18n";
import { useDateFieldState } from "@react-stately/datepicker";
import { useRef } from "react";
import { DateSegment } from "./DateSegment";

interface DateFieldProps extends AriaDateFieldProps<DateValue> {
  size?: "sm" | "md" | "lg";
}

const DateField = ({ size, ...props }: DateFieldProps) => {
  const { locale } = useLocale();
  const state = useDateFieldState({
    ...props,
    locale,
    createCalendar,
  });

  const ref = useRef<HTMLDivElement>(null);
  const { fieldProps } = useDateField(props, state, ref);

  return (
    <div className="flex items-center" {...fieldProps} ref={ref}>
      {state.segments.map((segment, i) => (
        <DateSegment key={i} segment={segment} state={state} size={size} />
      ))}
    </div>
  );
};

export default DateField;
