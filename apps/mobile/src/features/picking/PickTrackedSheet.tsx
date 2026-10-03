// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { PickingListLine } from "@carbon/mes-core";
import { formatDate } from "@carbon/utils/date";
import { formatQuantity } from "@carbon/utils/format";
import { getLocalTimeZone, today } from "@internationalized/date";
import { useLingui } from "@lingui/react/macro";
import { Check, TriangleAlert, X } from "lucide-react-native";
import { forwardRef, useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { toast } from "sonner-native";
import { Sheet, type SheetHandle } from "~/components/BottomSheet";
import {
  Body,
  Button,
  ErrorNote,
  Muted,
  Skeleton,
  WarningNote
} from "~/components/ui";
import { useThemeColors } from "~/components/useThemeColor";
import { commandMessage, usePickTracked } from "./commands";
import {
  expiryGate,
  expiryState,
  lotPickQuantity,
  matchLot,
  type PickOrder,
  sortLots,
  type TrackedLot
} from "./logic";
import { usePickingTrackedOptions } from "./usePickingQueries";

/**
 * Choose a serial or batch lot for a tracked line — the tablet's version of
 * `packages/react/src/TrackedEntityPicker.tsx`, with the same two ways in
 * (scan a label, or read down the list) and the same pick order.
 *
 * ## Expiry
 *
 * This is where the company's shelf-life policy has to be visible, because a
 * kitter standing at a rack cannot see it anywhere else. Three policies, three
 * different behaviours, and collapsing any two of them is the mistake:
 *
 *   - **`Warn`** — the lot is pickable. It carries a red "Expired" badge and
 *     the sheet says the company allows it, so the decision is informed rather
 *     than accidental.
 *   - **`Block`** — the lot is NOT pickable, and it stays in the list,
 *     disabled, reading "Expired — this cannot be picked". The web's picker
 *     greys it the same way, and the shop-floor rules forbid hiding it: a
 *     kitter who scans a lot that has silently vanished from the list concludes
 *     the tablet is broken and picks it anyway, by hand, off the paper.
 *   - **`BlockWithOverride`** — pickable only after an explicit confirmation
 *     that names the lot and the date it expired. One tap arms it, a second
 *     commits it.
 *
 * A lot inside `nearExpiryWarningDays` gets an amber "Expires <date>" badge and
 * is never gated. It is exactly the lot FEFO wants used first; refusing it
 * would push the kitter onto fresher stock and leave the old lot to expire.
 *
 * The override confirmation is inline rather than a `ConfirmDialog`, which is
 * the one deliberate departure from the usual pattern: a React Native `Modal`
 * presented from inside a bottom sheet is fragile, and an armed row that names
 * the lot and puts Cancel left of the destructive action satisfies the same
 * rule without stacking two overlays on a gloved thumb. The app records no
 * override REASON, because `pickTrackedBody` has no field for one — the server
 * contract is additive-only and changing it is an Ask First item. The
 * confirmation is what stops a silent pick; the reason stays a web-only
 * affordance for now.
 */

export const PickTrackedSheet = forwardRef<
  SheetHandle,
  {
    listId: string;
    line: PickingListLine | null;
    onClose: () => void;
  }
>(function PickTrackedSheet({ listId, line, onClose }, ref) {
  const { t, i18n } = useLingui();
  const locale = i18n.locale || "en";
  const colors = useThemeColors();
  const options = usePickingTrackedOptions(listId, line?.id ?? null);
  const pick = usePickTracked(listId);

  const [order, setOrder] = useState<PickOrder>("Default");
  const [scan, setScan] = useState("");
  const [arming, setArming] = useState<string | null>(null);

  const data = options.data;
  const serverOrder = data?.defaultOrder;

  // Both of these are "adjust state when a prop changes" and are done DURING
  // the render rather than in an effect, which is the same shape
  // `TrackedEntityPicker` uses (`appliedDefaultOrder`) and what React itself
  // recommends: an effect would paint the stale value once first, so the lot
  // list would visibly re-sort under the kitter's eyes, and the previous
  // line's scanned code would flash in the field for a frame.

  // The sheet opens and its options arrive a render later, so the item's
  // CONFIGURED pick order lands after the "Default" fallback. A later tap by
  // the kitter sticks, because `serverOrder` is then stable.
  const [appliedOrder, setAppliedOrder] = useState<PickOrder | undefined>(
    serverOrder
  );
  if (serverOrder && serverOrder !== appliedOrder) {
    setAppliedOrder(serverOrder);
    setOrder(serverOrder);
  }

  // The sheet is mounted once per screen and re-pointed at whichever line the
  // kitter opened, so a scanned code and an armed override belong to the line
  // that was open and must not carry over to the next one.
  const [appliedLineId, setAppliedLineId] = useState(line?.id ?? null);
  if ((line?.id ?? null) !== appliedLineId) {
    setAppliedLineId(line?.id ?? null);
    setScan("");
    setArming(null);
  }

  // The operator's own day, in their own zone. Not a JS `Date`: an expiration
  // is a bare `YYYY-MM-DD`, and `new Date("2026-10-02")` is UTC midnight,
  // which reads a day early for anyone west of UTC.
  const operatorToday = useMemo(() => today(getLocalTimeZone()), []);

  // The same four labels `usePickOrderOptions` gives the web, built here where
  // `t` comes from `useLingui()` — Lingui's macro only transforms a `t` it can
  // see in scope, so these cannot be moved into a helper that takes `t` as an
  // argument without silently dropping them from the catalog.
  const orderOptions = useMemo(
    () => [
      { value: "Default" as PickOrder, label: t`Default` },
      { value: "FEFO" as PickOrder, label: t`Expiring first` },
      { value: "FIFO" as PickOrder, label: t`Oldest first` },
      { value: "LIFO" as PickOrder, label: t`Newest first` }
    ],
    [t]
  );

  const lots = useMemo(
    () => (data ? sortLots(data.entities, order) : []),
    [data, order]
  );

  const unit = line?.item?.unitOfMeasureCode ?? null;
  const itemName = line?.item?.name ?? line?.item?.readableId ?? "";

  const gateOf = (lot: TrackedLot) =>
    data
      ? expiryGate(
          lot,
          data.expiredEntityPolicy,
          data.nearExpiryWarningDays,
          operatorToday
        )
      : "ok";

  const submit = async (lot: TrackedLot) => {
    if (!line || !data) return;
    if (gateOf(lot) === "blocked") return;
    try {
      await pick.mutateAsync({
        lineId: line.id,
        trackedEntityId: lot.trackedEntityId,
        fromStorageUnitId: lot.storageUnitId ?? undefined,
        quantity: lotPickQuantity(lot, data.trackingType, data.quantityRequired)
      });
      setScan("");
      setArming(null);
      onClose();
      toast.success(t`Picked ${lot.readableId ?? lot.trackedEntityId}`);
    } catch (error) {
      toast.error(commandMessage(error, t`Could not pick that lot`));
    }
  };

  /** One tap on a lot: pick it, arm the override, or refuse it. */
  const choose = (lot: TrackedLot) => {
    const gate = gateOf(lot);
    if (gate === "blocked") return;
    if (gate === "override" && arming !== lot.trackedEntityId) {
      setArming(lot.trackedEntityId);
      return;
    }
    void submit(lot);
  };

  const scanned = scan.trim() ? matchLot(lots, scan) : undefined;
  const scannedGate = scanned ? gateOf(scanned) : "ok";
  const expiredCount = lots.filter(
    (lot) =>
      expiryState(
        lot.expirationDate,
        data?.nearExpiryWarningDays ?? 0,
        operatorToday
      ) === "expired"
  ).length;

  return (
    <Sheet ref={ref} title={t`Pick ${itemName}`}>
      <View className="gap-4 px-2 pt-2">
        {options.isPending ? (
          <View className="gap-3">
            <Skeleton className="h-12" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </View>
        ) : options.isError || !data ? (
          <>
            <ErrorNote>
              {commandMessage(options.error, t`Could not load the lots`)}
            </ErrorNote>
            <Button variant="secondary" onPress={() => options.refetch()}>
              {t`Try again`}
            </Button>
          </>
        ) : (
          <>
            <Muted className="text-sm">
              {unit
                ? t`${formatQuantity(data.quantityRequired, locale)} ${unit} still to pick`
                : t`${formatQuantity(data.quantityRequired, locale)} still to pick`}
            </Muted>

            {/* Scan first: a kitter at a rack reads a label, they do not
                scroll. The field is autofocused so a wedge scanner's keystrokes
                land here with no tap at all. */}
            <View className="gap-2">
              <Muted className="text-sm">{t`Scan the lot label`}</Muted>
              <View className="flex-row items-center gap-2">
                <TextInput
                  value={scan}
                  onChangeText={setScan}
                  autoFocus
                  autoCapitalize="characters"
                  autoCorrect={false}
                  placeholder={t`Scan or enter a lot number`}
                  placeholderTextColor={colors.mutedForeground}
                  accessibilityLabel={t`Scan or enter a lot number`}
                  onSubmitEditing={() => {
                    const match = matchLot(lots, scan);
                    if (match) choose(match);
                  }}
                  className="min-h-[56px] flex-1 rounded-lg border border-input bg-card px-4 text-lg text-foreground"
                />
                {scan.trim() ? (
                  scanned ? (
                    <Check size={28} color={colors.foreground} />
                  ) : (
                    <X size={28} color={colors.destructive} />
                  )
                ) : null}
              </View>
              {scan.trim() && !scanned ? (
                <Muted className="text-sm">{t`No available lot matches that code.`}</Muted>
              ) : null}
              {scanned && scannedGate === "blocked" ? (
                <ErrorNote>{t`That lot is expired and cannot be picked.`}</ErrorNote>
              ) : null}
            </View>

            {/* The company's policy, said once and plainly, only when there is
                expired stock on the shelf for it to be about. */}
            {expiredCount > 0 ? (
              data.expiredEntityPolicy === "Block" ? (
                <ErrorNote>
                  {t`${expiredCount} of these lots are expired. This company does not allow expired stock to be picked.`}
                </ErrorNote>
              ) : (
                <WarningNote>
                  {data.expiredEntityPolicy === "BlockWithOverride"
                    ? t`${expiredCount} of these lots are expired. Picking one needs a second tap to confirm.`
                    : t`${expiredCount} of these lots are expired. This company allows them to be picked.`}
                </WarningNote>
              )
            ) : null}

            <View className="gap-2">
              <Muted className="text-sm">{t`Order`}</Muted>
              <View className="flex-row flex-wrap gap-2">
                {orderOptions.map((option) => (
                  <Pressable
                    key={option.value}
                    onPress={() => setOrder(option.value)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: option.value === order }}
                    accessibilityLabel={option.label}
                    className={`min-h-[48px] justify-center rounded-full border px-4 ${
                      option.value === order
                        ? "border-ring bg-accent"
                        : "border-border bg-card active:opacity-70"
                    }`}
                  >
                    <Body className="text-sm">{option.label}</Body>
                  </Pressable>
                ))}
              </View>
            </View>

            {lots.length === 0 ? (
              <WarningNote>{t`No available lots are on record for this item at this location.`}</WarningNote>
            ) : (
              <View className="gap-2">
                {lots.map((lot) => (
                  <LotRow
                    key={lot.trackedEntityId}
                    lot={lot}
                    unit={unit}
                    locale={locale}
                    state={expiryState(
                      lot.expirationDate,
                      data.nearExpiryWarningDays,
                      operatorToday
                    )}
                    gate={gateOf(lot)}
                    armed={arming === lot.trackedEntityId}
                    pending={pick.isPending}
                    onPress={() => choose(lot)}
                    onCancel={() => setArming(null)}
                  />
                ))}
              </View>
            )}
          </>
        )}
      </View>
    </Sheet>
  );
});

