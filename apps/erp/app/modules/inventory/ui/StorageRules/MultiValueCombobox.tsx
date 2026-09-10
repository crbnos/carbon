import {
  Badge,
  BadgeCloseButton,
  CommandTrigger,
  cn,
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useRef, useState } from "react";
import { LuCheck, LuChevronDown, LuSearch } from "react-icons/lu";
import type { ValueOption } from "./useValueOptions";

type MultiValueComboboxProps = {
  value: string[];
  onChange: (next: string[]) => void;
  options: ValueOption[];
  placeholder?: string;
  className?: string;
};

/**
 * Multi-select equivalent of `ValueCombobox`. Same plain-HTML render to avoid
 * cmdk's empty-state flash when async-loaded options arrive after mount.
 */
export default function MultiValueCombobox({
  value,
  onChange,
  options,
  placeholder,
  className
}: MultiValueComboboxProps) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setSearch("");
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  const selectedSet = useMemo(() => new Set(value), [value]);
  const selectedOptions = useMemo(
    () => options.filter((o) => selectedSet.has(o.value)),
    [options, selectedSet]
  );

  const filtered = useMemo(() => {
    if (!search) return options;
    const q = search.toLowerCase();
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)
    );
  }, [options, search]);

  const toggle = (v: string) => {
    if (selectedSet.has(v)) onChange(value.filter((x) => x !== v));
    else onChange([...value, v]);
  };

  const remove = (v: string) => onChange(value.filter((x) => x !== v));

  const hasSelections = selectedOptions.length > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <CommandTrigger
          size="md"
          role="combobox"
          aria-expanded={open}
          icon={<LuChevronDown className="h-4 w-4 shrink-0 opacity-50" />}
          className={cn(
            "w-full",
            !hasSelections && "text-muted-foreground",
            className
          )}
          onClick={() => setOpen(true)}
        >
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-left">
            {hasSelections ? (
              selectedOptions.map((opt) => (
                <Badge
                  key={opt.value}
                  variant="secondary"
                  className="border border-card"
                >
                  {opt.label}
                  <BadgeCloseButton
                    type="button"
                    tabIndex={-1}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      remove(opt.value);
                    }}
                  />
                </Badge>
              ))
            ) : (
              <div className="truncate">{placeholder ?? t`Select values`}</div>
            )}
          </div>
        </CommandTrigger>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        className="w-[var(--radix-popover-trigger-width)] min-w-[220px] p-0"
      >
        <div className="flex items-center gap-2 border-b border-border px-3 h-10">
          <LuSearch className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t`Search...`}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div
          className="max-h-[280px] overflow-y-auto overscroll-contain p-1 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent"
          onWheel={(e) => e.stopPropagation()}
        >
          {filtered.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {options.length === 0 ? t`No values available` : t`No matches`}
            </div>
          ) : (
            <ul className="flex flex-col">
              {filtered.map((opt) => {
                const isSelected = selectedSet.has(opt.value);
                return (
                  <li key={opt.value}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => toggle(opt.value)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                    >
                      <span className="flex min-w-0 flex-1 truncate">
                        {opt.label}
                      </span>
                      <LuCheck
                        className={cn(
                          "h-4 w-4 shrink-0",
                          isSelected ? "opacity-100" : "opacity-0"
                        )}
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
