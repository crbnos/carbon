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
  Td,
  ToggleGroup,
  ToggleGroupItem,
  Tr
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { type CSSProperties, type ReactNode, useState } from "react";
import { LuCornerDownRight, LuPlus, LuTrash } from "react-icons/lu";
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

type GroupLine = InventoryCountLine & { otherBinName?: string | null };
type GroupLinesLoader = { lines: GroupLine[] };
type Column = { id: string; style: CSSProperties };

const STATE_BADGE = {
  Found: "green",
  Missing: "red",
  Unexpected: "blue",
  "Not counted": "gray"
} as const;

type InventoryCountGroupUnitsProps = {
  inventoryCountId: string;
  group: InventoryCountGroup;
  // The table's visible columns, so each unit lines up under them.
  columns: Column[];
  hideSystemQuantity: boolean;
  isReadOnly: boolean;
  invalidLineIds?: string[];
};

// The units of one count group, as rows of the count table under their
// group: the number under Item, the state under Units, then Expected,
// Counted and Variance. A serial is marked Found or Missing; a batch takes a
// quantity. Units with no serial number are counted together.
const InventoryCountGroupUnits = ({
  inventoryCountId,
  group,
  columns,
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
      <WideRow columns={columns}>
        <Skeleton className="h-5 w-64" />
      </WideRow>
    );
  }

  const lines = data?.lines ?? [];
  // A serial unit with no number cannot be told apart from the others.
  const unnumbered = lines.filter(
    (line) => isSerial && line.isUnnumbered && !line.foundDuringCount
  );
  const listed = lines.filter((line) => !unnumbered.includes(line));

  return (
    <>
      {listed.length === 0 && unnumbered.length === 0 && (
        <WideRow columns={columns}>
          <span className="text-muted-foreground">
            {hideSystemQuantity
              ? t`No units counted yet. Scan a unit to count it.`
              : t`No units in this storage unit.`}
          </span>
        </WideRow>
      )}

      {listed.map((line) => {
        const counted =
          line.countedQuantity === null ? null : Number(line.countedQuantity);
        const expected = Number(line.systemQuantity ?? 0);
        const state = inventoryCountLineState({
          countedQuantity: counted,
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
            columns={columns}
            isReadOnly={isReadOnly}
            isInvalid={invalidLineIds?.includes(line.id ?? "")}
            cells={{
              item: (
                <UnitName
                  name={
                    line.readableId ??
                    line.assignedReadableId ??
                    (noUnitRecord
                      ? t`Stock with no unit record`
                      : isSerial
                        ? t`No serial number`
                        : t`No batch number`)
                  }
                  isNumber={Boolean(line.readableId ?? line.assignedReadableId)}
                  action={
                    !isReadOnly && line.foundDuringCount ? (
                      <RemoveUnit
                        inventoryCountId={inventoryCountId}
                        lineId={line.id!}
                      />
                    ) : null
                  }
                />
              ),
              units: moved ? (
                <Badge variant="purple">{moved}</Badge>
              ) : (
                <Badge variant={STATE_BADGE[state]}>{stateLabels[state]}</Badge>
              ),
              expectedQuantity: hideSystemQuantity ? null : expected,
              countedQuantity:
                isSerial && !noUnitRecord ? (
                  <FoundOrMissing
                    lineId={line.id!}
                    value={counted}
                    isReadOnly={isReadOnly}
                  />
                ) : (
                  <CountedQuantity
                    lineId={line.id!}
                    value={counted}
                    isReadOnly={isReadOnly}
                  />
                ),
              variance:
                hideSystemQuantity || counted === null ? null : (
                  <Variance value={counted - expected} />
                )
            }}
          />
        );
      })}

      {unnumbered.length > 0 && (
        <UnnumberedUnits
          inventoryCountId={inventoryCountId}
          group={group}
          columns={columns}
          lines={unnumbered}
          hideSystemQuantity={hideSystemQuantity}
          isReadOnly={isReadOnly}
        />
      )}

      {!isReadOnly && (
        <WideRow columns={columns}>
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<LuPlus />}
            onClick={() => setIsAdding(true)}
          >
            {isSerial ? t`Add a unit found here` : t`Add a batch found here`}
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
        </WideRow>
      )}
    </>
  );
};

