import type { Database } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
import { Image, StyleSheet, Text, View } from "@react-pdf/renderer";
import { createTw } from "react-pdf-tailwind";
import { generateQRCode } from "../qr/qr-code";
import type { Company, PDF } from "../types";
import { Header, Note, Template } from "./components";

interface JobTravelerProps extends PDF {
  job: Database["public"]["Views"]["jobs"]["Row"];
  jobMakeMethod: Database["public"]["Tables"]["jobMakeMethod"]["Row"];
  jobOperations: Database["public"]["Tables"]["jobOperation"]["Row"][];
  customer: Database["public"]["Tables"]["customer"]["Row"] | null;
  item: Database["public"]["Tables"]["item"]["Row"];
  batchNumber: string | undefined;
  notes?: JSONContent;
  thumbnail?: string | null;
}

function getStartPath(operationId: string) {
  return `https://mes.carbon.ms/x/start/${operationId}`;
}

function getEndPath(operationId: string) {
  return `https://mes.carbon.ms/x/end/${operationId}`;
}

// Initialize tailwind-styled-components
const tw = createTw({
  theme: {
    fontFamily: {
      sans: ["Helvetica", "Arial", "sans-serif"],
    },
    extend: {
      colors: {
        gray: {
          500: "#7d7d7d",
        },
      },
    },
  },
});

// JobHeader styles
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
    gap: 60,
  },
  leftSection: {
    flex: 1,
    marginTop: 5,
  },
  rightSection: {
    flex: 1,
  },
  infoRow: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  label: {
    fontSize: 9,
    fontWeight: 600,
    color: "#374151",
  },
  value: {
    fontSize: 9,
    fontWeight: 400,
    color: "#111827",
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    marginBottom: 8,
    color: "#111827",
    borderBottom: "1px solid #d1d5db",
    paddingBottom: 2,
  },
});

type JobHeaderProps = {
  company: Company;
  job: Database["public"]["Views"]["jobs"]["Row"];
  customer: Database["public"]["Tables"]["customer"]["Row"] | null;
  item: Database["public"]["Tables"]["item"]["Row"];
  batchNumber?: string;
  thumbnail?: string | null;
};

const JobHeader = ({
  company,
  job,
  customer,
  item,
  batchNumber,
  thumbnail,
}: JobHeaderProps) => {
  const getTargetInfo = () => {
    if (job.salesOrderId && job.salesOrderLineId) {
      return `Sales Order: ${job.salesOrderReadableId || "Make to Order"}`;
    }
    return "Inventory";
  };

  const getTrackingNumber = () => {
    if (batchNumber) {
      const trackingType = item.itemTrackingType;
      return `${trackingType} Number: ${batchNumber}`;
    }
    return null;
  };

  return (
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
            {job.quantity} {job.unitOfMeasureCode}
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
              {new Date(job.startDate).toLocaleDateString()}
            </Text>
          </View>
        )}

        {job.dueDate && (
          <View style={jobHeaderStyles.infoRow}>
            <Text style={jobHeaderStyles.label}>Due Date:</Text>
            <Text style={jobHeaderStyles.value}>
              {new Date(job.dueDate).toLocaleDateString()}
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
  );
};

