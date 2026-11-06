// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Text, View } from "@react-pdf/renderer";
import { Fragment } from "react";
import {
  type DocumentBlock,
  makeText,
  type purchaseReturnOrderTexts,
  type salesReturnOrderTexts
} from "../../../template";
import { AddressRows, useTextRows } from "../textRows";
import { useTw } from "../tw";

type PartiesTexts =
  | typeof salesReturnOrderTexts.parties
  | typeof purchaseReturnOrderTexts.parties;
type PartiesKey = PartiesTexts[number]["key"];

/** The party on the left, the return's details and its other address on the right. */
export function ReturnOrderParties({
  block,
  texts,
  vars,
  party,
  partyHeading,
  details,
  otherAddress
}: {
  block: DocumentBlock;
  texts: PartiesTexts;
  vars: Record<string, string>;
  party: "customer" | "supplier";
  /** The word above the party's address. */
  partyHeading: PartiesKey;
  details: PartiesKey[];
  otherAddress: "returnTo" | "shipFrom";
}) {
  const tw = useTw();
  const t = makeText(texts, block, vars);
  const { row } = useTextRows(t);

  return (
    <View style={tw("border border-gray-200 mb-4")}>
      <View style={tw("flex flex-row")}>
        <View style={tw("w-1/2 p-3 border-r border-gray-200")}>
          <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
            {t(partyHeading)}
          </Text>
          <View style={tw("text-[9px] text-gray-800")}>
            <AddressRows<"customer" | "supplier"> t={t} prefix={party} />
          </View>
        </View>

        <View style={tw("w-1/2 flex flex-col")}>
          <View style={tw("p-3 border-b border-gray-200")}>
            <Text
              style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}
            >
              {t("returnDetails")}
            </Text>
            <View style={tw("text-[9px] text-gray-800")}>
              {details.map((key) => (
                <Fragment key={key}>{row(key)}</Fragment>
              ))}
            </View>
          </View>

          <View style={tw("p-3")}>
            <Text
              style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}
            >
              {t(otherAddress)}
            </Text>
            <View style={tw("text-[9px] text-gray-800")}>
              <AddressRows<"returnTo" | "shipFrom">
                t={t}
                prefix={otherAddress}
              />
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}
