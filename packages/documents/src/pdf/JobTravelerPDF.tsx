import { getMESUrl } from "@carbon/auth";
import type { Database } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
import { formatDate, formatDurationMinutes } from "@carbon/utils";
import { Image, StyleSheet, Text, View } from "@react-pdf/renderer";
import { createTw } from "react-pdf-tailwind";
import { generateQRCode } from "../qr/qr-code";
import type { Company, PDF } from "../types";
import { Header, Note, Template } from "./components";

type JobOperationStep = Database["public"]["Tables"]["jobOperationStep"]["Row"];

type JobOperationWithSteps =
  Database["public"]["Tables"]["jobOperation"]["Row"] & {
    jobOperationStep?: JobOperationStep[];
  };

interface JobTravelerProps extends PDF {
  job: Database["public"]["Views"]["jobs"]["Row"];
  jobMakeMethod: Database["public"]["Tables"]["jobMakeMethod"]["Row"];
  jobOperations: JobOperationWithSteps[];
  customer: Database["public"]["Tables"]["customer"]["Row"] | null;
  item: Database["public"]["Tables"]["item"]["Row"];
  batchNumber: string | undefined;
  bomId?: string;
  notes?: JSONContent;
  thumbnail?: string | null;
  includeWorkInstructions?: boolean;
}

function getStartPath(operationId: string) {
  return `${getMESUrl()}/x/start/${operationId}`;
}

function getEndPath(operationId: string) {
  return `${getMESUrl()}/x/end/${operationId}`;
}

// Initialize tailwind-styled-components
const tw = createTw({
  theme: {
    fontFamily: {
      sans: ["Helvetica", "Arial", "sans-serif"]
    },
    extend: {
      colors: {
        gray: {
          500: "#7d7d7d"
        }
      }
    }
  }
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
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    marginBottom: 8,
    color: "#111827",
    borderBottom: "1px solid #d1d5db",
    paddingBottom: 2
  }
});

type JobHeaderProps = {
  company: Company;
  job: Database["public"]["Views"]["jobs"]["Row"];
  customer: Database["public"]["Tables"]["customer"]["Row"] | null;
  item: Database["public"]["Tables"]["item"]["Row"];
  jobOperations: JobOperationWithSteps[];
  batchNumber?: string;
  bomId?: string;
  thumbnail?: string | null;
  methodRevision?: string | null;
  locale?: string;
};

const JobHeader = ({
  batchNumber,
  bomId,
  company,
  customer,
  item,
  job,
  locale,
  methodRevision,
  thumbnail,
  jobOperations
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
  );
};

