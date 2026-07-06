import { formatDate } from "@carbon/utils";
import { Image, StyleSheet, Text, View } from "@react-pdf/renderer";
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
export function JobDetailsBlock({ data }: { data: JobTravelerData }) {
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

  const getTargetInfo = () => {
    if (job.salesOrderId && job.salesOrderLineId) {
      return `Sales Order: ${job.salesOrderReadableId || "Make to Order"}`;
    }
    return "Inventory";
  };

  const getTrackingNumber = () => {
    if (batchNumber) {
      return `${item.itemTrackingType} Number: ${batchNumber}`;
    }
    return null;
  };

  return (
    <View style={tw("mb-6")}>
      <View style={jobHeaderStyles.jobHeader}>
        <View style={jobHeaderStyles.leftSection}>
          <View style={jobHeaderStyles.infoRow}>
            <Text style={jobHeaderStyles.label}>Job ID:</Text>
            <Text style={jobHeaderStyles.value}>{job.jobId}</Text>
          </View>

          <View style={jobHeaderStyles.infoRow}>
            <Text style={jobHeaderStyles.label}>Part ID:</Text>
            <Text style={jobHeaderStyles.value}>
              {job.itemReadableIdWithRevision}
            </Text>
          </View>

          {methodRevision && methodRevision !== "0" && (
            <View style={jobHeaderStyles.infoRow}>
              <Text style={jobHeaderStyles.label}>Method Revision:</Text>
              <Text style={jobHeaderStyles.value}>V{methodRevision}</Text>
            </View>
          )}

          {getTrackingNumber() && (
            <View style={jobHeaderStyles.infoRow}>
              <Text style={jobHeaderStyles.label}>Tracking:</Text>
              <Text style={jobHeaderStyles.value}>{getTrackingNumber()}</Text>
            </View>
          )}

          <View style={jobHeaderStyles.infoRow}>
            <Text style={jobHeaderStyles.label}>Item:</Text>
            <Text style={jobHeaderStyles.value}>
              {item.name || item.readableIdWithRevision}
            </Text>
          </View>

          <View style={jobHeaderStyles.infoRow}>
            <Text style={jobHeaderStyles.label}>Quantity:</Text>
            <Text style={jobHeaderStyles.value}>
              {jobOperations?.[0]?.targetQuantity ?? job.quantity}{" "}
              {job.unitOfMeasureCode}
            </Text>
          </View>

          {job.scrapQuantity && job.scrapQuantity > 0 && (
            <View style={jobHeaderStyles.infoRow}>
              <Text style={jobHeaderStyles.label}>Scrap Qty:</Text>
              <Text style={jobHeaderStyles.value}>
                {job.scrapQuantity} {job.unitOfMeasureCode}
              </Text>
            </View>
          )}
          <View style={jobHeaderStyles.infoRow}>
            <Text style={jobHeaderStyles.label}>Target:</Text>
            <Text style={jobHeaderStyles.value}>{getTargetInfo()}</Text>
          </View>
          {customer && (
            <View style={jobHeaderStyles.infoRow}>
              <Text style={jobHeaderStyles.label}>Customer:</Text>
              <Text style={jobHeaderStyles.value}>{customer.name}</Text>
            </View>
          )}

          {job.startDate && (
            <View style={jobHeaderStyles.infoRow}>
              <Text style={jobHeaderStyles.label}>Start Date:</Text>
              <Text style={jobHeaderStyles.value}>
                {formatDate(job.startDate, undefined, locale)}
              </Text>
            </View>
          )}

          {job.dueDate && (
            <View style={jobHeaderStyles.infoRow}>
              <Text style={jobHeaderStyles.label}>Due Date:</Text>
              <Text style={jobHeaderStyles.value}>
                {formatDate(job.dueDate, undefined, locale)}
              </Text>
            </View>
          )}

          {job.deadlineType && (
            <View style={jobHeaderStyles.infoRow}>
              <Text style={jobHeaderStyles.label}>Deadline Type:</Text>
              <Text style={jobHeaderStyles.value}>{job.deadlineType}</Text>
            </View>
          )}
        </View>

        <View style={jobHeaderStyles.rightSection}>
          {thumbnail && (
            <View>
              <Image
                src={thumbnail}
                style={tw("w-full h-auto border rounded-lg border-gray-300")}
              />
            </View>
          )}
        </View>
      </View>
    </View>
  );
}
