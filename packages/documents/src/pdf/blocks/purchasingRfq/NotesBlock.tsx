// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { JSONContent } from "@carbon/react";
import { Text, View } from "@react-pdf/renderer";
import {
  type DocumentBlock,
  makeText,
  purchasingRfqTexts
} from "../../../template";
import { Note } from "../../components";
import { hasContent } from "../resolveTerms";
import { useTw } from "../tw";
import type { PurchasingRfqData } from "./types";

/**
 * The close of the letter: the RFQ's notes to the supplier, then the
 * sign-off with the buyer's name under the company's.
 */
export function NotesBlock({
  block,
  data
}: {
  block: DocumentBlock;
  data: PurchasingRfqData;
}) {
  const tw = useTw();
  const t = makeText(purchasingRfqTexts.notes, block, data.vars);
  const { company, contact } = data;
  const notes = (data.purchasingRfq?.notes ?? {}) as JSONContent;

  return (
    <View wrap={false} style={tw("mb-4 text-[10px] text-gray-800")}>
      {hasContent(notes) ? (
        <View style={tw("mb-1")}>
          <Text style={tw("font-bold mb-1")}>{t("notes")}</Text>
          <Note content={notes} />
        </View>
      ) : null}
      <Text style={tw("mb-4")}>{t("thankYou")}</Text>
      <Text style={tw("mb-6")}>{t("sincerely")}</Text>
      {contact?.name ? (
        <Text style={tw("font-bold")}>{contact.name}</Text>
      ) : null}
      {company?.name ? <Text>{company.name}</Text> : null}
      {contact?.email ? (
        <Text style={tw("text-gray-600")}>{contact.email}</Text>
      ) : null}
    </View>
  );
}
