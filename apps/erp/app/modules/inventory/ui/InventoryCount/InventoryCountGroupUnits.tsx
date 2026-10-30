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
  Skeleton,
  ToggleGroup,
  ToggleGroupItem
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { type ReactNode, useState } from "react";
import { LuPlus, LuTrash } from "react-icons/lu";
import {
  type InventoryCountLineState,
  inventoryCountLineState
} from "~/modules/inventory/inventory.utils";
import type {
  InventoryCountGroup,
  InventoryCountLine
} from "~/modules/inventory/types";
import { path } from "~/utils/path";
import InventoryCountUnitForm from "./InventoryCountUnitForm";

type GroupLinesLoader = {
  lines: (InventoryCountLine & { otherBinName?: string | null })[];
};

const STATE_BADGE = {
  Found: "green",
  Missing: "red",
  Unexpected: "blue",
  "Not counted": "gray"
} as const;

// The columns of a unit row: number, expected, counted, state, action.
const ROW =
  "grid grid-cols-[minmax(0,1fr)_6rem_11rem_12rem_2.5rem] items-center gap-3";

type InventoryCountGroupUnitsProps = {
  inventoryCountId: string;
  group: InventoryCountGroup;
  hideSystemQuantity: boolean;
  isReadOnly: boolean;
  invalidLineIds?: string[];
};

// The units of one count group, shown when its row expands. A serial is
// marked Found or Missing; a batch takes a quantity. Units with no serial
// number are counted together as one quantity.
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
  const [isAdding, setIsAdding] = useState(false);

  const isSerial = group.itemTrackingType === "Serial";
  const stateLabels: Record<InventoryCountLineState, string> = {
    Found: t`Found`,
    Missing: t`Missing`,
    Unexpected: t`Unexpected`,
    "Not counted": t`Not counted`
  };

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 py-2 pl-[52px] pr-4">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
      </div>
    );
  }

  const lines = data?.lines ?? [];
  // A serial unit with no number cannot be told apart from the others.
  const unnumbered = lines.filter(
    (line) => isSerial && line.isUnnumbered && !line.foundDuringCount
  );
  const listed = lines.filter((line) => !unnumbered.includes(line));

  return (
    <div className="pb-2 pl-[52px] pr-4 text-sm">
      <div
        className={cn(
          ROW,
          "border-b border-border py-1.5 text-xs text-muted-foreground"
        )}
      >
        <span>{isSerial ? t`Serial number` : t`Batch number`}</span>
        <span className="text-right">
          {hideSystemQuantity ? "" : t`Expected`}
        </span>
        <span>{t`Counted`}</span>
        <span>{t`State`}</span>
        <span />
      </div>

      {listed.length === 0 && unnumbered.length === 0 && (
        <p className="py-2 text-muted-foreground">
          {hideSystemQuantity
            ? t`No units counted yet. Scan a unit to count it.`
            : t`No units in this storage unit.`}
        </p>
      )}

      {listed.map((line) => {
        const state = inventoryCountLineState({
          countedQuantity:
            line.countedQuantity === null ? null : Number(line.countedQuantity),
          foundDuringCount: Boolean(line.foundDuringCount)
        });
        // Stock of a tracked item booked with no unit record: only a quantity
        // can be counted.
        const noUnitRecord = !line.trackedEntityId && !line.readableId;
        // A unit counted in 2 bins moved between them.
        const moved = line.otherBinName
          ? state === "Missing"
            ? t`Moved to ${line.otherBinName}`
            : state === "Unexpected"
              ? t`Moved from ${line.otherBinName}`
              : null
          : null;
        return (
          <UnitRow
            key={line.id}
            isInvalid={invalidLineIds?.includes(line.id ?? "")}
            number={
              line.readableId ??
              line.assignedReadableId ?? (
                <span className="font-sans text-muted-foreground">
                  {noUnitRecord
                    ? t`Stock with no unit record`
                    : isSerial
                      ? t`No serial number`
                      : t`No batch number`}
                </span>
              )
            }
            expected={
              hideSystemQuantity ? null : Number(line.systemQuantity ?? 0)
            }
            counted={
              isSerial && !noUnitRecord ? (
                <FoundOrMissing
                  lineId={line.id!}
                  value={
                    line.countedQuantity === null
                      ? null
                      : Number(line.countedQuantity)
                  }
                  isReadOnly={isReadOnly}
                />
              ) : (
                <CountedQuantity
                  lineId={line.id!}
                  value={
                    line.countedQuantity === null
                      ? null
                      : Number(line.countedQuantity)
                  }
                  isReadOnly={isReadOnly}
                />
              )
            }
            state={
              moved ? (
                <Badge variant="purple">{moved}</Badge>
              ) : (
                <Badge variant={STATE_BADGE[state]}>{stateLabels[state]}</Badge>
              )
            }
            action={
              !isReadOnly && line.foundDuringCount ? (
                <RemoveUnit
                  inventoryCountId={inventoryCountId}
                  lineId={line.id!}
                />
              ) : null
            }
          />
        );
      })}

      {unnumbered.length > 0 && (
        <UnnumberedUnits
          inventoryCountId={inventoryCountId}
          group={group}
          lines={unnumbered}
          hideSystemQuantity={hideSystemQuantity}
          isReadOnly={isReadOnly}
        />
      )}

      {!isReadOnly && (
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<LuPlus />}
          className="mt-1"
          onClick={() => setIsAdding(true)}
        >
          {isSerial ? t`Add a unit found here` : t`Add a batch found here`}
        </Button>
      )}
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
    </div>
  );
};

