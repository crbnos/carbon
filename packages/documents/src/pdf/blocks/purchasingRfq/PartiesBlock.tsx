// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { formatDate } from "@carbon/utils";
import { Text, View } from "@react-pdf/renderer";
import { getCountryName } from "../../../utils/shared";
import { AddressBlock } from "../../components";
import { useTw } from "../tw";
import type { PurchasingRfqAddress, PurchasingRfqData } from "./types";

function resolveCountry(address?: PurchasingRfqAddress | null): string {
  if (!address) return "";
  return address.country ?? getCountryName(address.countryCode);
}

export function PartiesBlock({ data }: { data: PurchasingRfqData }) {
  const tw = useTw();
  const { purchasingRfq, shipToAddress, locale } = data;

  return (
    <View style={tw("border border-gray-200 mb-4")}>
      <View style={tw("flex flex-row")}>
        {/* LEFT — the receiving location the supplier quotes delivery to */}
        <View style={tw("w-1/2 p-3 border-r border-gray-200")}>
          <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
            Ship To
          </Text>
          <View style={tw("text-[9px] text-gray-800")}>
            <AddressBlock
              name={data.company?.name}
              addressLine1={shipToAddress?.addressLine1}
              addressLine2={shipToAddress?.addressLine2}
              city={shipToAddress?.city}
              stateProvince={shipToAddress?.stateProvince}
              postalCode={shipToAddress?.postalCode}
              country={resolveCountry(shipToAddress)}
            />
          </View>
        </View>

        {/* RIGHT — request details */}
        <View style={tw("w-1/2 p-3")}>
          <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
            Request Details
          </Text>
          <View style={tw("text-[9px] text-gray-800")}>
            {purchasingRfq?.rfqId ? (
              <Text>RFQ Number: {purchasingRfq.rfqId}</Text>
            ) : null}
            {purchasingRfq?.rfqDate ? (
              <Text>
                Date: {formatDate(purchasingRfq.rfqDate, undefined, locale)}
              </Text>
            ) : null}
            {purchasingRfq?.expirationDate ? (
              <Text>
                Quote Due:{" "}
                {formatDate(purchasingRfq.expirationDate, undefined, locale)}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );
}