// A unit row: one cell per visible column, styled as the table's own cells.
// Columns with nothing for a unit stay empty.
function UnitRow({
  columns,
  cells,
  isReadOnly,
  isInvalid
}: {
  columns: Column[];
  cells: Partial<Record<string, ReactNode>>;
  isReadOnly: boolean;
  isInvalid?: boolean;
}) {
  return (
    <Tr
      className={cn(
        "border-b border-border bg-muted/30 transition-colors",
        isInvalid && "bg-destructive/20"
      )}
    >
      {columns.map((column) => (
        <Td
          key={column.id}
          style={column.style}
          className={cn(
            "h-11 whitespace-nowrap px-4 py-2 text-sm",
            !isReadOnly && "border-r border-border",
            column.style.position === "sticky" && "bg-card"
          )}
        >
          {cells[column.id] ?? null}
        </Td>
      ))}
    </Tr>
  );
}

// A row with one cell across the table, for messages and actions. Its content
// starts where the Item column's content does.
function WideRow({
  columns,
  children
}: {
  columns: Column[];
  children: ReactNode;
}) {
  const lead = columns.findIndex((column) => column.id === "item");
  return (
    <Tr className="border-b border-border bg-muted/30">
      {lead > 0 && <Td colSpan={lead} className="h-11 px-4 py-2" />}
      <Td
        colSpan={columns.length - Math.max(lead, 0)}
        className="h-11 px-4 py-2 text-sm"
      >
        <div className="pl-6">{children}</div>
      </Td>
    </Tr>
  );
}

function UnitName({
  name,
  isNumber,
  action
}: {
  name: string;
  isNumber: boolean;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 pl-6">
      <LuCornerDownRight className="size-3.5 shrink-0 text-muted-foreground" />
      <span
        className={cn(
          "truncate",
          isNumber ? "font-mono text-xs" : "text-muted-foreground"
        )}
      >
        {name}
      </span>
      {action}
    </div>
  );
}

function Variance({ value }: { value: number }) {
  if (value === 0) return <span className="tabular-nums">0</span>;
  return (
    <Badge variant={value < 0 ? "destructive" : "green"}>
      {value > 0 ? `+${value}` : value}
    </Badge>
  );
}

// Units with no serial number: one row with how many are on the shelf, then
// one row per unit found, where its serial number can be recorded.
function UnnumberedUnits({
  inventoryCountId,
  group,
  columns,
  lines,
  hideSystemQuantity,
  isReadOnly
}: {
  inventoryCountId: string;
  group: InventoryCountGroup;
  columns: Column[];
  lines: GroupLine[];
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
        columns={columns}
        isReadOnly={isReadOnly}
        cells={{
          item: (
            <UnitName name={t`Units with no serial number`} isNumber={false} />
          ),
          units:
            counted === null ? (
              <Badge variant="gray">{t`Not counted`}</Badge>
            ) : missing > 0 ? (
              <Badge variant="red">{t`${missing} missing`}</Badge>
            ) : (
              <Badge variant="green">{t`Found`}</Badge>
            ),
          expectedQuantity: hideSystemQuantity ? null : lines.length,
          countedQuantity: isReadOnly ? (
            <span className="tabular-nums">{counted ?? "—"}</span>
          ) : (
            <QuantityInput
              label={t`Units with no serial number on the shelf`}
              value={counted}
              maxValue={hideSystemQuantity ? undefined : lines.length}
              isPending={fetcher.state !== "idle"}
              onCommit={save}
            />
          ),
          variance:
            hideSystemQuantity || counted === null ? null : (
              <Variance value={counted - lines.length} />
            )
        }}
      />
      {found.map((line, index) => (
        <UnitRow
          key={line.id}
          columns={columns}
          isReadOnly={isReadOnly}
          cells={{
            item: (
              <div className="flex items-center gap-2 pl-12">
                <AssignSerial
                  inventoryCountId={inventoryCountId}
                  lineId={line.id!}
                  value={line.assignedReadableId ?? ""}
                  label={t`Serial number of unit ${index + 1} (optional)`}
                  isReadOnly={isReadOnly}
                />
              </div>
            ),
            units: <Badge variant="green">{t`Found`}</Badge>
          }}
        />
      ))}
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
  if (isReadOnly) {
    return <span className="tabular-nums">{value ?? "—"}</span>;
  }
  const pending = fetcher.formData?.get("countedQuantity");
  const current =
    pending !== undefined && pending !== null ? String(pending) : value;
  const selected =
    current === null || current === ""
      ? ""
      : Number(current) > 0
        ? "found"
        : "missing";

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
      disabled={fetcher.state !== "idle"}
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
      <NumberInput size="sm" className="h-7 text-right" />
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
      className="h-7 w-56 font-mono text-xs"
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
