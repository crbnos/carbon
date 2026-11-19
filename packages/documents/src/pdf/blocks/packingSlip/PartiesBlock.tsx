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

/** Ship-To address + Shipment details (date, source doc, customer PO, tracking). */
export function PartiesBlock({
  block,
  data
}: {
  block: DocumentBlock;
  data: PackingSlipData;
}) {
  const tw = useTw();
  const t = makeText(packingSlipTexts.parties, block, data.vars);
  const { row } = useTextRows(t);

  return (
    <View style={tw("border border-gray-200 mb-4")}>
      <View style={tw("flex flex-row")}>
        <View style={tw("w-1/2 p-3 border-r border-gray-200")}>
          <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
            {t("shipTo")}
          </Text>
          <View style={tw("text-[10px] text-gray-800")}>
            {t.prints("customerName") ? (
              <Text style={tw("font-bold")}>{t("customerName")}</Text>
            ) : null}
            {t.prints("customerAddressLine1") ? (
              <Text style={tw("mt-1")}>{t("customerAddressLine1")}</Text>
            ) : null}
            {row("customerAddressLine2")}
            {row("customerCity")}
            {row("customerStatePostal")}
            {row("customerCountry")}
          </View>
        </View>
        <View style={tw("w-1/2 p-3")}>
          <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
            {t("shipmentDetails")}
          </Text>
          <View style={tw("text-[10px] text-gray-800")}>
            {row("date")}
            {row("sourceDocument")}
            {row(
              data.documentType === "receivingReport"
                ? "contractNumber"
                : "customerPoNumber"
            )}
            {row("tracking")}
          </View>
        </View>
      </View>
    </View>
  );
}
