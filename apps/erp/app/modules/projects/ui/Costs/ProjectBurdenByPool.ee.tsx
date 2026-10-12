// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { LabelWithHelp } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useCurrencyFormatter } from "~/hooks";

export type ProjectBurdenPoolRow = {
  indirectPoolId: string;
  poolName: string;
  allowable: number;
  unallowable: number;
};

const FIGURE_CELL = "w-28 shrink-0 px-2 text-right tabular-nums";

/**
 * The project's burden per indirect pool, summed over the element tree:
 * one row each, under the tree. Shown only once the burden run has
 * burdened the project.
 */
export default function ProjectBurdenByPool({
  rows
}: {
  rows: ProjectBurdenPoolRow[];
}) {
  const formatMoney = useCurrencyFormatter();

  if (rows.length === 0) return null;

  return (
    <div className="shrink-0 border-t border-border">
      <div className="flex h-12 items-center border-b border-border bg-card px-4">
        <h3 className="text-sm font-medium">
          <Trans>Burden by pool</Trans>
        </h3>
      </div>
      <div className="flex h-10 items-center border-b border-border bg-card pr-4 text-xs font-medium text-muted-foreground">
        <div className="min-w-0 flex-1 px-4">
          <LabelWithHelp termId="indirect-pool" variant="inline">
            <Trans>Pool</Trans>
          </LabelWithHelp>
        </div>
        <span className={FIGURE_CELL}>
          <Trans>Allowable</Trans>
        </span>
        <span className={FIGURE_CELL}>
          <Trans>Unallowable</Trans>
        </span>
        <span className={FIGURE_CELL}>
          <Trans>Total</Trans>
        </span>
      </div>
      <div className="max-h-72 overflow-y-auto">
        {rows.map((row) => (
          <div
            key={row.indirectPoolId}
            className="flex h-9 items-center border-b border-border pr-4 text-sm last:border-b-0"
          >
            <div className="min-w-0 flex-1 truncate px-4">{row.poolName}</div>
            <span className={FIGURE_CELL}>
              {formatMoney.format(row.allowable)}
            </span>
            <span className={FIGURE_CELL}>
              {formatMoney.format(row.unallowable)}
            </span>
            <span className={FIGURE_CELL}>
              {formatMoney.format(row.allowable + row.unallowable)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
