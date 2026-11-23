// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { View } from "@react-pdf/renderer";
import {
  type DocumentBlock,
  makeText,
  stockTransferTexts
} from "../../../template";
import { Summary } from "../../components";
import { useTw } from "../tw";
import type { StockTransferData } from "./types";

const COMPANY_LINES = [
  "companyAddressLine1",
  "companyAddressLine2",
  "companyCity",
  "companyStatePostal",
  "phone",
  "email",
  "website"
] as const;

/** Company + transfer metadata (date, id, location, assignee). */
export function DetailsBlock({
  block,
  data
}: {
  block: DocumentBlock;
  data: StockTransferData;
}) {
  const tw = useTw();
  const t = makeText(stockTransferTexts.details, block, data.vars);

  const items: { label: string; value: string }[] = [];
  if (t.shows("date")) {
    items.push({ label: t("date"), value: t("dateValue") });
  }
  if (t.shows("stockTransfer")) {
    items.push({ label: t("stockTransfer"), value: t("stockTransferValue") });
  }
  if (t.shows("location")) {
    items.push({ label: t("location"), value: t("locationValue") });
  }
  if (t.prints("assigneeValue")) {
    items.push({ label: t("assignee"), value: t("assigneeValue") });
  }

  return (
    <View style={tw("mb-4")}>
      <Summary
        companyName={t.prints("companyName") ? t("companyName") : null}
        companyLines={COMPANY_LINES.filter((key) => t.prints(key)).map(
          (key) => ({ key, text: t(key) })
        )}
        items={items}
      />
    </View>
  );
}
