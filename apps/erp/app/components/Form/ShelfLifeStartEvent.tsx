import { useControlField } from "@carbon/form";
import type { TermId } from "@carbon/glossary";
import {
  ChoiceCardGroup,
  FormControl,
  FormHelperText,
  FormLabel,
  LabelWithHelp,
  useMount
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import { LuCalendarArrowDown, LuCalendarArrowUp } from "react-icons/lu";
import { useFetcher } from "react-router";
import { path } from "~/utils/path";
import Process, { useProcesses } from "./Process";

type Timing = "Before" | "After";

// Process picker rendered inline with a FormLabel. Sits in a single grid
// column beside the Shelf Life (Days) input.
type ProcessProps = {
  /** Form field name for the trigger process id (TEXT). */
  processName: string;
  label: string;
  /** Glossary term wired to a `<LabelWithHelp>` info icon next to the label. */
  termId?: TermId;
  /**
   * Item whose recipe scopes the picker. When provided, options are filtered
   * to processes referenced by methodOperation rows on the item's active
   * makeMethod. Picking a process outside that set is rejected server-side
   * because the set-shelf-life helper gates on processId equality - a non-recipe
   * process would silently never match.
   */
  itemId?: string;
};

export const ShelfLifeStartProcess = ({
  processName,
  label,
  termId,
  itemId
}: ProcessProps) => {
  const allowed = useItemRecipeProcessIds(itemId);
  const allProcesses = useProcesses();

  const filteredOptions = useMemo(() => {
    if (!itemId || allowed === undefined) return undefined;
    const set = new Set(allowed);
    return allProcesses.filter((p) => set.has(p.value));
  }, [itemId, allowed, allProcesses]);

  const recipeEmpty = !!itemId && allowed !== undefined && allowed.length === 0;

  return (
    <FormControl>
      <FormLabel isOptional>
        <LabelWithHelp termId={termId}>{label}</LabelWithHelp>
      </FormLabel>
      <Process
        name={processName}
        label=""
        options={filteredOptions}
        isReadOnly={recipeEmpty}
      />
      {recipeEmpty && (
        <FormHelperText>
          <Trans>Define a manufacturing operation first.</Trans>
        </FormHelperText>
      )}
    </FormControl>
  );
};

// Timing cards stacked vertically. Label "Start Expiration" sits above.
// Renders only when a process is selected — picking start vs. end is
// meaningless without a process to anchor on.
type TimingProps = {
  /** Form field name for the trigger timing ('Before' | 'After'). */
  timingName: string;
  label: string;
  /** Glossary term wired to a `<LabelWithHelp>` info icon next to the label. */
  termId?: TermId;
};

export const ShelfLifeStartTiming = ({
  timingName,
  label,
  termId
}: TimingProps) => {
  const { t } = useLingui();
  const [timing, setTiming] = useControlField<Timing | undefined>(timingName);

  // Default the cards to "After" (process end) — the more common case.
  const current: Timing = timing ?? "After";

  return (
    <FormControl>
      <FormLabel>
        <LabelWithHelp termId={termId}>{label}</LabelWithHelp>
      </FormLabel>
      <ChoiceCardGroup<Timing>
        value={current}
        onChange={setTiming}
        direction="row"
        options={[
          {
            value: "Before",
            title: t`Start expiration on process start`,
            description: t`Expiry begins when the selected process starts.`,
            icon: <LuCalendarArrowUp />
          },
          {
            value: "After",
            title: t`Start expiration on process end`,
            description: t`Expiry begins when the selected process completes.`,
            icon: <LuCalendarArrowDown />
          }
        ]}
      />
      <input type="hidden" name={timingName} value={current} />
    </FormControl>
  );
};

// Returns the processIds referenced by the item's active recipe, or
// `undefined` while loading. Empty array = item has no recipe operations.
function useItemRecipeProcessIds(itemId: string | undefined) {
  const fetcher = useFetcher<{ data: string[]; error: unknown }>();

  useMount(() => {
    if (itemId) {
      fetcher.load(path.to.api.itemRecipeProcesses(itemId));
    }
  });

  if (!itemId) return [] as string[];
  if (fetcher.state !== "idle" || !fetcher.data) return undefined;
  return fetcher.data.data ?? [];
}
