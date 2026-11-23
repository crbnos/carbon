// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Badge, BarProgress } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import { Link, useLocation } from "react-router";
import { OperationStatusIcon } from "~/components/Icons";
import type { Operation as QueueOperation } from "~/services/types";
import { withOrigin } from "~/utils/origin";
import { path } from "~/utils/path";
import { sequenceOperations } from "./layout";

type Operation = {
  id: string;
  order: number;
  description: string | null;
  status: string | null;
  quantityComplete: number | null;
  targetQuantity: number | null;
  quantityReworked: number | null;
  quantityScrapped: number | null;
  reworkId: string | null;
  jobOperationBatch?: {
    readableId: string | null;
    status: string | null;
  } | null;
  jobMakeMethod: {
    item: { readableIdWithRevision: string | null } | null;
  } | null;
};

type Props = {
  operations: Operation[];
  dependencies: { operationId: string; dependsOnId: string }[];
};

export function JobOperationsList({ operations, dependencies }: Props) {
  const { t } = useLingui();
  const location = useLocation();
  const sequence = useMemo(
    () => sequenceOperations(operations, dependencies),
    [operations, dependencies]
  );

  if (sequence.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
        <Trans>This job has no operations</Trans>
      </div>
    );
  }

  return (
    <ol className="flex flex-col gap-2 p-4 max-md:pb-[calc(1rem+env(safe-area-inset-bottom))]">
      {sequence.map((op, index) => {
        const status = op.status ?? "Todo";
        const complete = Number(op.quantityComplete ?? 0);
        const target = Number(op.targetQuantity ?? 0);
        const scrapped = Number(op.quantityScrapped ?? 0);
        const itemId = op.jobMakeMethod?.item?.readableIdWithRevision;
        // Only a live batch is a working state worth labelling.
        const batch =
          op.jobOperationBatch?.status === "Active" ||
          op.jobOperationBatch?.status === "Completing"
            ? op.jobOperationBatch.readableId
            : null;

        return (
          <li key={op.id}>
            <Link
              to={withOrigin(path.to.operation(op.id), location)}
              className="flex items-center gap-4 rounded-lg border bg-card px-4 py-3 shadow-sm transition-colors hover:bg-accent/50 max-md:flex-wrap max-md:gap-x-3 max-md:gap-y-2"
            >
              <span className="w-6 shrink-0 text-sm tabular-nums text-muted-foreground">
                {index + 1}
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                {itemId && (
                  <span className="truncate text-xs text-muted-foreground">
                    {itemId}
                  </span>
                )}
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate font-medium">
                    {op.description ?? t`Untitled`}
                  </span>
                  {op.reworkId && (
                    <span className="shrink-0 rounded bg-red-100 px-1 text-[0.625rem] font-semibold text-red-600">
                      <Trans>Rework</Trans>
                    </span>
                  )}
                  {batch && (
                    <Badge
                      variant="blue"
                      className="shrink-0 px-1 text-[0.625rem]"
                    >
                      {batch}
                    </Badge>
                  )}
                </div>
              </div>
              <span className="flex w-28 shrink-0 items-center gap-1.5 text-sm max-md:w-auto">
                <OperationStatusIcon
                  status={status as QueueOperation["operationStatus"]}
                />
                {status}
              </span>
              <div className="w-48 shrink-0 max-md:w-full">
                <BarProgress
                  segments={[
                    { value: complete, className: "bg-emerald-500" },
                    {
                      value: Number(op.quantityReworked ?? 0),
                      className: "bg-yellow-500"
                    },
                    { value: scrapped, className: "bg-red-500" }
                  ]}
                  progress={complete}
                  max={target || 1}
                  value={`${complete}/${target}`}
                />
                {scrapped > 0 && (
                  <div className="mt-0.5 text-right text-[0.6875rem] text-red-500">
                    <Trans>{scrapped} scrapped</Trans>
                  </div>
                )}
              </div>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
