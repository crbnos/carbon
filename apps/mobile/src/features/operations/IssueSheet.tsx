// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { OperationDetail, OperationMaterial } from "@carbon/mes-core";
import { formatQuantity } from "@carbon/utils/format";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { toast } from "sonner-native";
import { Sheet, type SheetHandle } from "~/components/BottomSheet";
import { Body, Button, Muted, WarningNote } from "~/components/ui";
import { commandMessage, useIssueMaterial, useIssueTracked } from "./commands";
import { isTrackedLine, parseQuantity, remainingToIssue } from "./logic";
import { QuantityInput } from "./QuantityInput";

/**
 * Issue one material line.
 *
 * Two different writes behind one sheet, because they are one action to an
 * operator. An untracked part is a quantity and an adjustment type; a
 * serial- or batch-tracked part is a specific ENTITY, and which one it is
 * becomes part of the job's genealogy — so a tracked line cannot be issued by
 * typing a number, and this sheet says so rather than letting one through
 * that the server would refuse.
 *
 * The default quantity is what is left to issue, not 1. An operator issuing
 * the whole remaining requirement is the common case, and making them type it
 * is how a 40 becomes a 4.
 */
export function IssueSheet({
  detail,
  material,
  onClose
}: {
  detail: OperationDetail;
  material: OperationMaterial;
  onClose: () => void;
}) {
  const { t, i18n } = useLingui();
  const locale = i18n.locale || "en";
  const sheet = useRef<SheetHandle>(null);
  const remaining = remainingToIssue(material);
  const [quantity, setQuantity] = useState(
    remaining > 0 ? String(remaining) : "1"
  );
  const issue = useIssueMaterial(detail.operation.id);
  const issueTracked = useIssueTracked(detail.operation.id);
  const tracked = isTrackedLine(material);
  const value = parseQuantity(quantity);

  // The sheet is mounted by the tab only while a material is selected, so it
  // opens itself; dismissing it tells the tab to unmount it.
  useEffect(() => {
    sheet.current?.open();
  }, []);

  const submit = async () => {
    if (!value || !material.itemId) return;
    try {
      if (tracked) {
        // A tracked issue names the entities, and the only one this screen
        // knows is the unit being built. Picking a lot off the shelf needs the
        // picker that the scan path provides, so this is the whole-unit case.
        const entityId = detail.trackedEntityId;
        if (!entityId) {
          toast.error(t`Scan the lot or serial to issue this part`);
          return;
        }
        await issueTracked.mutateAsync({
          itemId: material.itemId,
          materialId: material.id ?? undefined,
          children: [{ trackedEntityId: entityId, quantity: value }]
        });
      } else {
        await issue.mutateAsync({
          itemId: material.itemId,
          materialId: material.id ?? undefined,
          quantity: value,
          // Positive Adjmt. ADDS to what is already issued, which is what an
          // operator means by "issue two more". Set Quantity would replace the
          // running total and quietly undo an earlier issue.
          adjustmentType: "Positive Adjmt."
        });
      }
      onClose();
      toast.success(
        t`Issued ${formatQuantity(value, locale)} ${material.itemReadableId ?? ""}`
      );
    } catch (error) {
      // A `blocked` 409 carries the rule that refused it; a warning the server
      // raised on a first attempt can be re-sent acknowledged, which the web
      // does with a confirm. Here the operator reads the reason and decides.
      toast.error(commandMessage(error, t`Could not issue that material`));
    }
  };

  const pending = issue.isPending || issueTracked.isPending;

  return (
    <Sheet ref={sheet} title={material.itemReadableId ?? t`Issue material`}>
      <View className="gap-4 px-2 pt-2">
        {material.description ? (
          <Muted className="text-sm">{material.description}</Muted>
        ) : null}

        <View className="flex-row items-baseline gap-2">
          <Body className="text-xl font-semibold">
            {formatQuantity(material.quantityIssued ?? 0, locale)}
          </Body>
          <Muted className="text-sm">
            {t`of ${formatQuantity(material.estimatedQuantity ?? 0, locale)} issued`}
          </Muted>
        </View>

        {tracked && !detail.trackedEntityId ? (
          <WarningNote>
            {t`This part is tracked. Scan its lot or serial label to issue it.`}
          </WarningNote>
        ) : null}

        <QuantityInput
          label={t`How many are you issuing?`}
          value={quantity}
          onChange={setQuantity}
          max={remaining > 0 ? remaining : undefined}
        />

        <Button
          onPress={submit}
          disabled={!value || (tracked && !detail.trackedEntityId)}
          loading={pending}
        >
          {value
            ? t`Issue ${formatQuantity(value, locale)}`
            : t`Enter a quantity`}
        </Button>
        <Button variant="ghost" onPress={onClose} disabled={pending}>
          {t`Cancel`}
        </Button>
      </View>
    </Sheet>
  );
}
