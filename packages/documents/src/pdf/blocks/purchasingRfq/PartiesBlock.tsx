// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { formatCityStatePostalCode, formatDate } from "@carbon/utils";
import { Text, View } from "@react-pdf/renderer";
import {
  type DocumentBlock,
  makeText,
  purchasingRfqTexts
} from "../../../template";
import { getCountryName } from "../../../utils/shared";
import { useTw } from "../tw";
import type { PurchasingRfqAddress, PurchasingRfqData } from "./types";

function resolveCountry(address?: PurchasingRfqAddress | null): string {
  if (!address) return "";
  return address.country ?? getCountryName(address.countryCode);
}

/**
 * The text keys of what a supplier is expected to put in a quotation of their
 * own format. A line the user emptied prints no bullet.
 */
const QUOTATION_CONTENTS = [
  "includes1",
  "includes2",
  "includes3",
  "includes4"
] as const;

/**
 * The opening of the letter: date, reference and due date, the salutation,
 * what to quote and by when, then where to deliver and who to answer. The
 * supplier answers in their own format, so this asks rather than prescribes.
 */
export function PartiesBlock({
  block,
  data
}: {
  block: DocumentBlock;
  data: PurchasingRfqData;
}) {
  const tw = useTw();
  const t = makeText(purchasingRfqTexts.parties, block, data.vars);
  const { company, contact, purchasingRfq, shipToAddress, locale } = data;
  const dueDate = purchasingRfq?.expirationDate
    ? formatDate(purchasingRfq.expirationDate, undefined, locale)
    : null;

  const facts = (
    [
      {
        key: "date",
        value: purchasingRfq?.rfqDate
          ? formatDate(purchasingRfq.rfqDate, undefined, locale)
          : null
      },
      { key: "reference", value: purchasingRfq?.rfqId },
      { key: "quotationDue", value: dueDate }
    ] as const
  ).filter((fact) => t.shows(fact.key) && fact.value);

  // One line, as an address is written on a letter: "Detroit, MI 48201".
  const cityLine =
    shipToAddress?.city ||
    shipToAddress?.stateProvince ||
    shipToAddress?.postalCode
      ? formatCityStatePostalCode(
          shipToAddress.city,
          shipToAddress.stateProvince,
          shipToAddress.postalCode
        )
      : null;

  const reference = purchasingRfq?.rfqId
    ? `${t("quotingReference")}${purchasingRfq.rfqId}`
    : "";
  const deadline = dueDate ? `${t("by")}${dueDate}` : "";

  return (
    <View style={tw("mb-5 text-[10px] text-gray-800")}>
      {facts.length > 0 ? (
        <View style={tw("mb-5")}>
          {facts.map((fact) => (
            <View key={fact.key} style={tw("flex flex-row")}>
              <Text style={tw("w-[90px] text-gray-600")}>{t(fact.key)}</Text>
              <Text>{fact.value}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <Text style={tw("mb-3")}>{t("dearSupplier")}</Text>
      <Text style={tw("mb-3")}>
        {`${t("invitation")}${deadline}${reference}${t("invitationEnd")}`}
      </Text>
      <Text style={tw("mb-1")}>{t("yourQuotationShouldInclude")}</Text>
      <View style={tw("mb-5 pl-3")}>
        {QUOTATION_CONTENTS.filter((key) => t(key)).map((key) => (
          <View key={key} style={tw("flex flex-row")}>
            <Text style={tw("w-[12px]")}>•</Text>
            <Text style={tw("shrink")}>{t(key)}</Text>
          </View>
        ))}
      </View>

      <View style={tw("flex flex-row")}>
        <View style={tw("w-1/2 pr-4")}>
          <Text style={tw("font-bold mb-1")}>{t("deliverTo")}</Text>
          {[
            company?.name,
            shipToAddress?.addressLine1,
            shipToAddress?.addressLine2,
            cityLine,
            resolveCountry(shipToAddress)
          ]
            .filter(Boolean)
            .map((line) => (
              <Text key={line}>{line}</Text>
            ))}
        </View>
        {contact?.name || contact?.email ? (
          <View style={tw("w-1/2")}>
            <Text style={tw("font-bold mb-1")}>{t("sendYourQuotationTo")}</Text>
            {contact.name ? <Text>{contact.name}</Text> : null}
            {contact.email ? <Text>{contact.email}</Text> : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}
