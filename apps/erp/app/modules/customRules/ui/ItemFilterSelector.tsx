import { useControlField, useField } from "@carbon/form";
import {
  Badge,
  ChoiceSelect,
  type ChoiceSelectOption,
  FormControl,
  FormErrorMessage,
  FormLabel,
  ToggleGroup,
  ToggleGroupItem
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { AnimatePresence, motion } from "framer-motion";
import { LuBox, LuDroplet, LuFilter, LuLayers, LuWrench } from "react-icons/lu";
import { MultiSelect } from "~/components/Form";
import { useItemPostingGroups } from "~/components/Form/ItemPostingGroup";
import { itemTypes } from "~/modules/inventory/inventory.models";

const ITEM_TYPE_ICON: Record<(typeof itemTypes)[number], JSX.Element> = {
  Part: <LuBox />,
  Material: <LuLayers />,
  Tool: <LuWrench />,
  Consumable: <LuDroplet />
};

const ITEM_TYPE_OPTIONS: ChoiceSelectOption<string>[] = itemTypes.map((t) => ({
  value: t,
  title: t,
  icon: ITEM_TYPE_ICON[t]
}));

function ItemTypesField() {
  const { t } = useLingui();
  const name = "filteredItemTypes";
  const { error } = useField(name);
  const [value, setValue] = useControlField<string[]>(name);
  const selected = value ?? [];

  return (
    <FormControl isInvalid={!!error}>
      <FormLabel htmlFor={name}>
        <Trans>Item types</Trans>
      </FormLabel>

      {selected.map((v, index) => (
        <input key={v} type="hidden" name={`${name}[${index}]`} value={v} />
      ))}

      <ChoiceSelect<string>
        multiple
        value={selected}
        onChange={(next) => setValue(next)}
        options={ITEM_TYPE_OPTIONS}
        placeholder={t`Any item type`}
        aria-label={t`Item types`}
      />

      {error && <FormErrorMessage>{error}</FormErrorMessage>}
    </FormControl>
  );
}

// Two-segment AND/OR switch. Submits checkbox-style: a hidden input is present
// only for AND (true), matching `zfd.checkbox()` server-side.
function MatchModeToggle() {
  const { t } = useLingui();
  const [value, setValue] = useControlField<boolean>("filteredItemMatchAll");
  const matchAll = value ?? false;

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex flex-col">
        <span className="text-sm font-medium text-foreground">
          <Trans>Combine filters</Trans>
        </span>
        <span className="text-pretty text-xs text-muted-foreground">
          {matchAll ? (
            <Trans>Item must match a selected type AND a selected group</Trans>
          ) : (
            <Trans>Item must match a selected type OR a selected group</Trans>
          )}
        </span>
      </div>

      {matchAll ? (
        <input type="hidden" name="filteredItemMatchAll" value="on" />
      ) : null}

      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={matchAll ? "all" : "any"}
        // Radix single-toggle can fire "" when clicking the active item; ignore
        // that so the operator can never become unset.
        onValueChange={(next) => {
          if (next) setValue(next === "all");
        }}
      >
        <ToggleGroupItem
          value="any"
          aria-label={t`Match any (OR)`}
          className="transition-[transform,color,box-shadow] active:scale-[0.96]"
        >
          <Trans>OR</Trans>
        </ToggleGroupItem>
        <ToggleGroupItem
          value="all"
          aria-label={t`Match all (AND)`}
          className="transition-[transform,color,box-shadow] active:scale-[0.96]"
        >
          <Trans>AND</Trans>
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}

function useFilterCounts() {
  const [types] = useControlField<string[]>("filteredItemTypes");
  const [groups] = useControlField<string[]>("filteredItemGroupIds");
  return {
    types: types?.length ?? 0,
    groups: groups?.length ?? 0,
    total: (types?.length ?? 0) + (groups?.length ?? 0)
  };
}

export default function ItemFilterSelector() {
  const { t } = useLingui();
  const groupOptions = useItemPostingGroups() as {
    value: string;
    label: string;
  }[];
  const counts = useFilterCounts();
  const filterCount = counts.total;
  // OR vs AND only matters when both dimensions constrain the set.
  const showMatchMode = counts.types > 0 && counts.groups > 0;

  return (
    <div className="w-full rounded-lg border border-border bg-card/40 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <LuFilter className="h-3.5 w-3.5 text-muted-foreground" />
          <Trans>Item filters</Trans>
          {filterCount > 0 ? (
            <Badge variant="secondary" className="ml-1 tabular-nums">
              {filterCount}
            </Badge>
          ) : null}
        </div>
        <span className="text-xs text-muted-foreground">
          <Trans>Empty = match every item</Trans>
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ItemTypesField />

        <MultiSelect
          name="filteredItemGroupIds"
          label={t`Item groups`}
          options={groupOptions}
          placeholder={t`Any item group`}
        />
      </div>

      <AnimatePresence initial={false}>
        {showMatchMode && (
          <motion.div
            key="match-mode"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ type: "spring", duration: 0.3, bounce: 0 }}
            className="mt-3 border-t border-border pt-3"
          >
            <MatchModeToggle />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
