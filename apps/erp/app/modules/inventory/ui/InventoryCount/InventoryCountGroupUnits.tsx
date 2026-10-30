// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction, useLoaderQuery } from "@carbon/query";
import { Badge, cn, NumberField, NumberInput, Skeleton } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { inventoryCountLineState } from "~/modules/inventory/inventory.utils";
import type {
  InventoryCountGroup,
  InventoryCountLine
} from "~/modules/inventory/types";
import { path } from "~/utils/path";

type GroupLinesLoader = { lines: InventoryCountLine[] };

const STATE_BADGE = {
  Found: "green",
  Missing: "red",
  Unexpected: "blue",
  "Not counted": "gray"
} as const;

type InventoryCountGroupUnitsProps = {
  inventoryCountId: string;
  group: InventoryCountGroup;
  hideSystemQuantity: boolean;
  isReadOnly: boolean;
  invalidLineIds?: string[];
};

// The units of one count group, shown when its row expands: one line per
// serial or batch, with its state.
const InventoryCountGroupUnits = ({
  inventoryCountId,
  group,
  hideSystemQuantity,
  isReadOnly,
  invalidLineIds
}: InventoryCountGroupUnitsProps) => {
  const { t } = useLingui();
  const { data, isLoading } = useLoaderQuery<GroupLinesLoader>(
    path.to.api.inventoryCountGroup(
      inventoryCountId,
      group.itemId!,
      group.storageUnitId ?? null
    )
  );
  const lines = data?.lines ?? [];
  const isSerial = group.itemTrackingType === "Serial";

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 py-2 pl-[52px] pr-4">
        <Skeleton className="h-5 w-64" />
        <Skeleton className="h-5 w-48" />
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <div className="py-2 pl-[52px] pr-4 text-sm text-muted-foreground">
        {hideSystemQuantity
          ? t`No units counted yet`
          : t`No units in this storage unit`}
      </div>
    );
  }

  return (
    <div className="pl-[52px] pr-4">
      {lines.map((line) => {
        const state = inventoryCountLineState({
          countedQuantity:
            line.countedQuantity === null ? null : Number(line.countedQuantity),
          foundDuringCount: Boolean(line.foundDuringCount)
        });
        const isInvalid = invalidLineIds?.includes(line.id ?? "");
        return (
          <div
            key={line.id}
            data-count-line={line.id}
            className={cn(
              "flex items-center gap-3 py-1.5 text-sm",
              isInvalid && "bg-destructive/30"
            )}
          >
            <div
              aria-hidden
              className="w-5 shrink-0 self-stretch border-l border-border -my-1.5"
            />
            <span className="min-w-0 flex-1 truncate font-mono text-xs">
              {line.readableId ?? (
                <span className="font-sans text-muted-foreground">
                  {t`No serial number`}
                </span>
              )}
            </span>
            {!hideSystemQuantity && (
              <span className="w-20 text-right tabular-nums text-muted-foreground">
                {Number(line.systemQuantity ?? 0)}
              </span>
            )}
            <LineCount
              lineId={line.id!}
              value={
                line.countedQuantity === null
                  ? null
                  : Number(line.countedQuantity)
              }
              maxValue={isSerial ? 1 : undefined}
              isReadOnly={isReadOnly}
            />
            <Badge variant={STATE_BADGE[state]} className="w-24 justify-center">
              {stateLabel(state, t)}
            </Badge>
          </div>
        );
      })}
    </div>
  );
};

function stateLabel(
  state: keyof typeof STATE_BADGE,
  t: ReturnType<typeof useLingui>["t"]
) {
  switch (state) {
    case "Found":
      return t`Found`;
    case "Missing":
      return t`Missing`;
    case "Unexpected":
      return t`Unexpected`;
    default:
      return t`Not counted`;
  }
}

// One unit's count. It saves through the same route as the count sheet's
// cells, so the group row and the summary refresh after it.
function LineCount({
  lineId,
  value,
  maxValue,
  isReadOnly
}: {
  lineId: string;
  value: number | null;
  maxValue?: number;
  isReadOnly: boolean;
}) {
  const { t } = useLingui();
  const fetcher = useAction();
  const [draft, setDraft] = useState<number | null>(value);

  if (isReadOnly) {
    return (
      <span className="w-20 text-right tabular-nums">
        {value === null ? "—" : value}
      </span>
    );
  }

  const commit = () => {
    if (draft === value) return;
    const formData = new FormData();
    formData.set("id", lineId);
    formData.set("countedQuantity", draft === null ? "" : String(draft));
    fetcher.submit(formData, {
      method: "post",
      action: path.to.inventoryCountLineUpdate
    });
  };

  return (
    <NumberField
      aria-label={t`Counted`}
      className="w-20"
      minValue={0}
      maxValue={maxValue}
      value={draft ?? Number.NaN}
      onChange={(next) => setDraft(Number.isFinite(next) ? next : null)}
      isDisabled={fetcher.state !== "idle"}
    >
      <NumberInput size="sm" className="text-right" onBlur={commit} />
    </NumberField>
  );
}

export default InventoryCountGroupUnits;
