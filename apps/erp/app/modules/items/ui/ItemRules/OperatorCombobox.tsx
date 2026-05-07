import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandTrigger,
  cn,
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@carbon/react";
import type { Operator } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import {
  LuArrowDown,
  LuArrowUp,
  LuCheck,
  LuChevronDown,
  LuCircleSlash,
  LuEqual,
  LuList,
  LuListX,
  LuSquareDot,
  LuSquareSlash
} from "react-icons/lu";

export const OPERATOR_META: Record<
  Operator,
  { title: string; description: string; icon: JSX.Element; symbol: string }
> = {
  eq: {
    title: "equals",
    description: "Exact match",
    icon: <LuEqual className="h-3.5 w-3.5" />,
    symbol: "="
  },
  neq: {
    title: "not equals",
    description: "Anything but this value",
    icon: <LuCircleSlash className="h-3.5 w-3.5" />,
    symbol: "≠"
  },
  in: {
    title: "is one of",
    description: "Match any value in list",
    icon: <LuList className="h-3.5 w-3.5" />,
    symbol: "∈"
  },
  notIn: {
    title: "is none of",
    description: "Match no value in list",
    icon: <LuListX className="h-3.5 w-3.5" />,
    symbol: "∉"
  },
  isSet: {
    title: "is set",
    description: "Field has any value",
    icon: <LuSquareDot className="h-3.5 w-3.5" />,
    symbol: "∃"
  },
  isNotSet: {
    title: "is not set",
    description: "Field is empty",
    icon: <LuSquareSlash className="h-3.5 w-3.5" />,
    symbol: "∄"
  },
  gt: {
    title: "greater than",
    description: "Numeric >",
    icon: <LuArrowUp className="h-3.5 w-3.5" />,
    symbol: ">"
  },
  lt: {
    title: "less than",
    description: "Numeric <",
    icon: <LuArrowDown className="h-3.5 w-3.5" />,
    symbol: "<"
  }
};

type OperatorComboboxProps = {
  value: Operator;
  onChange: (op: Operator) => void;
  available: Operator[];
  disabled?: boolean;
  className?: string;
};

export default function OperatorCombobox({
  value,
  onChange,
  available,
  disabled,
  className
}: OperatorComboboxProps) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const meta = OPERATOR_META[value];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <CommandTrigger
          size="md"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          icon={<LuChevronDown className="h-4 w-4 shrink-0 opacity-50" />}
          className={cn("w-full", className)}
          onClick={() => !disabled && setOpen(true)}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2 text-left">
            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground font-mono text-xs">
              {meta.symbol}
            </div>
            <div className="truncate">{meta.title}</div>
          </div>
        </CommandTrigger>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        className="w-[var(--radix-popover-trigger-width)] min-w-[260px] p-0"
      >
        <Command>
          <CommandInput placeholder={t`Search operators...`} className="h-10" />
          <CommandList
            className="max-h-[280px] overflow-y-auto overscroll-contain"
            onWheel={(e) => e.stopPropagation()}
          >
            <CommandEmpty>{t`No operators.`}</CommandEmpty>
            <CommandGroup>
              {available.map((op) => {
                const m = OPERATOR_META[op];
                return (
                  <CommandItem
                    key={op}
                    value={`${m.title} ${m.description}`}
                    onSelect={() => {
                      onChange(op);
                      setOpen(false);
                    }}
                    className="flex items-center gap-3 px-2 py-2"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted font-mono text-sm text-muted-foreground">
                      {m.symbol}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">
                        {m.title}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {m.description}
                      </span>
                    </span>
                    <LuCheck
                      className={cn(
                        "h-4 w-4 shrink-0",
                        value === op ? "opacity-100" : "opacity-0"
                      )}
                    />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
