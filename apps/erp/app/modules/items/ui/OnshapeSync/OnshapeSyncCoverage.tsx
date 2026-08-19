import { Tooltip, TooltipContent, TooltipTrigger } from "@carbon/react";
import { round } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";

export type OnshapeSyncCoverageData = {
  modelsSynced: number;
  modelsTracked: number;
  drawingsSynced: number;
  drawingsTracked: number;
  partsWithModel: number;
  partsTotal: number;
};

/**
 * How much CAD the company actually holds, beside the tab bar. Two different
 * denominators, so the tooltip names both: the ratios count the parts this sync
 * has tried, the percentage counts the whole parts catalog (and therefore
 * includes models a person uploaded by hand).
 *
 * `"unavailable"` is its own state rather than a null: a count that failed to
 * read must not render as a figure of zero, and vanishing silently would read
 * as "this company has no CAD".
 */
export function OnshapeSyncCoverage({
  coverage
}: {
  coverage: OnshapeSyncCoverageData | "unavailable" | null;
}) {
  const { t } = useLingui();

  if (coverage === "unavailable") {
    return (
      <span className="text-xs text-muted-foreground">
        <Trans>Coverage unavailable</Trans>
      </span>
    );
  }

  if (!coverage) return null;

  const { modelsSynced, modelsTracked, drawingsSynced, drawingsTracked } =
    coverage;
  const { partsWithModel, partsTotal } = coverage;

  if (modelsTracked === 0 && drawingsTracked === 0 && partsWithModel === 0) {
    return (
      <span className="text-xs text-muted-foreground">
        <Trans>No CAD synced yet</Trans>
      </span>
    );
  }

  const catalogPercent =
    partsTotal > 0 ? round((partsWithModel / partsTotal) * 100, 0) : null;

  return (
    <Tooltip>
      {/* The span carries focus itself: the tooltip is the only place the two
          denominators are explained, so a mouse-only trigger hides the meaning
          of the numbers beside it. */}
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="text-xs text-muted-foreground tabular-nums rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t`Models ${modelsSynced}/${modelsTracked}`}
          {drawingsTracked > 0
            ? ` · ${t`Drawings ${drawingsSynced}/${drawingsTracked}`}`
            : null}
          {catalogPercent !== null
            ? ` · ${t`${catalogPercent}% of parts have a model`}`
            : null}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <Trans>
          Models and drawings synced, out of the parts this sync has tried.{" "}
          {partsWithModel} of {partsTotal} parts in the catalog carry a CAD
          model, including any uploaded by hand.
        </Trans>
      </TooltipContent>
    </Tooltip>
  );
}
