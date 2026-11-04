// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { formatDate } from "@carbon/utils";
import { View } from "@react-pdf/renderer";
import {
  type DocumentBlock,
  makeText,
  stockTransferTexts
} from "../../../template";
import { Summary } from "../../components";
import { useTw } from "../tw";
import type { StockTransferData } from "./types";

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
  const { company, stockTransfer, location, locale } = data;

  const items: { label: string; value: string | null | undefined }[] = [];
  if (t.shows("date")) {
    items.push({
      label: t("date"),
      value: stockTransfer?.createdAt
        ? formatDate(stockTransfer.createdAt, undefined, locale)
        : ""
    });
  }
  if (t.shows("stockTransfer")) {
    items.push({
      label: t("stockTransfer"),
      value: stockTransfer?.stockTransferId
    });
  }
  if (t.shows("location")) {
    items.push({ label: t("location"), value: location?.name });
  }
  if (t.shows("assignee") && stockTransfer?.assignee) {
    items.push({ label: t("assignee"), value: stockTransfer.assignee });
  }

  return (
    <View style={tw("mb-4")}>
      <Summary
        company={company}
        items={items}
        phoneLabel={t.shows("phone") ? t("phone") : null}
        emailLabel={t.shows("email") ? t("email") : null}
        websiteLabel={t.shows("website") ? t("website") : null}
      />
    </View>
  );
}
