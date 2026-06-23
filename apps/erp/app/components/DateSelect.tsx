import {
  cn,
  DateRangePicker,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  ToggleGroup,
  ToggleGroupItem
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { DateRange } from "@react-types/datepicker";
import { forwardRef, useMemo } from "react";
import { LuCalendar } from "react-icons/lu";

type DateSelectOption = {
  value: string;
  label: string;
};

interface DateSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options?: DateSelectOption[];
  showCustom?: boolean;
  dateRange?: DateRange | null;
  onDateRangeChange?: (dateRange: DateRange | null) => void;
  className?: string;
}

const DateSelect = forwardRef<HTMLDivElement, DateSelectProps>(
  (
    {
      value,
      onValueChange,
      options,
      showCustom = true,
      dateRange,
      onDateRangeChange,
      className
    },
    ref
  ) => {
    const { t } = useLingui();
    const resolvedOptions = useMemo(() => {
      if (options) return options;
      return [
        { value: "week", label: t`7D` },
        { value: "month", label: t`30D` },
        { value: "quarter", label: t`90D` },
        { value: "year", label: t`1Y` }
      ];
    }, [options, t]);

    const allOptions = useMemo(() => {
      if (!showCustom) return resolvedOptions;
      return [...resolvedOptions, { value: "custom", label: t`Custom` }];
    }, [resolvedOptions, showCustom, t]);

    return (
      <div
        ref={ref}
        className={cn("inline-flex items-center gap-2", className)}
      >
        {/* Compact dropdown for small screens */}
        <Select value={value} onValueChange={onValueChange}>
          <SelectTrigger className="md:hidden w-auto h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {allOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Segmented control for md+ screens */}
        <ToggleGroup
          type="single"
          value={value}
          onValueChange={(v) => {
            if (v) onValueChange(v);
          }}
          className="hidden md:inline-flex gap-0 rounded-full border border-border bg-muted p-0.5 shadow-sm"
        >
          {resolvedOptions.map((option) => (
            <ToggleGroupItem
              key={option.value}
              value={option.value}
              className={cn(
                "h-7 rounded-full px-3 text-xs font-medium",
                "bg-transparent text-muted-foreground",
                "hover:bg-active hover:text-active-foreground hover:data-[state=on]:bg-active",
                "data-[state=on]:bg-active data-[state=on]:text-active-foreground data-[state=on]:shadow-sm",
                "transition-all duration-200"
              )}
            >
              {option.label}
            </ToggleGroupItem>
          ))}
          {showCustom && (
            <ToggleGroupItem
              value="custom"
              className={cn(
                "h-7 w-7 rounded-full p-0",
                "bg-transparent text-muted-foreground",
                "hover:bg-active hover:text-active-foreground",
                "data-[state=on]:bg-active data-[state=on]:text-active-foreground data-[state=on]:shadow-sm",
                "transition-all duration-200"
              )}
            >
              <LuCalendar className="size-3.5" />
            </ToggleGroupItem>
          )}
        </ToggleGroup>

        {value === "custom" && onDateRangeChange && (
          <DateRangePicker
            value={dateRange}
            onChange={onDateRangeChange}
            size="sm"
          />
        )}
      </div>
    );
  }
);

DateSelect.displayName = "DateSelect";

export { DateSelect };
export type { DateSelectProps, DateSelectOption };
