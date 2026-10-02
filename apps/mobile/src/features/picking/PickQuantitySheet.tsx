// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { PickingListLine } from "@carbon/mes-core";
import { formatQuantity } from "@carbon/utils/format";
import { useLingui } from "@lingui/react/macro";
import { forwardRef, useState } from "react";
import { View } from "react-native";
import { toast } from "sonner-native";
import { Sheet, type SheetHandle } from "~/components/BottomSheet";
import { Button, Muted, WarningNote } from "~/components/ui";
import { QuantityInput } from "~/features/operations/QuantityInput";
import { commandMessage, usePickQuantity } from "./commands";
import { parseNonNegativeQuantity } from "./logic";

/**
 * "How many were actually picked?" — the short-pick question, from
 * `apps/mes/app/components/ShortPickModal.tsx`.
 *
 * This is NOT the ordinary pick. Picking what the line asks for is one tap on
 * the row, exactly as it is on the web; this sheet exists for the case the
 * shelf could not fill the line, and the answer it collects is what turns the
 * line's status to Short so the list's Finish can account for it.
 *
 * Zero is a legitimate answer here and the only sheet in the app where it is:
 * the shelf was empty, nothing was picked, and the line should still be
 * answered for rather than left silently owing. Hence
 * `parseNonNegativeQuantity` rather than the operation screen's positive-only
 * parser, and hence the submit button that stays enabled on "0".
 *
 * A failure is a toast with the server's message and the sheet stays open with
 * the typed number still in it — nothing has to be counted again.
 */
export const PickQuantitySheet = forwardRef<
  SheetHandle,
  {
    listId: string;
    line: PickingListLine | null;
    onClose: () => void;
  }
>(function PickQuantitySheet({ listId, line, onClose }, ref) {
  const { t, i18n } = useLingui();
  const locale = i18n.locale || "en";
  const pick = usePickQuantity(listId);

  const toPick = line?.quantityToPick ?? 0;
  const alreadyPicked = line?.quantityPicked ?? 0;
  // Seeded with whatever is already on the line, else the full ask — the
  // kitter is confirming a count, not starting from nothing.
  const [quantity, setQuantity] = useState(
    String(alreadyPicked > 0 ? alreadyPicked : toPick)
  );

  // The sheet is mounted once per screen and re-pointed at whichever line the
  // kitter opened, so the field has to follow the line rather than keep the
  // previous one's count. Done DURING the render, as `TrackedEntityPicker`
  // does it and as React recommends: an effect would paint the previous
  // line's count for a frame, and a kitter who taps the keypad in that frame
  // has it overwritten under them.
  const [appliedLineId, setAppliedLineId] = useState(line?.id ?? null);
  if ((line?.id ?? null) !== appliedLineId) {
    setAppliedLineId(line?.id ?? null);
    setQuantity(String(alreadyPicked > 0 ? alreadyPicked : toPick));
  }

  const value = parseNonNegativeQuantity(quantity);
  const itemName = line?.item?.name ?? line?.item?.readableId ?? "";
  const unit = line?.item?.unitOfMeasureCode ?? null;

  const submit = async () => {
    if (!line || value === null) return;
    try {
      await pick.mutateAsync({
        lineId: line.id,
        quantity: value,
        markShort: true
      });
      onClose();
      toast.success(t`Marked short at ${formatQuantity(value, locale)}`);
    } catch (error) {
      toast.error(commandMessage(error, t`Could not update this line`));
    }
  };

  const tooMany = value !== null && value > toPick;

  return (
    <Sheet ref={ref} title={t`Short pick ${itemName}`}>
      <View className="gap-4 px-2 pt-2">
        <Muted className="text-sm">{t`How many were actually picked?`}</Muted>
        {/*
          The ask is stated here rather than passed to `QuantityInput`'s `max`:
          that prop renders "N remaining", which is true on the operation
          screen's keypad and false here — this line asks for N in total, and
          some of it may already be in the box.
        */}
        <Muted className="text-sm">
          {unit
            ? t`This line asks for ${formatQuantity(toPick, locale)} ${unit}.`
            : t`This line asks for ${formatQuantity(toPick, locale)}.`}
        </Muted>
        <QuantityInput
          label={unit ? t`Picked quantity (${unit})` : t`Picked quantity`}
          value={quantity}
          onChange={setQuantity}
        />
        {/*
          Nothing at all is the commonest short pick and the hardest to type:
          `QuantityInput`'s minus button stops at 1 (it is built for a quantity
          that must be positive), so without this the kitter has to clear the
          field and type a zero one-handed at a rack.
        */}
        <Button variant="secondary" onPress={() => setQuantity("0")}>
          {t`Nothing was picked`}
        </Button>
        {tooMany ? (
          <WarningNote>
            {t`That is more than the ${formatQuantity(
              toPick,
              locale
            )} this line asks for. Pick the line instead of marking it short.`}
          </WarningNote>
        ) : null}
        {/*
          Disabled in place with the reason above, never hidden — and a short
          pick that exceeds the ask is a contradiction, which is why the web's
          modal clamps the field at `quantityToPick`.
        */}
        <Button
          onPress={submit}
          disabled={value === null || tooMany}
          loading={pick.isPending}
        >
          {value === null ? t`Enter a quantity` : t`Mark short`}
        </Button>
      </View>
    </Sheet>
  );
});
