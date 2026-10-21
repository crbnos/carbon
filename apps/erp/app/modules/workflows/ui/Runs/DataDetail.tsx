// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { CardRefusal, NodeDetail } from "@carbon/ee/workflows";
import { Plural, Trans } from "@lingui/react/macro";
import { useDataOperationLabel } from "../Builder/dataOperationLabels";

type DataCards = Extract<NodeDetail, { kind: "data" }>["cards"];
type DataCard = DataCards[number];

function RefusalReason({ refusal }: { refusal: CardRefusal }) {
  switch (refusal) {
    case "not-a-list":
      return <Trans>This step expected a list.</Trans>;
    case "no-fields":
      return <Trans>The items in that list have no fields to take.</Trans>;
    case "no-field-chosen":
      return <Trans>No field was chosen to take.</Trans>;
    case "unknown-field":
      return <Trans>The items in that list have no field by that name.</Trans>;
    case "nested-list":
      return (
        <Trans>
          That field holds a list of its own. Turn on flattening to take it.
        </Trans>
      );
    case "not-text":
      return <Trans>The items in that list have no reading as text.</Trans>;
  }
}

/** The card's outcome in the reader's language, from the numbers or the refusal
 * code the engine stored. Only a row with neither shows the engine's own text. */
function CardSummary({ card }: { card: DataCard }) {
  if (card.status === "Skipped" && card.refusal !== undefined) {
    return <RefusalReason refusal={card.refusal} />;
  }
  const counts = card.counts;
  if (card.status !== "Succeeded" || counts === undefined) {
    return <>{card.summary}</>;
  }
  const total = counts.input;
  const kept = counts.output ?? 0;
  const unresolved = counts.unresolved ?? 0;
  switch (card.operation) {
    case "filter":
      return unresolved === 0 ? (
        <Trans>
          Kept {kept} of {total}.
        </Trans>
      ) : (
        <Trans>
          Kept {kept} of {total}; {unresolved} could not be checked.
        </Trans>
      );
    case "count":
      return <Trans>Counted {total}.</Trans>;
    case "first":
      return total === 0 ? (
        <Trans>That list was empty.</Trans>
      ) : (
        <Trans>Took the first of {total}.</Trans>
      );
    case "last":
      return total === 0 ? (
        <Trans>That list was empty.</Trans>
      ) : (
        <Trans>Took the last of {total}.</Trans>
      );
    case "pluck": {
      const dropped = counts.dropped ?? 0;
      const took = kept + dropped;
      return dropped === 0 ? (
        <Plural value={kept} one="Took # value." other="Took # values." />
      ) : (
        <Trans>
          Took {took} values; kept the first {kept}.
        </Trans>
      );
    }
    case "join":
      return (
        <Plural value={total} one="Joined # value." other="Joined # values." />
      );
  }
}

/**
 * A data node's chain, one row per operation card, in run order — how a
 * surprising final result stays debuggable ("Kept 0 of 10" three rows up).
 *
 * Takes `unknown` and answers only for its own detail kind, exactly as
 * `ConditionDetail` does, so the step row can offer the detail to both without
 * caring which node produced it.
 */
export function DataDetail({ detail }: { detail: unknown }) {
  const operationLabel = useDataOperationLabel();

  if (!detail || typeof detail !== "object") return null;
  const d = detail as Record<string, unknown>;
  if (d.kind !== "data") return null;

  const cards = d.cards as DataCards;
  if (!Array.isArray(cards) || cards.length === 0) return null;

  return (
    <ol className="space-y-1.5">
      {cards.map((card, index) => (
        <li key={card.id} className="flex items-baseline gap-2 text-sm">
          <span className="text-xs text-muted-foreground tabular-nums">
            {index + 1}.
          </span>
          <span className="font-medium">{operationLabel(card.operation)}</span>
          <span className="min-w-0 shrink text-muted-foreground">
            <CardSummary card={card} />
          </span>
          {card.status === "Skipped" && (
            <span className="ml-auto self-center rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              <Trans>Skipped</Trans>
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