function UnitRow({
  number,
  expected,
  counted,
  state,
  action,
  isInvalid
}: {
  number: ReactNode;
  expected: number | null;
  counted: ReactNode;
  state: ReactNode;
  action: ReactNode;
  isInvalid?: boolean;
}) {
  return (
    <div
      className={cn(
        ROW,
        "border-b border-border/50 py-1.5",
        isInvalid && "bg-destructive/20"
      )}
    >
      <span className="truncate font-mono text-xs">{number}</span>
      <span className="text-right tabular-nums text-muted-foreground">
        {expected ?? ""}
      </span>
      <div>{counted}</div>
      <div>{state}</div>
      <div>{action}</div>
    </div>
  );
}

// Units with no serial number: one row with how many are on the shelf, then
// a serial number input for each one found.
function UnnumberedUnits({
  inventoryCountId,
  group,
  lines,
  hideSystemQuantity,
  isReadOnly
}: {
  inventoryCountId: string;
  group: InventoryCountGroup;
  lines: InventoryCountLine[];
  hideSystemQuantity: boolean;
  isReadOnly: boolean;
}) {
  const { t } = useLingui();
  const fetcher = useAction();
  const counted = lines.some((line) => line.countedQuantity !== null)
    ? lines.filter((line) => Number(line.countedQuantity) > 0).length
    : null;
  const found = lines.filter((line) => Number(line.countedQuantity) > 0);
  const missing = counted === null ? 0 : lines.length - counted;

  const save = (quantity: number | null) => {
    if (quantity === null || quantity === counted) return;
    const formData = new FormData();
    formData.set("itemId", group.itemId!);
    formData.set("storageUnitId", group.storageUnitId ?? "");
    formData.set("quantity", String(quantity));
    fetcher.submit(formData, {
      method: "post",
      action: path.to.inventoryCountUnnumbered(inventoryCountId)
    });
  };

  return (
    <>
      <UnitRow
        number={
          <span className="font-sans text-muted-foreground">
            {t`Units with no serial number`}
          </span>
        }
        expected={hideSystemQuantity ? null : lines.length}
        counted={
          isReadOnly ? (
            <span className="tabular-nums">{counted ?? "—"}</span>
          ) : (
            <QuantityInput
              label={t`Units with no serial number on the shelf`}
              value={counted}
              maxValue={hideSystemQuantity ? undefined : lines.length}
              isPending={fetcher.state !== "idle"}
              onCommit={save}
            />
          )
        }
        state={
          counted === null ? (
            <Badge variant="gray">{t`Not counted`}</Badge>
          ) : missing > 0 ? (
            <Badge variant="red">{t`${missing} missing`}</Badge>
          ) : (
            <Badge variant="green">{t`Found`}</Badge>
          )
        }
        action={null}
      />
      {found.length > 0 && (
        <div className="flex flex-col gap-1 py-2 pl-4">
          <p className="text-xs text-muted-foreground">
            {t`Read a serial number off a unit to record it. Optional.`}
          </p>
          <div className="flex flex-wrap gap-2">
            {found.map((line, index) => (
              <AssignSerial
                key={line.id}
                inventoryCountId={inventoryCountId}
                lineId={line.id!}
                value={line.assignedReadableId ?? ""}
                label={t`Unit ${index + 1}`}
                isReadOnly={isReadOnly}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// A serial unit is either on the shelf or not.
function FoundOrMissing({
  lineId,
  value,
  isReadOnly
}: {
  lineId: string;
  value: number | null;
  isReadOnly: boolean;
}) {
  const { t } = useLingui();
  const fetcher = useAction();
  const pending = fetcher.formData?.get("countedQuantity");
  if (isReadOnly) {
    return <span className="tabular-nums">{value ?? "—"}</span>;
  }
  const current =
    pending !== undefined && pending !== null ? String(pending) : value;
  const selected =
    current === null ? "" : Number(current) > 0 ? "found" : "missing";

  const save = (next: string) => {
    const formData = new FormData();
    formData.set("id", lineId);
    formData.set(
      "countedQuantity",
      next === "found" ? "1" : next === "missing" ? "0" : ""
    );
    fetcher.submit(formData, {
      method: "post",
      action: path.to.inventoryCountLineUpdate
    });
  };

  return (
    <ToggleGroup
      type="single"
      size="sm"
      variant="outline"
      value={selected}
      disabled={isReadOnly || fetcher.state !== "idle"}
      onValueChange={save}
      className="justify-start gap-1"
    >
      <ToggleGroupItem value="found" className="h-7 px-2 text-xs">
        {t`Found`}
      </ToggleGroupItem>
      <ToggleGroupItem value="missing" className="h-7 px-2 text-xs">
        {t`Missing`}
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

// A batch's counted quantity.
function CountedQuantity({
  lineId,
  value,
  isReadOnly
}: {
  lineId: string;
  value: number | null;
  isReadOnly: boolean;
}) {
  const { t } = useLingui();
  const fetcher = useAction();
  if (isReadOnly) {
    return <span className="tabular-nums">{value ?? "—"}</span>;
  }
  return (
    <QuantityInput
      label={t`Counted`}
      value={value}
      isPending={fetcher.state !== "idle"}
      onCommit={(next) => {
        const formData = new FormData();
        formData.set("id", lineId);
        formData.set("countedQuantity", next === null ? "" : String(next));
        fetcher.submit(formData, {
          method: "post",
          action: path.to.inventoryCountLineUpdate
        });
      }}
    />
  );
}

// react-aria commits a number field on blur or Enter, and only then calls
// `onChange`: save from there.
function QuantityInput({
  label,
  value,
  maxValue,
  isPending,
  onCommit
}: {
  label: string;
  value: number | null;
  maxValue?: number;
  isPending: boolean;
  onCommit: (value: number | null) => void;
}) {
  return (
    <NumberField
      aria-label={label}
      className="w-24"
      minValue={0}
      maxValue={maxValue}
      defaultValue={value ?? undefined}
      onChange={(next) => {
        const committed = Number.isFinite(next) ? next : null;
        if (committed !== value) onCommit(committed);
      }}
      isDisabled={isPending}
    >
      <NumberInput size="sm" className="text-right" />
    </NumberField>
  );
}

function RemoveUnit({
  inventoryCountId,
  lineId
}: {
  inventoryCountId: string;
  lineId: string;
}) {
  const { t } = useLingui();
  const fetcher = useAction();
  return (
    <IconButton
      aria-label={t`Remove unit`}
      icon={<LuTrash />}
      variant="ghost"
      size="sm"
      isDisabled={fetcher.state !== "idle"}
      onClick={() =>
        fetcher.submit(null, {
          method: "post",
          action: path.to.inventoryCountUnitDelete(inventoryCountId, lineId)
        })
      }
    />
  );
}

// A serial number for one counted unit that has none. The post writes it.
function AssignSerial({
  inventoryCountId,
  lineId,
  value,
  label,
  isReadOnly
}: {
  inventoryCountId: string;
  lineId: string;
  value: string;
  label: string;
  isReadOnly: boolean;
}) {
  const fetcher = useAction();
  const [draft, setDraft] = useState(value);

  if (isReadOnly) {
    return value ? <span className="font-mono text-xs">{value}</span> : null;
  }

  return (
    <Input
      size="sm"
      className="w-40 font-mono text-xs"
      value={draft}
      placeholder={label}
      aria-label={label}
      disabled={fetcher.state !== "idle"}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const next = draft.trim();
        if (!next || next === value) return;
        const formData = new FormData();
        formData.set("lineId", lineId);
        formData.set("readableId", next);
        fetcher.submit(formData, {
          method: "post",
          action: path.to.inventoryCountSerial(inventoryCountId)
        });
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

export default InventoryCountGroupUnits;
