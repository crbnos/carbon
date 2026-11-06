// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Text, View } from "@react-pdf/renderer";
import {
  type DocumentBlock,
  makeText,
  packingSlipTexts
} from "../../../template";
import { useTextRows } from "../textRows";
import { useTw } from "../tw";
import type { PackingSlipData } from "./types";

/** Shipping method + Payment terms box. */
export function DetailsBlock({
  block,
  data
}: {
  block: DocumentBlock;
  data: PackingSlipData;
}) {
  const tw = useTw();
  const t = makeText(packingSlipTexts.details, block, data.vars);
  const { row } = useTextRows(t);

  return (
    <View style={tw("border border-gray-200 mb-4")}>
      <View style={tw("flex flex-row")}>
        <View style={tw("w-1/2 p-3 border-r border-gray-200")}>
          <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
            {t("shipping")}
          </Text>
          <View style={tw("text-[10px] text-gray-800")}>{row("method")}</View>
        </View>
        <View style={tw("w-1/2 p-3")}>
          <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
            {t("payment")}
          </Text>
          <View style={tw("text-[10px] text-gray-800")}>{row("terms")}</View>
        </View>
      </View>
    </View>
  );
}
