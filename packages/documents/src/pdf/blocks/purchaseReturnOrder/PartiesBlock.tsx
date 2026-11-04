// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { formatDate } from "@carbon/utils";
import { Text, View } from "@react-pdf/renderer";
import {
  type DocumentBlock,
  makeText,
  purchaseReturnOrderTexts
} from "../../../template";
import { getCountryName } from "../../../utils/shared";
import { AddressBlock } from "../../components";
import { useTw } from "../tw";
import type { PurchaseReturnOrderData, ReturnOrderAddress } from "./types";

function resolveCountry(address?: ReturnOrderAddress | null): string {
  if (!address) return "";
  return address.country ?? getCountryName(address.countryCode);
}

export function PartiesBlock({
  block,
  data
}: {
  block: DocumentBlock;
  data: PurchaseReturnOrderData;
}) {
  const tw = useTw();
  const t = makeText(purchaseReturnOrderTexts.parties, block, data.vars);
  const { purchaseReturnOrder, supplierAddress, shipFromAddress, locale } =
    data;

  return (
    <View style={tw("border border-gray-200 mb-4")}>
      <View style={tw("flex flex-row")}>
        {/* LEFT — the supplier the goods return to */}
        <View style={tw("w-1/2 p-3 border-r border-gray-200")}>
          <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
            {t("returnTo")}
          </Text>
          <View style={tw("text-[9px] text-gray-800")}>
            <AddressBlock
              name={supplierAddress?.name}
              addressLine1={supplierAddress?.addressLine1}
              addressLine2={supplierAddress?.addressLine2}
              city={supplierAddress?.city}
              stateProvince={supplierAddress?.stateProvince}
              postalCode={supplierAddress?.postalCode}
              country={resolveCountry(supplierAddress)}
            />
          </View>
        </View>

        {/* RIGHT — Return Details + Ship From stacked */}
        <View style={tw("w-1/2 flex flex-col")}>
          <View style={tw("p-3 border-b border-gray-200")}>
            <Text
              style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}
            >
              {t("returnDetails")}
            </Text>
            <View style={tw("text-[9px] text-gray-800")}>
              {t.shows("returnNumber") &&
              purchaseReturnOrder?.purchaseReturnOrderId ? (
                <Text>
                  {t("returnNumber")}{" "}
                  {purchaseReturnOrder.purchaseReturnOrderId}
                </Text>
              ) : null}
              {t.shows("supplierRmaNumber") &&
              purchaseReturnOrder?.supplierReference ? (
                <Text>
                  {t("supplierRmaNumber")}{" "}
                  {purchaseReturnOrder.supplierReference}
                </Text>
              ) : null}
              {t.shows("date") && purchaseReturnOrder?.orderDate ? (
                <Text>
                  {t("date")}{" "}
                  {formatDate(purchaseReturnOrder.orderDate, undefined, locale)}
                </Text>
              ) : null}
              {t.shows("expires") && purchaseReturnOrder?.expirationDate ? (
                <Text>
                  {t("expires")}{" "}
                  {formatDate(
                    purchaseReturnOrder.expirationDate,
                    undefined,
                    locale
                  )}
                </Text>
              ) : null}
            </View>
          </View>

          <View style={tw("p-3")}>
            <Text
              style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}
            >
              {t("shipFrom")}
            </Text>
            <View style={tw("text-[9px] text-gray-800")}>
              <AddressBlock
                name={shipFromAddress?.name ?? data.company?.name}
                addressLine1={shipFromAddress?.addressLine1}
                addressLine2={shipFromAddress?.addressLine2}
                city={shipFromAddress?.city}
                stateProvince={shipFromAddress?.stateProvince}
                postalCode={shipFromAddress?.postalCode}
                country={resolveCountry(shipFromAddress)}
              />
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}
