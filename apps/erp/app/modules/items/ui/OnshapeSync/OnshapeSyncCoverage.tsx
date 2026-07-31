import { Tooltip, TooltipContent, TooltipTrigger } from "@carbon/react";
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
 */
export function OnshapeSyncCoverage({
  coverage
}: {
  coverage: OnshapeSyncCoverageData | null;
}) {
  const { t } = useLingui();

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
    partsTotal > 0 ? Math.round((partsWithModel / partsTotal) * 100) : null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="text-xs text-muted-foreground tabular-nums">
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
