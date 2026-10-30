// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction, useLoaderQuery } from "@carbon/query";
import {
  Badge,
  Button,
  cn,
  IconButton,
  Input,
  NumberField,
  NumberInput,
  Skeleton
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuPlus, LuTrash } from "react-icons/lu";
import { inventoryCountLineState } from "~/modules/inventory/inventory.utils";
import type {
  InventoryCountGroup,
  InventoryCountLine
} from "~/modules/inventory/types";
import { path } from "~/utils/path";
import InventoryCountUnitForm from "./InventoryCountUnitForm";

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
  const [isAdding, setIsAdding] = useState(false);
  const remove = useAction();

  const addUnit = isReadOnly ? null : (
    <>
      <Button
        variant="ghost"
        size="sm"
        leftIcon={<LuPlus />}
        className="my-1"
        onClick={() => setIsAdding(true)}
      >
        {t`Add unit`}
      </Button>
      {isAdding && (
        <InventoryCountUnitForm
          inventoryCountId={inventoryCountId}
          prompt={{
            storageUnitId: group.storageUnitId ?? null,
            itemId: group.itemId ?? undefined
          }}
          onClose={() => setIsAdding(false)}
          onRecorded={() => setIsAdding(false)}
        />
      )}
    </>
  );

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
        <div>{addUnit}</div>
      </div>
    );
  }

  // Units with no serial number cannot be told apart: one quantity row.
  const unnumbered = lines.filter(
    (line) => line.isUnnumbered && !line.foundDuringCount
  );
  const listed = lines.filter(
    (line) => !(line.isUnnumbered && !line.foundDuringCount)
  );
  const unnumberedCounted = unnumbered.some(
    (line) => line.countedQuantity !== null
  )
    ? unnumbered.filter((line) => Number(line.countedQuantity) > 0).length
    : null;
  const foundUnnumbered = unnumbered.filter(
    (line) => Number(line.countedQuantity) > 0
  );

  return (
    <div className="pl-[52px] pr-4">
      {unnumbered.length > 0 && (
        <div className="py-1.5">
          <div className="flex items-center gap-3 text-sm">
            <div
              aria-hidden
              className="w-5 shrink-0 self-stretch border-l border-border -my-1.5"
            />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {t`No serial number`}
            </span>
            {!hideSystemQuantity && (
              <span className="w-20 text-right tabular-nums text-muted-foreground">
                {unnumbered.length}
              </span>
            )}
            <UnnumberedCount
              inventoryCountId={inventoryCountId}
              itemId={group.itemId!}
              storageUnitId={group.storageUnitId ?? null}
              value={unnumberedCounted}
              isReadOnly={isReadOnly}
            />
            <span className="w-24" />
            <span className="w-8" />
          </div>
          {foundUnnumbered.length > 0 && (
            <div className="flex flex-wrap gap-2 py-1.5 pl-8">
              {foundUnnumbered.map((line, index) => (
                <AssignSerial
                  key={line.id}
                  inventoryCountId={inventoryCountId}
                  lineId={line.id!}
                  value={line.assignedReadableId ?? ""}
                  placeholder={t`Serial for unit ${index + 1}`}
                  isReadOnly={isReadOnly}
                />
              ))}
            </div>
          )}
        </div>
      )}
      {listed.map((line) => {
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
            <div className="w-8">
              {!isReadOnly && line.foundDuringCount && (
                <IconButton
                  aria-label={t`Remove unit`}
                  icon={<LuTrash />}
                  variant="ghost"
                  size="sm"
                  isDisabled={remove.state !== "idle"}
                  onClick={() =>
                    remove.submit(null, {
                      method: "post",
                      action: path.to.inventoryCountUnitDelete(
                        inventoryCountId,
                        line.id!
                      )
                    })
                  }
                />
              )}
            </div>
          </div>
        );
      })}
      {addUnit}
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

// The number of units with no serial number on the shelf. The oldest units
// count first.
function UnnumberedCount({
  inventoryCountId,
  itemId,
  storageUnitId,
  value,
  isReadOnly
}: {
  inventoryCountId: string;
  itemId: string;
  storageUnitId: string | null;
  value: number | null;
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
    if (draft === null || draft === value) return;
    const formData = new FormData();
    formData.set("itemId", itemId);
    formData.set("storageUnitId", storageUnitId ?? "");
    formData.set("quantity", String(draft));
    fetcher.submit(formData, {
      method: "post",
      action: path.to.inventoryCountUnnumbered(inventoryCountId)
    });
  };

  return (
    <NumberField
      aria-label={t`Counted with no serial number`}
      className="w-20"
      minValue={0}
      value={draft ?? Number.NaN}
      onChange={(next) => setDraft(Number.isFinite(next) ? next : null)}
      isDisabled={fetcher.state !== "idle"}
    >
      <NumberInput size="sm" className="text-right" onBlur={commit} />
    </NumberField>
  );
}

// A serial number for one counted unit that has none. The post writes it.
function AssignSerial({
  inventoryCountId,
  lineId,
  value,
  placeholder,
  isReadOnly
}: {
  inventoryCountId: string;
  lineId: string;
  value: string;
  placeholder: string;
  isReadOnly: boolean;
}) {
  const fetcher = useAction();
  const [draft, setDraft] = useState(value);

  if (isReadOnly) {
    return value ? <span className="font-mono text-xs">{value}</span> : null;
  }

  const commit = () => {
    const next = draft.trim();
    if (!next || next === value) return;
    const formData = new FormData();
    formData.set("lineId", lineId);
    formData.set("readableId", next);
    fetcher.submit(formData, {
      method: "post",
      action: path.to.inventoryCountSerial(inventoryCountId)
    });
  };

  return (
    <Input
      size="sm"
      className="w-40 font-mono text-xs"
      value={draft}
      placeholder={placeholder}
      aria-label={placeholder}
      disabled={fetcher.state !== "idle"}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

export default InventoryCountGroupUnits;
