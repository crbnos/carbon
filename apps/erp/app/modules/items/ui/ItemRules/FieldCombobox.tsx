import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandTrigger,
  cn,
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@carbon/react";
import { FIELD_REGISTRY, type FieldDef, getFieldDef } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import {
  LuBox,
  LuCheck,
  LuChevronDown,
  LuPackage,
  LuReceipt
} from "react-icons/lu";

const CONTEXT: Record<
  FieldDef["context"],
  { label: string; icon: JSX.Element }
> = {
  item: { label: "Item", icon: <LuPackage className="h-3.5 w-3.5" /> },
  storage: { label: "Storage", icon: <LuBox className="h-3.5 w-3.5" /> },
  transaction: {
    label: "Transaction",
    icon: <LuReceipt className="h-3.5 w-3.5" />
  }
};

const CONTEXT_ORDER: FieldDef["context"][] = ["item", "storage", "transaction"];

type FieldComboboxProps = {
  value: string;
  onChange: (path: string) => void;
  placeholder?: string;
  className?: string;
};

export default function FieldCombobox({
  value,
  onChange,
  placeholder,
  className
}: FieldComboboxProps) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);

  const grouped = useMemo(() => {
    const map = new Map<FieldDef["context"], FieldDef[]>();
    for (const ctx of CONTEXT_ORDER) map.set(ctx, []);
    for (const f of FIELD_REGISTRY) map.get(f.context)!.push(f);
    return map;
  }, []);

  const selected = useMemo(() => getFieldDef(value), [value]);
  const ctx = selected ? CONTEXT[selected.context] : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <CommandTrigger
          size="md"
          role="combobox"
          aria-expanded={open}
          icon={<LuChevronDown className="h-4 w-4 shrink-0 opacity-50" />}
          className={cn(
            "min-w-[180px] w-full",
            !selected && "text-muted-foreground",
            className
          )}
          onClick={() => setOpen(true)}
        >
          {selected && ctx ? (
            <div className="flex min-w-0 flex-1 items-center gap-2 text-left">
              <div
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground"
                title={ctx.label}
                role="img"
                aria-label={ctx.label}
              >
                {ctx.icon}
              </div>
              <div className="truncate text-foreground">{selected.label}</div>
            </div>
          ) : (
            <div className="truncate">{placeholder ?? t`Select field`}</div>
          )}
        </CommandTrigger>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        className="w-[var(--radix-popover-trigger-width)] min-w-[320px] p-0"
      >
        <Command>
          <CommandInput placeholder={t`Search fields...`} className="h-10" />
          <CommandList
            className="max-h-[320px] overflow-y-auto overscroll-contain"
            onWheel={(e) => e.stopPropagation()}
          >
            <CommandEmpty>{t`No fields found.`}</CommandEmpty>
            {(() => {
              const visibleCtx = CONTEXT_ORDER.filter(
                (k) => (grouped.get(k) ?? []).length > 0
              );
              return visibleCtx.map((ctxKey, gi) => {
                const fields = grouped.get(ctxKey) ?? [];
                const meta = CONTEXT[ctxKey];
                return (
                  <div key={ctxKey}>
                    {gi > 0 && <CommandSeparator />}
                    <CommandGroup
                      heading={
                        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {meta.icon}
                          {meta.label}
                        </span>
                      }
                    >
                      {fields.map((f) => (
                        <CommandItem
                          key={f.path}
                          value={`${meta.label} ${f.label} ${f.path}`}
                          onSelect={() => {
                            onChange(f.path);
                            setOpen(false);
                          }}
                          className="flex items-center gap-2 px-2 py-2"
                        >
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-sm font-medium">
                              {f.label}
                            </span>
                            <span className="truncate text-xs text-muted-foreground">
                              {f.path}
                            </span>
                          </span>
                          <LuCheck
                            className={cn(
                              "h-4 w-4 shrink-0",
                              value === f.path ? "opacity-100" : "opacity-0"
                            )}
                          />
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </div>
                );
              });
            })()}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
