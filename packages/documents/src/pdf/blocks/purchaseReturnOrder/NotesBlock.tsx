// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { JSONContent } from "@carbon/react";
import { Text, View } from "@react-pdf/renderer";
import {
  type DocumentBlock,
  makeText,
  purchaseReturnOrderTexts
} from "../../../template";
import { Note } from "../../components";
import { useTw } from "../tw";
import type { PurchaseReturnOrderData } from "./types";

export function NotesBlock({
  block,
  data
}: {
  block: DocumentBlock;
  data: PurchaseReturnOrderData;
}) {
  const tw = useTw();
  const t = makeText(purchaseReturnOrderTexts.notes, block, data.vars);
  const notes = (data.purchaseReturnOrder?.externalNotes ?? {}) as JSONContent;
  const hasNotes = Object.keys(notes).length > 0;

  return (
    <View style={tw("border border-gray-200 mb-4")}>
      <View style={tw("p-3")}>
        <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
          {t("notes")}
        </Text>
        <View style={tw("text-[9px] text-gray-800")}>
          {hasNotes ? (
            <Note content={notes} />
          ) : (
            <Text style={tw("text-gray-400")}>{t("none")}</Text>
          )}
        </View>
      </View>
    </View>
  );
}
