// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { formatDate } from "@carbon/utils";
import { Text, View } from "@react-pdf/renderer";
import {
  type DocumentBlock,
  makeText,
  packingSlipTexts
} from "../../../template";
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
  const {
    customer,
    shippingAddress,
    shipment,
    sourceDocument,
    sourceDocumentId,
    customerReference,
    locale
  } = data;
  const {
    addressLine1,
    addressLine2,
    city,
    stateProvince,
    postalCode,
    countryCode
  } = shippingAddress ?? {};

  return (
    <View style={tw("border border-gray-200 mb-4")}>
      <View style={tw("flex flex-row")}>
        <View style={tw("w-1/2 p-3 border-r border-gray-200")}>
          <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
            {t("shipTo")}
          </Text>
          <View style={tw("text-[10px] text-gray-800")}>
            {customer.name ? (
              <Text style={tw("font-bold")}>{customer.name}</Text>
            ) : null}
            {addressLine1 ? (
              <Text style={tw("mt-1")}>{addressLine1}</Text>
            ) : null}
            {addressLine2 ? <Text>{addressLine2}</Text> : null}
            {city ? <Text>{city}</Text> : null}
            {stateProvince || postalCode ? (
              <Text>
                {[stateProvince, postalCode].filter(Boolean).join(" ")}
              </Text>
            ) : null}
            {countryCode ? <Text>{countryCode}</Text> : null}
          </View>
        </View>
        <View style={tw("w-1/2 p-3")}>
          <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
            {t("shipmentDetails")}
          </Text>
          <View style={tw("text-[10px] text-gray-800")}>
            {t.shows("date") && shipment?.postingDate ? (
              <Text>
                {t("date")}{" "}
                {formatDate(shipment.postingDate, undefined, locale)}
              </Text>
            ) : null}
            {sourceDocument && sourceDocumentId ? (
              <Text>
                {sourceDocument}: {sourceDocumentId}
              </Text>
            ) : null}
            {t.shows("customerPoNumber") && customerReference ? (
              <Text>
                {t("customerPoNumber")} {customerReference}
              </Text>
            ) : null}
            {t.shows("tracking") && shipment?.trackingNumber ? (
              <Text>
                {t("tracking")} {shipment.trackingNumber}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );
}
