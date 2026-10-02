// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { OperationDetail, OperationMaterial } from "@carbon/mes-core";
import { formatQuantity } from "@carbon/utils/format";
import { useLingui } from "@lingui/react/macro";
import { Barcode, Check } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { toast } from "sonner-native";
import {
  Body,
  Card,
  EmptyState,
  ErrorNote,
  Muted,
  WarningNote
} from "~/components/ui";
import { useThemeColors } from "~/components/useThemeColor";
import { useKeyboardWedge } from "~/features/scan/useKeyboardWedge";
import { IssueSheet } from "./IssueSheet";
import { matchMaterialToScan, parseMaterials } from "./logic";

/**
 * What this operation consumes, and how much of it has been issued.
 *
 * Scanning anywhere on this tab issues the matching material, which is web
 * MES's behaviour and the one that matters most on a floor: the operator is
 * holding the part and a scanner, not looking for a row to tap. A scan that
 * matches nothing says so rather than silently doing nothing — a scanner that
 * appears dead is indistinguishable from a part that is not on the BOM.
 *
 * Make to Order lines are shown but cannot be issued: the job BUILDS them, it
 * does not consume them from stock, and offering an Issue control would invite
 * an operator to pull a sub-assembly off a shelf that the job is making.
 */
export function MaterialsTab({ detail }: { detail: OperationDetail }) {
  const { t, i18n } = useLingui();
  const locale = i18n.locale || "en";
  const colors = useThemeColors();
  const [selected, setSelected] = useState<OperationMaterial | null>(null);

  const { materials, malformed } = useMemo(
    () => parseMaterials(detail.materials),
    [detail.materials]
  );

  // A hidden input a Bluetooth or USB scanner in keyboard mode types into.
  const wedge = useKeyboardWedge({
    enabled: materials.length > 0,
    onScan: (code) => {
      const match = matchMaterialToScan(materials, code);
      if (match) {
        setSelected(match);
        return;
      }
      toast.error(t`${code} is not a material on this operation`);
    }
  });

  if (malformed) {
    return (
      <View className="px-4 py-4">
        <ErrorNote>
          {t`This operation's materials could not be read. Use Carbon MES in a browser to issue them.`}
        </ErrorNote>
      </View>
    );
  }

  if (!materials.length) {
    return (
      <EmptyState
        title={t`No materials`}
        description={t`This operation consumes nothing from stock.`}
      />
    );
  }

  const quantity = (value: number | null | undefined) =>
    formatQuantity(value ?? 0, locale);

  return (
    <>
      {/* Off-screen by its own style; a scanner's keystrokes land here. */}
      <TextInput ref={wedge.ref} {...wedge.props} />

      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-3 px-4 pb-8 pt-2"
      >
        <View className="flex-row items-center gap-2">
          <Barcode size={16} color={colors.mutedForeground} />
          <Muted className="text-sm">{t`Scan a part to issue it.`}</Muted>
        </View>

        {materials.map((material) => {
          const required = material.estimatedQuantity ?? 0;
          const issued = material.quantityIssued ?? 0;
          const complete = issued >= required && required > 0;
          const built = material.methodType === "Make to Order";

          return (
            <Pressable
              key={material.id ?? material.itemId ?? ""}
              onPress={() => (built ? undefined : setSelected(material))}
              disabled={built}
              accessibilityRole="button"
              accessibilityState={{ disabled: built }}
              accessibilityLabel={t`Issue ${material.itemReadableId ?? ""}`}
              accessibilityHint={
                built ? t`This sub-assembly is built by the job.` : undefined
              }
            >
              <Card
                className={`gap-2 ${built ? "opacity-60" : "active:opacity-80"}`}
              >
                <View className="flex-row items-start justify-between gap-3">
                  <View className="flex-1 gap-1">
                    <Body className="font-semibold">
                      {material.itemReadableId ?? t`Unnamed part`}
                    </Body>
                    {material.description ? (
                      <Muted className="text-sm" numberOfLines={2}>
                        {material.description}
                      </Muted>
                    ) : null}
                  </View>
                  {complete ? (
                    <Check size={20} color={colors.foreground} />
                  ) : null}
                </View>

                <View className="flex-row items-end justify-between gap-3">
                  <View className="flex-row items-baseline gap-2">
                    <Body className="text-2xl font-semibold">
                      {quantity(issued)}
                    </Body>
                    <Muted className="text-sm">
                      {t`of ${quantity(required)} ${material.unitOfMeasureCode ?? ""}`}
                    </Muted>
                  </View>
                  {material.storageUnitName ? (
                    <Muted className="text-sm">
                      {material.storageUnitName}
                    </Muted>
                  ) : null}
                </View>

                {built ? (
                  <Muted className="text-sm">{t`Built by this job — not issued from stock.`}</Muted>
                ) : material.substitutedFromItemId ? (
                  // The supersession indicator. An operator picking a part
                  // that is not the one the drawing names needs to know why.
                  <WarningNote>
                    {t`Substituted for ${material.substitutedFromItemId}.`}
                  </WarningNote>
                ) : null}
              </Card>
            </Pressable>
          );
        })}
      </ScrollView>

      {selected ? (
        <IssueSheet
          detail={detail}
          material={selected}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </>
  );
}
