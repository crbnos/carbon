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
  NumberField,
  NumberInput,
  Popover,
  PopoverContent,
  PopoverTrigger,
  VStack
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuCirclePlus, LuX } from "react-icons/lu";

export type StepLinkItem = {
  id: string;
  name: string;
  // Optional muted second line (e.g. a tool's descriptive name under its id).
  secondary?: string;
  quantity: number;
  // Per-step share of the BOM line (parts only). null/undefined = the full line
  // quantity. Editable when the caller supplies onQuantityChange.
  linkedQuantity?: number | null;
  // Curated items (e.g. tools already on the operation) group FIRST in the
  // picker, under primaryGroupLabel, so they aren't buried in the full library.
  primary?: boolean;
};

// Compact per-step quantity editor on a linked row. Commits on blur/Enter via
// react-aria's NumberField; only fires when the value actually changed, so a
// plain blur never re-posts. Defaults to the full BOM line quantity. Zero (and
// cleared/invalid input) is refused — a step that uses none of a part should
// not be linked to it — and the controlled value snaps the field back.
function LinkedQuantity({
  item,
  isDisabled,
  onCommit
}: {
  item: StepLinkItem;
  isDisabled: boolean;
  onCommit: (quantity: number) => void;
}) {
  const value = item.linkedQuantity ?? item.quantity;
  return (
    <NumberField
      value={value}
      minValue={0}
      // A step's share can never exceed the BOM line quantity — the line is
      // the source of truth; entries above it clamp down on commit.
      maxValue={item.quantity}
      step={INPUT_STEP.quantity}
      formatOptions={INPUT_FORMAT.quantity}
      isDisabled={isDisabled}
      onChange={(next) => {
        if (Number.isFinite(next) && next > 0 && next !== value) {
          onCommit(next);
        }
      }}
      className="w-20 shrink-0"
      aria-label="Quantity"
    >
      <NumberInput size="sm" className="h-8 pr-2 text-right text-xs" />
    </NumberField>
  );
}

// One selectable row in the picker popover, shared by both groups.
function StepLinkOption({
  item,
  onAdd
}: {
  item: StepLinkItem;
  onAdd: (id: string) => void;
}) {
  return (
    <CommandItem
      value={`${item.name} ${item.secondary ?? ""} ${item.id}`}
      onSelect={() => onAdd(item.id)}
      className="flex items-center justify-between gap-4"
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{item.name}</span>
        {item.secondary && (
          <span className="truncate text-xs text-muted-foreground">
            {item.secondary}
          </span>
        )}
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">
        ×{item.quantity}
      </span>
    </CommandItem>
  );
}

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
  onRemove,
  onQuantityChange,
  primaryGroupLabel,
  secondaryGroupLabel
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
  // When supplied, linked rows show an editable per-step quantity (defaulting to
  // the full BOM line quantity) instead of the static ×N badge — so one line's
  // quantity can be split across steps (5 screws here, 5 on the next step).
  onQuantityChange?: (id: string, quantity: number) => void;
  // Group headings when items mix a curated set (`primary`) with the full
  // library — e.g. "On this operation" over the operation's tools, "All tools"
  // over the rest. Only rendered when at least one available item is primary.
  primaryGroupLabel?: string;
  secondaryGroupLabel?: string;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);

  const linkedSet = new Set(linkedIds);
  const linked = items.filter((p) => linkedSet.has(p.id));
  const available = items.filter((p) => !linkedSet.has(p.id));
  const availablePrimary = available.filter((p) => p.primary);
  const availableRest = available.filter((p) => !p.primary);

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
                  {availablePrimary.length > 0 && (
                    <CommandGroup heading={primaryGroupLabel}>
                      {availablePrimary.map((item) => (
                        <StepLinkOption
                          key={item.id}
                          item={item}
                          onAdd={onAdd}
                        />
                      ))}
                    </CommandGroup>
                  )}
                  <CommandGroup
                    heading={
                      availablePrimary.length > 0
                        ? secondaryGroupLabel
                        : undefined
                    }
                  >
                    {availableRest.map((item) => (
                      <StepLinkOption key={item.id} item={item} onAdd={onAdd} />
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
              {onQuantityChange && !isDisabled ? (
                <LinkedQuantity
                  item={item}
                  isDisabled={Boolean(busy)}
                  onCommit={(quantity) => onQuantityChange(item.id, quantity)}
                />
              ) : (
                <span className="shrink-0 rounded-md border px-2 py-0.5 text-xs text-muted-foreground">
                  ×{item.linkedQuantity ?? item.quantity}
                </span>
              )}
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
