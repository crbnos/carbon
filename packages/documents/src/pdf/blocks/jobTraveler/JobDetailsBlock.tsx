// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { distinctItemText, formatDate } from "@carbon/utils";
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

/** The two-column job info box (ids, qty, dates, thumbnail). */
export function JobDetailsBlock({
  block,
  data
}: {
  block: DocumentBlock;
  data: JobTravelerData;
}) {
  const t = makeText(jobTravelerTexts.jobDetails, block, data.vars);
  const {
    job,
    item,
    customer,
    batchNumber,
    methodRevision,
    thumbnail,
    locale,
    jobOperations
  } = data;

  // A service prints "Service:" where a part prints "Part ID:".
  const itemIdKey = item.type === "Service" ? "service" : "partId";

  const getTargetInfo = () => {
    if (job.salesOrderId && job.salesOrderLineId) {
      return `${t("salesOrder")} ${job.salesOrderReadableId || t("makeToOrder")}`;
    }
    return t("inventory");
  };

  const getTrackingNumber = () => {
    if (batchNumber) {
      return `${item.itemTrackingType}${t("number")} ${batchNumber}`;
    }
    return null;
  };

  return (
    <View style={tw("mb-6")}>
      <View style={jobHeaderStyles.jobHeader}>
        <View style={jobHeaderStyles.leftSection}>
          {t.shows("jobId") ? (
            <View style={jobHeaderStyles.infoRow}>
              <Text style={jobHeaderStyles.label}>{t("jobId")}</Text>
              <Text style={jobHeaderStyles.value}>{job.jobId}</Text>
            </View>
          ) : null}

          {t.shows(itemIdKey) ? (
            <View style={jobHeaderStyles.infoRow}>
              <Text style={jobHeaderStyles.label}>{t(itemIdKey)}</Text>
              <Text style={jobHeaderStyles.value}>
                {job.itemReadableIdWithRevision}
              </Text>
            </View>
          ) : null}

          {t.shows("methodRevision") &&
          methodRevision &&
          methodRevision !== "0" ? (
            <View style={jobHeaderStyles.infoRow}>
              <Text style={jobHeaderStyles.label}>{t("methodRevision")}</Text>
              <Text style={jobHeaderStyles.value}>V{methodRevision}</Text>
            </View>
          ) : null}

          {t.shows("tracking") && getTrackingNumber() ? (
            <View style={jobHeaderStyles.infoRow}>
              <Text style={jobHeaderStyles.label}>{t("tracking")}</Text>
              <Text style={jobHeaderStyles.value}>{getTrackingNumber()}</Text>
            </View>
          ) : null}

          {t.shows("item") &&
          distinctItemText(job.itemReadableIdWithRevision, item.name) ? (
            <View style={jobHeaderStyles.infoRow}>
              <Text style={jobHeaderStyles.label}>{t("item")}</Text>
              <Text style={jobHeaderStyles.value}>{item.name}</Text>
            </View>
          ) : null}

          {t.shows("quantity") ? (
            <View style={jobHeaderStyles.infoRow}>
              <Text style={jobHeaderStyles.label}>{t("quantity")}</Text>
              <Text style={jobHeaderStyles.value}>
                {jobOperations?.[0]?.targetQuantity ?? job.quantity}{" "}
                {job.unitOfMeasureCode}
              </Text>
            </View>
          ) : null}

          {t.shows("scrapQty") && job.scrapQuantity && job.scrapQuantity > 0 ? (
            <View style={jobHeaderStyles.infoRow}>
              <Text style={jobHeaderStyles.label}>{t("scrapQty")}</Text>
              <Text style={jobHeaderStyles.value}>
                {job.scrapQuantity} {job.unitOfMeasureCode}
              </Text>
            </View>
          ) : null}
          {t.shows("target") ? (
            <View style={jobHeaderStyles.infoRow}>
              <Text style={jobHeaderStyles.label}>{t("target")}</Text>
              <Text style={jobHeaderStyles.value}>{getTargetInfo()}</Text>
            </View>
          ) : null}
          {t.shows("customer") && customer ? (
            <View style={jobHeaderStyles.infoRow}>
              <Text style={jobHeaderStyles.label}>{t("customer")}</Text>
              <Text style={jobHeaderStyles.value}>{customer.name}</Text>
            </View>
          ) : null}

          {t.shows("startDate") && job.startDate ? (
            <View style={jobHeaderStyles.infoRow}>
              <Text style={jobHeaderStyles.label}>{t("startDate")}</Text>
              <Text style={jobHeaderStyles.value}>
                {formatDate(job.startDate, undefined, locale)}
              </Text>
            </View>
          ) : null}

          {t.shows("dueDate") && job.dueDate ? (
            <View style={jobHeaderStyles.infoRow}>
              <Text style={jobHeaderStyles.label}>{t("dueDate")}</Text>
              <Text style={jobHeaderStyles.value}>
                {formatDate(job.dueDate, undefined, locale)}
              </Text>
            </View>
          ) : null}

          {t.shows("deadlineType") && job.deadlineType ? (
            <View style={jobHeaderStyles.infoRow}>
              <Text style={jobHeaderStyles.label}>{t("deadlineType")}</Text>
              <Text style={jobHeaderStyles.value}>{job.deadlineType}</Text>
            </View>
          ) : null}
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