// Page content component without Document/Template wrapper (for combining multiple make methods)
export const JobTravelerPageContent = ({
  company,
  job,
  jobOperations,
  customer,
  item,
  batchNumber,
  bomId,
  locale,
  notes,
  thumbnail,
  methodRevision,
  includeWorkInstructions = false
}: Omit<JobTravelerProps, "meta" | "title" | "jobMakeMethod"> & {
  methodRevision?: string | null;
}) => {
  return (
    <View style={tw("flex flex-col")}>
      {/* Original Header Section with company logo and job title */}
      <View style={tw("mb-6")}>
        <Header
          company={company}
          title="Job Traveler"
          documentId={job.jobId}
          date={job.startDate}
          locale={locale}
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
          bomId={bomId}
          locale={locale}
          thumbnail={thumbnail}
          methodRevision={methodRevision}
          jobOperations={jobOperations}
        />
      </View>

      {/* Job Information Section */}
      <View style={tw("mb-6 text-xs")}>
        <View
          style={tw(
            "flex flex-row justify-between items-center py-3 px-[6px] border-t border-b border-gray-300 font-bold uppercase page-break-inside-avoid gap-x-6"
          )}
        >
          <Text style={tw("w-1/12 text-left")}>Seq</Text>
          <Text style={tw("w-8/12 text-left")}>Operation</Text>
          <Text style={tw("w-3/12 text-left")}>Expected Times</Text>
        </View>

        {jobOperations
          .sort((a, b) => a.order - b.order)
          .map((operation, index) => {
            const isInside = operation.operationType === "Inside";
            const setupQrCode =
              operation.setupTime > 0
                ? generateQRCode(`${getStartPath(operation.id)}?type=Setup`, 10)
                : null;
            let laborQrCode =
              operation.laborTime > 0
                ? generateQRCode(`${getStartPath(operation.id)}?type=Labor`, 10)
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

            const setupTimeFormatted = formatDurationMinutes(
              operation.setupTime,
              { style: "short" }
            );
            const laborTimeFormatted = formatDurationMinutes(
              operation.laborTime,
              { style: "short" }
            );
            const machineTimeFormatted = formatDurationMinutes(
              operation.machineTime,
              { style: "short" }
            );
            const hasExpectedTimes =
              setupTimeFormatted || laborTimeFormatted || machineTimeFormatted;

            const workInstruction = operation.workInstruction as
              | JSONContent
              | undefined;
            const hasWorkInstruction =
              includeWorkInstructions &&
              workInstruction &&
              typeof workInstruction === "object" &&
              "content" in workInstruction &&
              Array.isArray(workInstruction.content) &&
              workInstruction.content.length > 0;
            const hasProcedureSteps =
              includeWorkInstructions &&
              operation.jobOperationStep &&
              operation.jobOperationStep.length > 0;

            return (
              <View
                style={tw(
                  "flex flex-col border-b border-gray-300 py-4 px-[6px] page-break-inside-avoid"
                )}
                key={operation.id}
                wrap={includeWorkInstructions ? true : false}
              >
                <View style={tw("flex flex-col gap-y-4")} wrap={false}>
                  <View
                    style={tw(
                      "flex flex-row justify-between items-start gap-x-6"
                    )}
                    wrap={false}
                  >
                    <Text style={tw("w-1/12 font-bold text-left")}>
                      {getParallelizedOrder(index, operation, jobOperations)}
                    </Text>
                    <View style={tw("w-8/12 text-left text-[12px]")}>
                      <Text style={tw("font-bold")}>
                        {operation.description}
                      </Text>
                    </View>
                    <View style={tw("w-3/12 text-left")}>
                      {hasExpectedTimes && (
                        <View style={tw("flex flex-col gap-1")}>
                          {setupTimeFormatted && (
                            <Text style={tw("text-[10px]")}>
                              Setup: {setupTimeFormatted}
                            </Text>
                          )}
                          {laborTimeFormatted && (
                            <Text style={tw("text-[10px]")}>
                              Labor: {laborTimeFormatted}
                            </Text>
                          )}
                          {machineTimeFormatted && (
                            <Text style={tw("text-[10px]")}>
                              Machine: {machineTimeFormatted}
                            </Text>
                          )}
                        </View>
                      )}
                    </View>
                  </View>

                  <View
                    style={tw(
                      "flex flex-row justify-between items-center py-3 px-[6px] border-gray-300 font-bold uppercase page-break-inside-avoid"
                    )}
                  >
                    <Text style={tw("text-left pr-4")}>Actions</Text>
                  </View>

                  <View style={tw("w-full flex flex-row justify-start gap-2")}>
                    {isInside && setupQrCode && (
                      <View style={tw("flex flex-col items-center w-1/4")}>
                        <>
                          <Image src={setupQrCode} style={tw("w-16 h-16")} />
                          <Text style={tw("text-[10px] mt-1")}>Setup</Text>
                        </>
                      </View>
                    )}

                    {isInside && laborQrCode && (
                      <View style={tw("flex flex-col items-center w-1/4")}>
                        <>
                          <Image src={laborQrCode} style={tw("w-16 h-16")} />
                          <Text style={tw("text-[10px] mt-1")}>Labor</Text>
                        </>
                      </View>
                    )}
                    {isInside && machiningQrCode && (
                      <View style={tw("flex flex-col items-center w-1/4")}>
                        <>
                          <Image
                            src={machiningQrCode}
                            style={tw("w-16 h-16")}
                          />
                          <Text style={tw("text-[10px] mt-1")}>Machine</Text>
                        </>
                      </View>
                    )}
                    <View style={tw("flex flex-col items-center w-1/4")}>
                      <Image src={completeQrCode} style={tw("w-16 h-16")} />
                      <Text style={tw("text-[10px] mt-1")}>Complete</Text>
                    </View>
                  </View>
                </View>

                {(hasWorkInstruction || hasProcedureSteps) && (
                  <View style={tw("mt-2 ml-8")}>
                    {hasProcedureSteps && (
                      <View style={tw("mb-2")}>
                        <Text
                          style={{
                            marginBottom: 8,
                            borderTopWidth: 1,
                            borderTopColor: "#d1d5db",
                            borderBottomWidth: 1,
                            borderColor: "#d1d5db",
                            paddingTop: 4,
                            paddingBottom: 4,
                            fontSize: 9,
                            fontWeight: 700,
                            textTransform: "uppercase"
                          }}
                        >
                          Procedure Steps
                        </Text>
                        {operation
                          .jobOperationStep!.sort(
                            (a, b) => a.sortOrder - b.sortOrder
                          )
                          .map((step) => {
                            const stepDescription = step.description as
                              | JSONContent
                              | undefined;
                            const hasStepDescription =
                              stepDescription &&
                              typeof stepDescription === "object" &&
                              "content" in stepDescription &&
                              Array.isArray(stepDescription.content) &&
                              stepDescription.content.length > 0;

                            return (
                              <View
                                key={step.id}
                                style={tw("flex flex-row items-start mb-1")}
                              >
                                <View
                                  style={{
                                    width: 9,
                                    height: 9,
                                    borderWidth: 1,
                                    borderColor: "#374151",
                                    marginRight: 6,
                                    marginTop: 1
                                  }}
                                />
                                <View style={tw("flex-1")}>
                                  <Text style={tw("text-[9px] font-bold")}>
                                    {step.name}
                                  </Text>
                                  {hasStepDescription && (
                                    <Note
                                      title="Procedure Step"
                                      content={stepDescription}
                                    />
                                  )}
                                </View>
                              </View>
                            );
                          })}
                      </View>
                    )}
                    {hasWorkInstruction && (
                      <Note
                        title="Work Instructions"
                        content={workInstruction}
                      />
                    )}
                  </View>
                )}
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
  bomId,
  locale,
  meta,
  notes,
  thumbnail,
  title = "Job Traveler",
  includeWorkInstructions = false
}: JobTravelerProps) => {
  return (
    <Template
      title={title}
      meta={{
        author: meta?.author ?? "Carbon",
        keywords: meta?.keywords ?? "job traveler, manufacturing",
        subject: meta?.subject ?? "Job Traveler"
      }}
    >
      <JobTravelerPageContent
        company={company}
        job={job}
        jobOperations={jobOperations}
        customer={customer}
        item={item}
        batchNumber={batchNumber}
        bomId={bomId}
        locale={locale}
        notes={notes}
        thumbnail={thumbnail}
        methodRevision={jobMakeMethod.version?.toString()}
        includeWorkInstructions={includeWorkInstructions}
      />
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
    if (items[i]?.operationOrder !== "With Previous") {
      return i + 1;
    }
  }

  return 1;
}
