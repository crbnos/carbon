// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { formatCityStatePostalCode, formatDate } from "@carbon/utils";
import { Text, View } from "@react-pdf/renderer";
import { getCountryName } from "../../../utils/shared";
import { useTw } from "../tw";
import type { PurchasingRfqAddress, PurchasingRfqData } from "./types";

function resolveCountry(address?: PurchasingRfqAddress | null): string {
  if (!address) return "";
  return address.country ?? getCountryName(address.countryCode);
}

/** What a supplier is expected to put in a quotation of their own format. */
const QUOTATION_CONTENTS = [
  "a unit price for each quantity, in the unit of measure shown",
  "your lead time from receipt of order",
  "how long your prices remain valid",
  "freight and delivery terms to the address below"
];

/**
 * The opening of the letter: date, reference and due date, the salutation,
 * what to quote and by when, then where to deliver and who to answer. The
 * supplier answers in their own format, so this asks rather than prescribes.
 */
export function PartiesBlock({ data }: { data: PurchasingRfqData }) {
  const tw = useTw();
  const { company, contact, purchasingRfq, shipToAddress, locale } = data;
  const dueDate = purchasingRfq?.expirationDate
    ? formatDate(purchasingRfq.expirationDate, undefined, locale)
    : null;

  const facts = [
    {
      label: "Date",
      value: purchasingRfq?.rfqDate
        ? formatDate(purchasingRfq.rfqDate, undefined, locale)
        : null
    },
    { label: "Reference", value: purchasingRfq?.rfqId },
    { label: "Quotation due", value: dueDate }
  ].filter((fact) => fact.value);

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
    ? `, quoting reference ${purchasingRfq.rfqId}`
    : "";
  const deadline = dueDate ? ` by ${dueDate}` : "";

  return (
    <View style={tw("mb-5 text-[10px] text-gray-800")}>
      {facts.length > 0 ? (
        <View style={tw("mb-5")}>
          {facts.map((fact) => (
            <View key={fact.label} style={tw("flex flex-row")}>
              <Text style={tw("w-[90px] text-gray-600")}>{fact.label}</Text>
              <Text>{fact.value}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <Text style={tw("mb-3")}>Dear Supplier,</Text>
      <Text style={tw("mb-3")}>
        We invite you to quote for the items listed below. Please send your
        quotation in your usual format{deadline}
        {reference}.
      </Text>
      <Text style={tw("mb-1")}>Your quotation should include:</Text>
      <View style={tw("mb-5 pl-3")}>
        {QUOTATION_CONTENTS.map((line) => (
          <View key={line} style={tw("flex flex-row")}>
            <Text style={tw("w-[12px]")}>•</Text>
            <Text style={tw("shrink")}>{line}</Text>
          </View>
        ))}
      </View>

      <View style={tw("flex flex-row")}>
        <View style={tw("w-1/2 pr-4")}>
          <Text style={tw("font-bold mb-1")}>Deliver to</Text>
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
            <Text style={tw("font-bold mb-1")}>Send your quotation to</Text>
            {contact.name ? <Text>{contact.name}</Text> : null}
            {contact.email ? <Text>{contact.email}</Text> : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}
