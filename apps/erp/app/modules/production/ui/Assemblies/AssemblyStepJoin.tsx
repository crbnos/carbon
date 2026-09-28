import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  HStack,
  LabelWithHelp
} from "@carbon/react";
import type {
  AssemblyGraphIndex,
  AssemblyStep,
  NamedUnit
} from "@carbon/viewer";
import { describeStep, joinTargets } from "@carbon/viewer";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { LuChevronDown } from "react-icons/lu";
import { useFetcher, useParams } from "react-router";
import { path } from "~/utils/path";
import PlaybackRow from "./AssemblyPlaybackRow";

type AssemblyStepJoinProps = {
  stepId: string;
  /** Every step of the instruction, in order */
  steps: AssemblyStep[];
  graphIndex: AssemblyGraphIndex | null;
  units: NamedUnit[];
  isDisabled: boolean;
  onSelectStep: (stepId: string) => void;
};

/**
 * "Build off to the side", one row of the step's Playback box: point this step
 * at a later join step so its parts are built beside the model and carried in
 * there. Autosaves like the step status. On a join step, lists the steps whose
 * group it brings in.
 */
export default function AssemblyStepJoin({
  stepId,
  steps,
  graphIndex,
  units,
  isDisabled,
  onSelectStep
}: AssemblyStepJoinProps) {
  const { t } = useLingui();
  const { id: instructionId } = useParams();
  if (!instructionId) throw new Error("Could not find id");
  const fetcher = useFetcher<{ success: boolean }>();

  const { targets, locked } = joinTargets(steps, stepId);
  const numbered = steps.map((step, index) => ({
    step,
    number: index + 1,
    title: describeStep(step, graphIndex, units) ?? t`Untitled step`
  }));
  const options = numbered.filter(({ step }) => targets.includes(step.id));
  const broughtIn = numbered.filter(({ step }) => step.joinStepId === stepId);

  const saved = steps.find((step) => step.id === stepId)?.joinStepId ?? "";
  const value =
    fetcher.state !== "idle" && fetcher.formData
      ? ((fetcher.formData.get("joinStepId") as string | null) ?? saved)
      : saved;
  const selected = numbered.find(({ step }) => step.id === value);
  const shortLabel = selected ? t`Joins step ${selected.number}` : t`No`;

  const onChange = (next: string) => {
    if (next === value) return;
    const formData = new FormData();
    formData.append("joinStepId", next);
    fetcher.submit(formData, {
      method: "post",
      action: path.to.assemblyInstructionStepJoin(instructionId, stepId)
    });
  };

  let control: ReactNode;
  if (locked === "base") {
    control = (
      <span className="text-xs text-muted-foreground">
        <Trans>No, it's the base</Trans>
      </span>
    );
  } else if (locked === "join") {
    control = (
      <HStack spacing={1} className="flex-wrap items-center text-xs">
        <span className="text-muted-foreground">
          <Trans>Brings in steps</Trans>
        </span>
        {broughtIn.map(({ step, number }) => (
          <Button
            key={step.id}
            variant="link"
            size="sm"
            className="h-auto px-0.5 tabular-nums"
            onClick={() => onSelectStep(step.id)}
          >
            {number}
          </Button>
        ))}
      </HStack>
    );
  } else if (isDisabled) {
    control = <span className="text-xs text-foreground">{shortLabel}</span>;
  } else {
    control = (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex h-6 max-w-[10rem] items-center gap-1 rounded-md border border-border bg-card px-2 text-xs text-foreground shadow-button-base hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <span className="truncate">{shortLabel}</span>
            <LuChevronDown className="size-3 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="min-w-[16rem] max-w-[20rem] max-h-72 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent"
        >
          <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
            <DropdownMenuRadioItem value="">
              <Trans>No, build in place</Trans>
            </DropdownMenuRadioItem>
            {options.map(({ step, number, title }) => {
              const label = t`Joins step ${number}: ${title}`;
              return (
                <DropdownMenuRadioItem
                  key={step.id}
                  value={step.id}
                  title={label}
                >
                  <span className="truncate">{label}</span>
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <PlaybackRow
      label={
        <LabelWithHelp termId="assembly-step-build-aside" variant="inline">
          <Trans>Build off to the side</Trans>
        </LabelWithHelp>
      }
    >
      {control}
    </PlaybackRow>
  );
}
