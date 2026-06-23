"use client";

import { useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import {
  LuCheck,
  LuList,
  LuQrCode,
  LuTriangleAlert,
  LuX
} from "react-icons/lu";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Combobox } from "./Combobox";
import { HStack } from "./HStack";
import { Input, InputGroup, InputRightElement } from "./Input";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle
} from "./Modal";
import { ScrollArea } from "./ScrollArea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./Tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "./Tooltip";
import { cn } from "./utils/cn";
import { VStack } from "./VStack";

/** One available tracked entity (lot), from `get_available_tracked_entities`. */
export type TrackedEntityOption = {
  trackedEntityId: string;
  readableId: string | null;
  storageUnitId?: string | null;
  storageUnitName?: string | null;
  availableQuantity: number;
  /** ISO date string (YYYY-MM-DD) or null. */
  expirationDate?: string | null;
  createdAt?: string | null;
};

// Values match the `pickMethodSortMethod` DB enum so a stored pick order can be
// passed straight to `defaultOrder` with no translation. "Default" = the smart
// order (expiring soonest first, then oldest).
export type TrackedEntityPickOrder = "Default" | "FEFO" | "FIFO" | "LIFO";

/**
 * Pick-order options (value + translated label), shared by the picker's order
 * dropdown and the item's pick-method form so the two can never drift.
 */
export function usePickOrderOptions(): {
  value: TrackedEntityPickOrder;
  label: string;
}[] {
  const { t } = useLingui();
  return useMemo(
    () => [
      { value: "Default", label: t`Default` },
      { value: "FEFO", label: t`Expiring first` },
      { value: "FIFO", label: t`Oldest first` },
      { value: "LIFO", label: t`Newest first` }
    ],
    [t]
  );
}

export type TrackedEntitySelection = {
  trackedEntityId: string;
  quantity: number;
  /** The bin the lot was picked from (post-picking `fromStorageUnitId`). */
  storageUnitId?: string | null;
};

export type ExpiredEntityPolicy = "Warn" | "Block" | "BlockWithOverride";

export type TrackedEntityPickerProps = {
  /** Serial = qty 1 per lot; Batch = pick a partial quantity. */
  trackingType: "Serial" | "Batch";
  /** Control size: ERP passes "md" (default); MES passes "lg" (touch UI). */
  size?: "md" | "lg";
  /** Available lots (already scoped/deduped by the caller). */
  entities: TrackedEntityOption[];
  /** Quantity still needed (used to default batch qty + highlight). */
  quantityRequired?: number;
  title?: string;
  description?: string;
  nearExpiryWarningDays?: number;
  expiredEntityPolicy?: ExpiredEntityPolicy;
  defaultOrder?: TrackedEntityPickOrder;
  /** Called when the picker confirms a lot. The host posts the pick. */
  onSelect: (selection: TrackedEntitySelection) => void;
  onClose: () => void;
};

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function expiryState(
  expirationDate: string | null | undefined,
  nearExpiryWarningDays: number
): "expired" | "near" | "ok" | "none" {
  if (!expirationDate) return "none";
  const exp = new Date(expirationDate).getTime();
  const today = startOfToday();
  if (exp < today) return "expired";
  const near = today + nearExpiryWarningDays * 24 * 60 * 60 * 1000;
  if (exp <= near) return "near";
  return "ok";
}

function sortEntities(
  entities: TrackedEntityOption[],
  order: TrackedEntityPickOrder
): TrackedEntityOption[] {
  const byExpiry = (a: TrackedEntityOption, b: TrackedEntityOption) => {
    // nulls last
    if (!a.expirationDate && !b.expirationDate) return 0;
    if (!a.expirationDate) return 1;
    if (!b.expirationDate) return -1;
    return a.expirationDate.localeCompare(b.expirationDate);
  };
  const byCreated =
    (dir: 1 | -1) => (a: TrackedEntityOption, b: TrackedEntityOption) =>
      dir * (a.createdAt ?? "").localeCompare(b.createdAt ?? "");

  const copy = [...entities];
  switch (order) {
    case "FEFO":
      return copy.sort((a, b) => byExpiry(a, b) || byCreated(1)(a, b));
    case "FIFO":
      return copy.sort(byCreated(1));
    case "LIFO":
      return copy.sort(byCreated(-1));
    default:
      // Default: expiring soonest first, then oldest first
      return copy.sort((a, b) => byExpiry(a, b) || byCreated(1)(a, b));
  }
}

