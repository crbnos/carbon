import type { NodeDetail } from "@carbon/workflows";
import { Trans } from "@lingui/react/macro";
import { useDataOperationLabel } from "../Builder/dataOperationLabels";

type DataCards = Extract<NodeDetail, { kind: "data" }>["cards"];

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
            {card.summary}
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