const JobTravelerPDF = ({
  company,
  job,
  jobMakeMethod,
  jobOperations,
  customer,
  item,
  batchNumber,
  meta,
  notes,
  thumbnail,
  title = "Job Traveler",
}: JobTravelerProps) => {
  const subtitle = batchNumber
    ? batchNumber
    : item.name ?? item.readableIdWithRevision;
  const tertiaryTitle = batchNumber
    ? `${item.name ?? item.readableIdWithRevision}`
    : undefined;

  return (
    <Template
      title={title}
      meta={{
        author: meta?.author ?? "Carbon",
        keywords: meta?.keywords ?? "job traveler, manufacturing",
        subject: meta?.subject ?? "Job Traveler",
      }}
    >
      <View style={tw("flex flex-col")}>
        {/* Original Header Section with company logo and job title */}
        <View style={tw("mb-6")}>
          <Header
            title={job.jobId}
            subtitle={subtitle}
            tertiaryTitle={tertiaryTitle}
            company={company}
          />
        </View>

        {/* Job Header Section with detailed information */}
        <View style={tw("mb-6")}>
          <JobHeader
            company={company}
            job={job}
            customer={customer}
            item={item}
            batchNumber={batchNumber}
            thumbnail={thumbnail}
          />
        </View>

        {/* Job Information Section */}
        <View style={tw("mb-6 text-xs")}>
          <View
            style={tw(
              "flex flex-row justify-between items-center py-3 px-[6px] border-t border-b border-gray-300 font-bold uppercase page-break-inside-avoid"
            )}
          >
            <Text style={tw("w-1/12 text-left")}>Seq</Text>
            <Text style={tw("w-3/12 text-left")}>Operation</Text>
            <Text style={tw("w-2/3 text-right pr-4")}>Actions</Text>
          </View>

          {jobOperations
            .filter((operation) => operation.operationType === "Inside")
            .map((operation, index) => {
              const setupQrCode =
                operation.setupTime > 0
                  ? generateQRCode(
                      `${getStartPath(operation.id)}?type=Setup`,
                      10
                    )
                  : null;
              let laborQrCode =
                operation.laborTime > 0
                  ? generateQRCode(
                      `${getStartPath(operation.id)}?type=Labor`,
                      10
                    )
                  : null;
              let machiningQrCode =
                operation.machineTime > 0
                  ? generateQRCode(
                      `${getStartPath(operation.id)}?type=Machine`,
                      10
                    )
                  : null;
              let completeQrCode = generateQRCode(getEndPath(operation.id), 10);

              if (
                setupQrCode === null &&
                laborQrCode === null &&
                machiningQrCode === null
              ) {
                laborQrCode = generateQRCode(
                  `${getStartPath(operation.id)}?type=Labor`,
                  10
                );
              }

              return (
                <View
                  style={tw(
                    "flex flex-col border-b border-gray-300 py-4 px-[6px] page-break-inside-avoid"
                  )}
                  key={operation.id}
                >
                  <View style={tw("flex flex-row justify-between items-start")}>
                    <Text style={tw("w-1/12 text-left")}>
                      {getParallelizedOrder(index, operation, jobOperations)}
                    </Text>
                    <View style={tw("w-3/12 text-left")}>
                      <Text style={tw("font-bold")}>
                        {operation.description}
                      </Text>
                    </View>
                    <View style={tw("w-2/3 flex flex-row justify-end gap-2")}>
                      {setupQrCode && (
                        <View style={tw("flex flex-col items-center w-1/4")}>
                          <>
                            <Image src={setupQrCode} style={tw("w-16 h-16")} />
                            <Text style={tw("text-[8px] mt-1")}>Setup</Text>
                          </>
                        </View>
                      )}

                      {laborQrCode && (
                        <View style={tw("flex flex-col items-center w-1/4")}>
                          <>
                            <Image src={laborQrCode} style={tw("w-16 h-16")} />
                            <Text style={tw("text-[8px] mt-1")}>Labor</Text>
                          </>
                        </View>
                      )}
                      {machiningQrCode && (
                        <View style={tw("flex flex-col items-center w-1/4")}>
                          <>
                            <Image
                              src={machiningQrCode}
                              style={tw("w-16 h-16")}
                            />
                            <Text style={tw("text-[8px] mt-1")}>Machine</Text>
                          </>
                        </View>
                      )}
                      <View style={tw("flex flex-col items-center w-1/4")}>
                        <Image src={completeQrCode} style={tw("w-16 h-16")} />
                        <Text style={tw("text-[8px] mt-1")}>Complete</Text>
                      </View>
                    </View>
                  </View>
                </View>
              );
            })}
        </View>

        {/* Notes Section */}
        {notes && (
          <View style={tw("mb-6")}>
            <Note title="Job Notes" content={notes} />
          </View>
        )}
      </View>
    </Template>
  );
};

export default JobTravelerPDF;

type Operation = Database["public"]["Tables"]["jobOperation"]["Row"];

function getParallelizedOrder(
  index: number,
  item: Operation,
  items: Operation[]
) {
  if (item?.operationOrder !== "With Previous") return index + 1;
  // traverse backwards through the list of items to find the first item that is not "With Previous" and return its index + 1
  for (let i = index - 1; i >= 0; i--) {
    if (items[i].operationOrder !== "With Previous") {
      return i + 1;
    }
  }

  return 1;
}
