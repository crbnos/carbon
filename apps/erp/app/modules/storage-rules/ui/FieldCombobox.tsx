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
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@carbon/react";
import {
  FIELD_REGISTRY,
  type FieldDef,
  getFieldDef,
  getFieldsForTargetTypeAndSurfaces,
  type TransactionSurface
} from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import {
  LuBlocks,
  LuBox,
  LuCheck,
  LuChevronDown,
  LuInfo,
  LuReceipt
} from "react-icons/lu";

const CONTEXT: Record<
  FieldDef["context"],
  { label: string; icon: JSX.Element }
> = {
  item: { label: "Item", icon: <LuBlocks className="h-3.5 w-3.5" /> },
  storage: { label: "Storage unit", icon: <LuBox className="h-3.5 w-3.5" /> },
  workCenter: {
    label: "Work center",
    icon: <LuBox className="h-3.5 w-3.5" />
  },
  operation: {
    label: "Operation",
    icon: <LuReceipt className="h-3.5 w-3.5" />
  },
  transaction: {
    label: "Transaction",
    icon: <LuReceipt className="h-3.5 w-3.5" />
  }
};

const CONTEXT_ORDER: FieldDef["context"][] = [
  "item",
  "storage",
  "workCenter",
  "operation",
  "transaction"
];

type FieldComboboxProps = {
  value: string;
  onChange: (path: string) => void;
  placeholder?: string;
  className?: string;
  targetType?: "item" | "workCenter";
  /**
   * Surfaces the rule subscribes to. Narrows the offered fields to those whose
   * root context the evaluator populates on every selected surface, so authors
   * can't pick a field that won't resolve at runtime.
   */
  surfaces?: TransactionSurface[];
};

export default function FieldCombobox({
  value,
  onChange,
  placeholder,
  className,
  targetType,
  surfaces
}: FieldComboboxProps) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);

  const grouped = useMemo(() => {
    const map = new Map<FieldDef["context"], FieldDef[]>();
    for (const ctx of CONTEXT_ORDER) map.set(ctx, []);
    const pool = targetType
      ? getFieldsForTargetTypeAndSurfaces(targetType, surfaces ?? [])
      : FIELD_REGISTRY;
    for (const f of pool) map.get(f.context)!.push(f);
    return map;
  }, [targetType, surfaces]);

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
              {selected.description && (
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={t`Field info`}
                        className="ml-0.5 inline-flex shrink-0 cursor-help items-center justify-center rounded text-muted-foreground hover:text-foreground"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                          }
                        }}
                      >
                        <LuInfo className="h-3.5 w-3.5" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent
                      side="top"
                      align="start"
                      sideOffset={6}
                      className="max-w-[32ch] text-xs leading-snug"
                    >
                      {selected.description}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
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
                      {fields.map((f) => {
                        const item = (
                          <CommandItem
                            key={f.path}
                            value={`${meta.label} ${f.label} ${f.path} ${f.description ?? ""}`}
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
                        );
                        if (!f.description) return item;
                        return (
                          <TooltipProvider key={f.path} delayDuration={300}>
                            <Tooltip>
                              <TooltipTrigger asChild>{item}</TooltipTrigger>
                              <TooltipContent
                                side="right"
                                align="start"
                                sideOffset={8}
                                className="max-w-[28ch] text-xs leading-snug"
                              >
                                {f.description}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        );
                      })}
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
