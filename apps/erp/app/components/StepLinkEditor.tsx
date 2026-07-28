import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  IconButton,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  VStack
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuCirclePlus, LuX } from "react-icons/lu";

export type StepLinkItem = {
  id: string;
  name: string;
  // Optional muted second line (e.g. a tool's descriptive name under its id).
  secondary?: string;
  quantity: number;
};

// Step-side link picker: assign an operation's BOM parts OR tools to a step (the inverse of the
// old BOM/tool "Steps" picker). Presentational — the caller owns the linked set and persists
// changes (immediately via a route for saved steps, or a draft buffer for a step being created).
// Generic over the noun so both the Parts and Tools sections share one searchable combobox + list.
// Used by the item method editor (BillOfProcess) and the job editor (JobBillOfProcess).
export function StepLinkEditor({
  label,
  addLabel,
  emptyLabel,
  searchPlaceholder,
  removeLabel,
  icon,
  items,
  linkedIds,
  isDisabled,
  busy,
  onAdd,
  onRemove
}: {
  label: string;
  addLabel: string;
  emptyLabel: string;
  searchPlaceholder: string;
  removeLabel: string;
  // Leading glyph for the trigger button (defaults to a plus).
  icon?: JSX.Element;
  items: StepLinkItem[];
  linkedIds: string[];
  isDisabled: boolean;
  busy?: boolean;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);

  const linkedSet = new Set(linkedIds);
  const linked = items.filter((p) => linkedSet.has(p.id));
  const available = items.filter((p) => !linkedSet.has(p.id));

  if (isDisabled && linked.length === 0) return null;

  return (
    <VStack spacing={2} className="w-full col-span-2 border-t pt-4">
      <div className="flex w-full items-center justify-between">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        {!isDisabled && (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="secondary"
                size="sm"
                leftIcon={icon ?? <LuCirclePlus />}
                isLoading={busy}
                isDisabled={busy || available.length === 0}
              >
                {addLabel}
              </Button>
            </PopoverTrigger>
            {/* A searchable combobox (vs a plain dropdown) so 30-50 parts/tools stay usable.
                Stays open after each pick so several can be added in a row. */}
            <PopoverContent
              align="end"
              className="w-[280px] p-0"
              onWheel={(e) => e.stopPropagation()}
              onTouchMove={(e) => e.stopPropagation()}
            >
              <Command>
                <CommandInput placeholder={searchPlaceholder} />
                <CommandList>
                  <CommandEmpty>{t`No results`}</CommandEmpty>
                  <CommandGroup>
                    {available.map((item) => (
                      <CommandItem
                        key={item.id}
                        value={`${item.name} ${item.secondary ?? ""} ${item.id}`}
                        onSelect={() => onAdd(item.id)}
                        className="flex items-center justify-between gap-4"
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {item.name}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          ×{item.quantity}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        )}
      </div>
      {linked.length === 0 ? (
        <p className="w-full text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="flex w-full flex-col gap-2">
          {linked.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-3 rounded-lg border px-3 py-2"
            >
              <span className="size-2 shrink-0 rounded-full bg-muted-foreground/40" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm">{item.name}</span>
                {item.secondary && (
                  <span className="truncate text-xs text-muted-foreground">
                    {item.secondary}
                  </span>
                )}
              </div>
              <span className="shrink-0 rounded-md border px-2 py-0.5 text-xs text-muted-foreground">
                ×{item.quantity}
              </span>
              {!isDisabled && (
                <IconButton
                  aria-label={removeLabel}
                  icon={<LuX />}
                  variant="secondary"
                  size="sm"
                  isDisabled={busy}
                  onClick={() => onRemove(item.id)}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </VStack>
  );
}