export function TrackedEntityPicker({
  trackingType,
  entities,
  quantityRequired,
  title,
  description,
  size = "md",
  nearExpiryWarningDays = 0,
  expiredEntityPolicy = "Warn",
  defaultOrder = "Default",
  onSelect,
  onClose
}: TrackedEntityPickerProps) {
  const { t } = useLingui();
  const [activeTab, setActiveTab] = useState("scan");
  const [order, setOrder] = useState<TrackedEntityPickOrder>(defaultOrder);
  const [scan, setScan] = useState("");

  // Hosts open the picker and fetch its data in parallel, so `defaultOrder`
  // arrives a render after mount (undefined -> the item's configured order).
  // Re-sync the selection when it changes so the stored pick order wins over
  // the "Default" fallback. A subsequent user override sticks because
  // `defaultOrder` is then stable.
  const [appliedDefaultOrder, setAppliedDefaultOrder] = useState(defaultOrder);
  if (defaultOrder !== appliedDefaultOrder) {
    setAppliedDefaultOrder(defaultOrder);
    setOrder(defaultOrder);
  }

  const orderOptions = usePickOrderOptions();

  const ordered = useMemo(
    () => sortEntities(entities, order),
    [entities, order]
  );

  const matchScan = (value: string) =>
    entities.find((e) => e.trackedEntityId === value || e.readableId === value);

  const isBlocked = (e: TrackedEntityOption) =>
    expiredEntityPolicy === "Block" &&
    expiryState(e.expirationDate, nearExpiryWarningDays) === "expired";

  const pickQuantity = (e: TrackedEntityOption) =>
    trackingType === "Serial"
      ? 1
      : Math.max(
          0,
          Math.min(quantityRequired ?? e.availableQuantity, e.availableQuantity)
        );

  const confirm = (e: TrackedEntityOption) => {
    if (isBlocked(e)) return;
    onSelect({
      trackedEntityId: e.trackedEntityId,
      quantity: pickQuantity(e),
      storageUnitId: e.storageUnitId ?? null
    });
  };

  const scanMatch = scan ? matchScan(scan) : undefined;

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>{title ?? t`Pick tracked item`}</ModalTitle>
          {description && <ModalDescription>{description}</ModalDescription>}
        </ModalHeader>
        <ModalBody>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-2 mb-4">
              <TabsTrigger value="scan" className="leading-none">
                <LuQrCode className="mr-2 shrink-0" />
                {t`Scan`}
              </TabsTrigger>
              <TabsTrigger value="select" className="leading-none">
                <LuList className="mr-2 shrink-0" />
                {t`Select`}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="scan" className="mt-2">
              <VStack spacing={4}>
                <InputGroup>
                  <Input
                    autoFocus
                    size={size}
                    placeholder={t`Scan or enter tracking number`}
                    value={scan}
                    onChange={(e) => setScan(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const match = matchScan(e.currentTarget.value);
                        if (match) {
                          confirm(match);
                          setScan("");
                        }
                      }
                    }}
                  />
                  <InputRightElement>
                    {scan &&
                      (scanMatch ? (
                        <LuCheck className="text-emerald-500" />
                      ) : (
                        <LuX className="text-red-500" />
                      ))}
                  </InputRightElement>
                </InputGroup>
                {scanMatch && isBlocked(scanMatch) && (
                  <p className="text-sm text-red-600">
                    {t`This lot is expired and can't be picked.`}
                  </p>
                )}
              </VStack>
            </TabsContent>

            <TabsContent value="select" className="mt-2">
              <VStack spacing={3} className="w-full">
                <div className="w-full">
                  <Combobox
                    asButton
                    size={size}
                    value={order}
                    options={orderOptions}
                    onChange={(value) =>
                      setOrder((value as TrackedEntityPickOrder) ?? "Default")
                    }
                  />
                </div>
                <ScrollArea className="max-h-[44dvh] w-full">
                  <VStack spacing={2} className="w-full">
                    {ordered.length === 0 ? (
                      <p className="w-full text-center text-muted-foreground text-xs py-6">
                        {t`No available tracked entities found`}
                      </p>
                    ) : (
                      ordered.map((e) => {
                        const exp = expiryState(
                          e.expirationDate,
                          nearExpiryWarningDays
                        );
                        const blocked = isBlocked(e);
                        return (
                          <HStack
                            key={e.trackedEntityId}
                            className={cn(
                              "w-full justify-between p-3 border rounded-lg",
                              blocked && "opacity-50"
                            )}
                          >
                            <VStack spacing={0} className="min-w-0 items-start">
                              <p className="text-base font-medium truncate">
                                {e.readableId ?? e.trackedEntityId}
                              </p>
                              <HStack
                                spacing={2}
                                className="text-xs text-muted-foreground"
                              >
                                <span className="tabular-nums">
                                  {e.availableQuantity} {t`available`}
                                </span>
                                {e.storageUnitName && (
                                  <span>· {e.storageUnitName}</span>
                                )}
                                {e.expirationDate && (
                                  <ExpiryBadge
                                    state={exp}
                                    date={e.expirationDate}
                                  />
                                )}
                              </HStack>
                            </VStack>
                            <Button
                              size={size}
                              variant="secondary"
                              isDisabled={blocked}
                              onClick={() => confirm(e)}
                            >
                              {t`Pick`}
                            </Button>
                          </HStack>
                        );
                      })
                    )}
                  </VStack>
                </ScrollArea>
              </VStack>
            </TabsContent>
          </Tabs>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" size={size} onClick={onClose}>
            {t`Cancel`}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function ExpiryBadge({
  state,
  date
}: {
  state: "expired" | "near" | "ok" | "none";
  date: string;
}) {
  const { t } = useLingui();
  if (state === "expired") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="red" className="gap-1">
            <LuTriangleAlert />
            {t`Expired`}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>{t`Expired ${date}`}</TooltipContent>
      </Tooltip>
    );
  }
  if (state === "near") {
    return (
      <Badge variant="yellow" className="gap-1">
        {t`Expires ${date}`}
      </Badge>
    );
  }
  return <span>{t`Expires ${date}`}</span>;
}

export default TrackedEntityPicker;
