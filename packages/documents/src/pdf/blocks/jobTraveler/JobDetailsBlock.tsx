// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { distinctItemText } from "@carbon/utils";
import { Image, StyleSheet, Text, View } from "@react-pdf/renderer";
import {
  type DocumentBlock,
  jobTravelerTexts,
  makeText
} from "../../../template";
import { tw } from "./tw";
import type { JobTravelerData } from "./types";

const jobHeaderStyles = StyleSheet.create({
  jobHeader: {
    border: "1px solid #CCC",
    borderRadius: 6,
    padding: 16,
    fontSize: 10,
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 20,
    gap: 60
  },
  leftSection: {
    flex: 1,
    marginTop: 5
  },
  rightSection: {
    flex: 1
  },
  infoRow: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4
  },
  label: {
    fontSize: 11,
    fontWeight: 600,
    color: "#374151"
  },
  value: {
    fontSize: 11,
    fontWeight: 400,
    color: "#111827"
  }
});

type JobDetailsKey = (typeof jobTravelerTexts.jobDetails)[number]["key"];

/** The two-column job info box (ids, qty, dates, thumbnail). */
export function JobDetailsBlock({
  block,
  data
}: {
  block: DocumentBlock;
  data: JobTravelerData;
}) {
  const t = makeText(jobTravelerTexts.jobDetails, block, data.vars);
  const { job, item, batchNumber, thumbnail } = data;

  // A service prints "Service:" where a part prints "Part ID:".
  const itemIdKey = item.type === "Service" ? "service" : "partId";
  const scrapPrints = job.scrapQuantity && job.scrapQuantity > 0;

  // A line with no readable sales order prints the user's "Make to Order" word.
  const targetInfo =
    job.salesOrderId && job.salesOrderLineId
      ? t("salesOrder", {
          "job.salesOrder": data.vars["job.salesOrder"] || t("makeToOrder")
        })
      : t("inventory");

  /** One label on the left, its value on the right. */
  const row = (label: JobDetailsKey, value: string) => (
    <View style={jobHeaderStyles.infoRow}>
      <Text style={jobHeaderStyles.label}>{t(label)}</Text>
      <Text style={jobHeaderStyles.value}>{value}</Text>
    </View>
  );

  return (
    <View style={tw("mb-6")}>
      <View style={jobHeaderStyles.jobHeader}>
        <View style={jobHeaderStyles.leftSection}>
          {t.shows("jobId") ? row("jobId", t("jobIdValue")) : null}

          {t.shows(itemIdKey) ? row(itemIdKey, t(`${itemIdKey}Value`)) : null}

          {t.prints("methodRevisionValue")
            ? row("methodRevision", t("methodRevisionValue"))
            : null}

          {batchNumber && t.prints("number")
            ? row("tracking", t("number"))
            : null}

          {t.shows("item") &&
          distinctItemText(job.itemReadableIdWithRevision, item.name)
            ? row("item", t("itemValue"))
            : null}

          {t.shows("quantity") ? row("quantity", t("quantityValue")) : null}

          {scrapPrints && t.prints("scrapQtyValue")
            ? row("scrapQty", t("scrapQtyValue"))
            : null}
          {t.shows("target") ? row("target", targetInfo) : null}
          {t.prints("customerValue")
            ? row("customer", t("customerValue"))
            : null}

          {t.prints("startDateValue")
            ? row("startDate", t("startDateValue"))
            : null}

          {t.prints("dueDateValue") ? row("dueDate", t("dueDateValue")) : null}

          {t.prints("deadlineTypeValue")
            ? row("deadlineType", t("deadlineTypeValue"))
            : null}
        </View>

        <View style={jobHeaderStyles.rightSection}>
          {thumbnail ? (
            <View>
              <Image
                src={thumbnail}
                style={tw("w-full h-auto border rounded-lg border-gray-300")}
              />
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}
