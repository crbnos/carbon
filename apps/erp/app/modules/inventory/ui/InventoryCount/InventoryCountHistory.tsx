import {
  Badge,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  HStack,
  VStack
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import { LuMoveDown, LuMoveUp, LuPencil, LuPlus } from "react-icons/lu";
import { EmployeeAvatar, Hyperlink } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useDateFormatter } from "~/hooks";
import { path } from "~/utils/path";
import type { StockMovement } from "../../types";

type InventoryCountHistoryProps = {
  movements: StockMovement[];
  onClose: () => void;
};

// One posting round. Every ledger row written by a single post shares the same
// `createdAt` (Postgres `now()` = transaction_timestamp, constant per txn), so a
// distinct `createdAt` is exactly one post — the original count or a later
// rectification.
type Version = {
  createdAt: string;
  createdBy: string | null;
  movements: StockMovement[];
  isRectification: boolean;
};

// Deep-link to the item's Activity panel with this exact ledger row flashed.
function movementActivityPath(m: StockMovement) {
  const params = new URLSearchParams();
  if (m.itemReadableId) params.set("search", m.itemReadableId);
  if (m.locationId) params.set("location", m.locationId);
  params.set("highlight", m.id ?? "");
  return `${path.to.inventoryItemActivity(m.itemId ?? "")}?${params.toString()}`;
}

// Signed quantity with a direction arrow (NUMERIC arrives as a string).
const QuantityDelta = ({ value }: { value: number | string | null }) => {
  const n = value == null ? 0 : Number(value);
  return (
    <HStack spacing={1} className="font-medium tabular-nums">
      {n >= 0 ? (
        <LuMoveUp className="text-success text-base" />
      ) : (
        <LuMoveDown className="text-red-500 text-base" />
      )}
      <span>{Math.abs(n)}</span>
    </HStack>
  );
};

// Group movements into posting rounds and order them newest-first. The earliest
// round is the original count; every later round is a rectification (it also
// carries `correctionOfItemLedgerId` links back to the rows it fixes).
function toVersions(movements: StockMovement[]): Version[] {
  const byCreatedAt = new Map<string, StockMovement[]>();
  for (const m of movements) {
    const key = m.createdAt ?? "";
    const bucket = byCreatedAt.get(key);
    if (bucket) bucket.push(m);
    else byCreatedAt.set(key, [m]);
  }

  return [...byCreatedAt.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([createdAt, rows], index) => ({
      createdAt,
      createdBy: rows[0]?.createdBy ?? null,
      movements: rows,
      // First round = original post; anything after is a rectification.
      isRectification: index > 0
    }))
    .reverse();
}

const InventoryCountHistory = ({
  movements,
  onClose
}: InventoryCountHistoryProps) => {
  const { t } = useLingui();
  const { formatDateTime } = useDateFormatter();

  const versions = useMemo(() => toVersions(movements), [movements]);
  const rectifications = versions.filter((v) => v.isRectification).length;

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent
        size="xl"
        position="right"
        className="w-max lg:w-max max-w-max min-w-0"
      >
        <DrawerHeader>
          <DrawerTitle>{t`Count History`}</DrawerTitle>
          <DrawerDescription>
            {rectifications === 0
              ? t`Posted once, no rectifications.`
              : rectifications === 1
                ? t`Posted once, rectified 1 time.`
                : t`Posted once, rectified ${rectifications} times.`}
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody>
          <div className="w-full space-y-6">
            {versions.map((version, index) => {
              // versions are newest-first; the rectification number counts up
              // from the oldest, so derive it from the tail distance.
              const rectifyNumber = versions.length - 1 - index;
              return (
                <div key={version.createdAt} className="relative w-full">
                  {/* timeline rail */}
                  {index < versions.length - 1 && (
                    <span className="absolute left-4 top-9 bottom-[-1.5rem] w-px bg-border" />
                  )}

                  <HStack spacing={3} className="mb-3 items-start">
                    <div
                      className={
                        version.isRectification
                          ? "z-10 flex size-8 items-center justify-center rounded-full bg-yellow-100 text-yellow-700 dark:bg-yellow-500/15 dark:text-yellow-500"
                          : "z-10 flex size-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-500"
                      }
                    >
                      {version.isRectification ? (
                        <LuPencil className="size-4" />
                      ) : (
                        <LuPlus className="size-4" />
                      )}
                    </div>
                    <VStack spacing={0} className="min-w-0 flex-1">
                      <HStack className="justify-between">
                        <HStack spacing={2}>
                          <span className="font-semibold text-sm">
                            {version.isRectification
                              ? t`Rectification ${rectifyNumber}`
                              : t`Original Count`}
                          </span>
                          {version.isRectification && (
                            <Badge variant="yellow">{t`Correction`}</Badge>
                          )}
                        </HStack>
                        <span className="whitespace-nowrap text-muted-foreground text-xs tabular-nums">
                          {formatDateTime(version.createdAt)}
                        </span>
                      </HStack>
                      <EmployeeAvatar employeeId={version.createdBy} />
                    </VStack>
                  </HStack>

                  <div className="ml-11 rounded-xl border border-border divide-y divide-border">
                    {version.movements.map((m) => (
                      <div
                        key={m.id}
                        className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 px-4 py-2.5"
                      >
                        <VStack spacing={0} className="min-w-0">
                          <Hyperlink to={movementActivityPath(m)}>
                            {m.itemReadableId}
                          </Hyperlink>
                          {m.itemDescription && (
                            <span className="truncate text-muted-foreground text-xs">
                              {m.itemDescription}
                            </span>
                          )}
                        </VStack>
                        <HStack spacing={3} className="shrink-0">
                          <Enumerable value={m.entryType} />
                          <span className="whitespace-nowrap text-muted-foreground text-xs">
                            {m.storageUnitName ?? "—"}
                          </span>
                        </HStack>
                        <div className="justify-self-end">
                          <QuantityDelta value={m.quantity} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
};

export default InventoryCountHistory;
