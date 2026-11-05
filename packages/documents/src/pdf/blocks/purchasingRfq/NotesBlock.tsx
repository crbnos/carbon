// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Text, View } from "@react-pdf/renderer";
import {
  type DocumentBlock,
  makeText,
  printedNotes,
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
  const notes = printedNotes(block, data.purchasingRfq?.notes) ?? {};

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
      {t.prints("contactName") ? (
        <Text style={tw("font-bold")}>{t("contactName")}</Text>
      ) : null}
      {t.prints("companyName") ? <Text>{t("companyName")}</Text> : null}
      {t.prints("contactEmail") ? (
        <Text style={tw("text-gray-600")}>{t("contactEmail")}</Text>
      ) : null}
    </View>
  );
}
