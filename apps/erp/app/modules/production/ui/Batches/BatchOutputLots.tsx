import { HStack, Input, Switch, VStack } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuLayers } from "react-icons/lu";
import type { BatchCandidate } from "../../types";

export type OutputLotsState = {
  mergeOutput: boolean;
  outputLotNumber: string;
  // jobOperationId -> lot number the planner typed; absent falls back to the
  // job's current lot number (its WIP entity's readableId)
  lotNumbers: Record<string, string>;
};

export const initialOutputLots: OutputLotsState = {
  mergeOutput: false,
  outputLotNumber: "",
  lotNumbers: {}
};

function trackedMembers(selected: BatchCandidate[]) {
  return selected.filter((c) => c.requiresBatchTracking && c.trackedEntityId);
}

// Merging needs every selected operation to produce ONE batch-tracked item —
// the edge fn enforces the same rule, this just hides an option it would refuse.
export function canCombineOutput(selected: BatchCandidate[]) {
  const tracked = trackedMembers(selected);
  if (tracked.length < 2 || tracked.length !== selected.length) return false;
  return new Set(tracked.map((c) => c.itemId)).size === 1;
}

export function lotNumberFor(
  candidate: BatchCandidate,
  state: OutputLotsState
) {
  return (state.lotNumbers[candidate.id] ?? candidate.lotNumber ?? "").trim();
}

// What the create request carries: the planner's choice, resolved.
export function outputLotsPayload(
  selected: BatchCandidate[],
  state: OutputLotsState
) {
  const merge = state.mergeOutput && canCombineOutput(selected);
  if (merge) {
    return { mergeOutput: true, outputLotNumber: state.outputLotNumber.trim() };
  }
  return {
    mergeOutput: false,
    lotNumbers: trackedMembers(selected).map((c) => ({
      jobOperationId: c.id,
      lotNumber: lotNumberFor(c, state)
    }))
  };
}

// Null when the planned lots are complete; otherwise why Create is disabled.
export function outputLotsProblem(
  selected: BatchCandidate[],
  state: OutputLotsState
): "missing" | "duplicate" | null {
  const payload = outputLotsPayload(selected, state);
  if (payload.mergeOutput) {
    return payload.outputLotNumber ? null : "missing";
  }
  const numbers = (payload.lotNumbers ?? []).map((l) => l.lotNumber);
  if (numbers.some((n) => !n)) return "missing";
  const seen = new Set<string>();
  for (const n of numbers) {
    const key = n.toLowerCase();
    if (seen.has(key)) return "duplicate";
    seen.add(key);
  }
  return null;
}

export function BatchOutputLots({
  selected,
  value,
  onChange
}: {
  selected: BatchCandidate[];
  value: OutputLotsState;
  onChange: (next: OutputLotsState) => void;
}) {
  const { t } = useLingui();
  const tracked = trackedMembers(selected);
  if (tracked.length === 0) return null;

  const combinable = canCombineOutput(selected);
  const merge = value.mergeOutput && combinable;
  const problem = outputLotsProblem(selected, value);

  const counts = new Map<string, number>();
  if (!merge) {
    for (const c of tracked) {
      const key = lotNumberFor(c, value).toLowerCase();
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  return (
    <VStack
      spacing={2}
      className="px-4 py-3 border-b w-full flex-shrink-0 items-stretch"
    >
      <HStack spacing={2}>
        <LuLayers className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">
          <Trans>Output</Trans>
        </span>
        {combinable && (
          <span className="ml-auto text-xs text-muted-foreground truncate">
            {t`all make ${tracked[0]?.itemReadableId ?? ""}`}
          </span>
        )}
      </HStack>

      {combinable && (
        <Switch
          variant="small"
          checked={value.mergeOutput}
          onCheckedChange={(checked) =>
            onChange({ ...value, mergeOutput: checked })
          }
          label={t`Combine output into one lot`}
        />
      )}

      {merge ? (
        <Input
          size="sm"
          value={value.outputLotNumber}
          onChange={(e) =>
            onChange({ ...value, outputLotNumber: e.target.value })
          }
          placeholder={t`Lot number`}
          className="font-mono"
        />
      ) : (
        <VStack spacing={1} className="items-stretch">
          {tracked.map((c) => {
            const number = lotNumberFor(c, value);
            const clashes =
              number && (counts.get(number.toLowerCase()) ?? 0) > 1;
            return (
              <HStack key={c.id} spacing={2}>
                <span className="w-24 flex-shrink-0 text-sm tabular-nums truncate">
                  {c.jobReadableId}
                </span>
                <Input
                  size="sm"
                  value={value.lotNumbers[c.id] ?? c.lotNumber ?? ""}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      lotNumbers: {
                        ...value.lotNumbers,
                        [c.id]: e.target.value
                      }
                    })
                  }
                  placeholder={t`Lot number`}
                  aria-invalid={!number || Boolean(clashes)}
                  className="font-mono"
                />
              </HStack>
            );
          })}
        </VStack>
      )}

      <p className="text-xs text-muted-foreground text-pretty">
        {problem === "duplicate" ? (
          <span className="text-destructive">
            <Trans>
              Each job needs its own lot number — or combine them into one lot.
            </Trans>
          </span>
        ) : merge ? (
          <Trans>
            Everything this run makes lands in one lot. The shop floor can't
            change it.
          </Trans>
        ) : (
          <Trans>
            Each job keeps its own lot. The shop floor can't change these.
          </Trans>
        )}
      </p>
    </VStack>
  );
}
