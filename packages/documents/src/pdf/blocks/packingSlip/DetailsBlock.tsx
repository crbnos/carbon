// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Text, View } from "@react-pdf/renderer";
import {
  type DocumentBlock,
  makeText,
  packingSlipTexts
} from "../../../template";
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
  const { shippingMethod, paymentTerm } = data;

  return (
    <View style={tw("border border-gray-200 mb-4")}>
      <View style={tw("flex flex-row")}>
        <View style={tw("w-1/2 p-3 border-r border-gray-200")}>
          <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
            {t("shipping")}
          </Text>
          <View style={tw("text-[10px] text-gray-800")}>
            {t.shows("method") && shippingMethod?.name ? (
              <Text>
                {t("method")} {shippingMethod.name}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={tw("w-1/2 p-3")}>
          <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
            {t("payment")}
          </Text>
          <View style={tw("text-[10px] text-gray-800")}>
            {t.shows("terms") && paymentTerm?.name ? (
              <Text>
                {t("terms")} {paymentTerm.name}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );
}