function LotRow({
  lot,
  unit,
  locale,
  state,
  gate,
  armed,
  pending,
  onPress,
  onCancel
}: {
  lot: TrackedLot;
  unit: string | null;
  locale: string;
  state: ReturnType<typeof expiryState>;
  gate: ReturnType<typeof expiryGate>;
  armed: boolean;
  pending: boolean;
  onPress: () => void;
  onCancel: () => void;
}) {
  const { t } = useLingui();
  const colors = useThemeColors();
  const blocked = gate === "blocked";
  const available = lot.availableQuantity ?? 0;
  const expiry = lot.expirationDate
    ? formatDate(lot.expirationDate, undefined, locale)
    : null;

  return (
    <View
      className={`gap-3 rounded-lg border p-3 ${
        blocked ? "border-border opacity-50" : "border-border bg-card"
      }`}
    >
      <Pressable
        onPress={onPress}
        disabled={blocked || pending}
        accessibilityRole="button"
        accessibilityState={{ disabled: blocked || pending }}
        accessibilityLabel={
          blocked
            ? t`${lot.readableId ?? lot.trackedEntityId} is expired and cannot be picked`
            : t`Pick ${lot.readableId ?? lot.trackedEntityId}`
        }
        className="min-h-[48px] flex-row items-center justify-between gap-3"
      >
        <View className="min-w-0 flex-1 gap-1">
          <Body className="font-medium" numberOfLines={1}>
            {lot.readableId ?? lot.trackedEntityId}
          </Body>
          <Muted className="text-sm" numberOfLines={1}>
            {unit
              ? t`${formatQuantity(available, locale)} ${unit} available`
              : t`${formatQuantity(available, locale)} available`}
            {lot.storageUnitName ? ` · ${lot.storageUnitName}` : ""}
          </Muted>
        </View>
        {state === "expired" ? (
          <View className="flex-row items-center gap-1.5">
            <TriangleAlert size={16} color={colors.destructive} />
            <Text className="text-sm font-medium text-red-600 dark:text-red-400">
              {expiry ? t`Expired ${expiry}` : t`Expired`}
            </Text>
          </View>
        ) : state === "near" ? (
          <Text className="text-sm font-medium text-orange-600 dark:text-orange-400">
            {expiry ? t`Expires ${expiry}` : t`Expiring`}
          </Text>
        ) : expiry ? (
          <Muted className="text-sm">{t`Expires ${expiry}`}</Muted>
        ) : null}
      </Pressable>

      {blocked ? (
        <Muted className="text-sm">{t`Expired — this cannot be picked.`}</Muted>
      ) : null}

      {/* Armed override: the lot and its date are named, Cancel sits left of
          the destructive action, and both are full-height targets. */}
      {armed ? (
        <View className="gap-3 rounded-lg bg-muted p-3">
          <Body className="text-sm">
            {expiry
              ? t`This lot expired ${expiry}. Pick it anyway?`
              : t`This lot is expired. Pick it anyway?`}
          </Body>
          <View className="flex-row gap-3">
            <Button variant="secondary" className="flex-1" onPress={onCancel}>
              {t`Cancel`}
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              onPress={onPress}
              loading={pending}
            >
              {t`Pick expired lot`}
            </Button>
          </View>
        </View>
      ) : null}
    </View>
  );
}
