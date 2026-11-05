// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Text, View } from "@react-pdf/renderer";
import {
  type DocumentBlock,
  makeText,
  purchasingRfqTexts
} from "../../../template";
import { useTextRows } from "../textRows";
import { useTw } from "../tw";
import type { PurchasingRfqData } from "./types";

/** The rows at the top of the letter: each label and the value beside it. */
const FACTS = [
  { key: "date", value: "dateValue" },
  { key: "reference", value: "referenceValue" },
  { key: "quotationDue", value: "quotationDueValue" }
] as const;

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
  const facts = FACTS.filter((fact) => t.prints(fact.value));
  const { row } = useTextRows(t);

  return (
    <View style={tw("mb-5 text-[10px] text-gray-800")}>
      {facts.length > 0 ? (
        <View style={tw("mb-5")}>
          {facts.map((fact) => (
            <View key={fact.key} style={tw("flex flex-row")}>
              <Text style={tw("w-[90px] text-gray-600")}>{t(fact.key)}</Text>
              <Text>{t(fact.value)}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <Text style={tw("mb-3")}>{t("dearSupplier")}</Text>
      <Text style={tw("mb-3")}>
        {`${t("invitation")}${t.prints("by") ? ` ${t("by")}` : ""}${
          t.prints("quotingReference") ? t("quotingReference") : ""
        }${t("invitationEnd")}`}
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
          {row("deliverToName")}
          {row("deliverToAddressLine1")}
          {row("deliverToAddressLine2")}
          {row("deliverToCity")}
          {row("deliverToCountry")}
        </View>
        {t.prints("sendToName") || t.prints("sendToEmail") ? (
          <View style={tw("w-1/2")}>
            <Text style={tw("font-bold mb-1")}>{t("sendYourQuotationTo")}</Text>
            {row("sendToName")}
            {row("sendToEmail")}
          </View>
        ) : null}
      </View>
    </View>
  );
}
