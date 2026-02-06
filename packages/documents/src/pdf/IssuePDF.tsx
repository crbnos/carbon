import type { Database } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
import { Text, View } from "@react-pdf/renderer";
import { createTw } from "react-pdf-tailwind";
import type { PDF } from "../types";
import { Header, Note, Template } from "./components";

type ListItem = {
  id: string;
  name: string;
};

type IssueItem = Database["public"]["Tables"]["nonConformanceItem"]["Row"] & {
  name: string | null;
};

type ActionTask =
  Database["public"]["Tables"]["nonConformanceActionTask"]["Row"] & {
    supplier: { name: string } | null;
  };

type JobOperationStepRecord =
  Database["public"]["Tables"]["jobOperationStepRecord"]["Row"];

type JobOperationStepWithRecords = {
  id: string;
  name: string | null;
  operationId: string;
  nonConformanceActionId: string | null;
  jobOperationStepRecord: JobOperationStepRecord[];
};

type Associations = {
  items: any[];
  customers: any[];
  suppliers: any[];
  jobOperations: any[];
  purchaseOrderLines: any[];
  salesOrderLines: any[];
  shipmentLines: any[];
  receiptLines: any[];
  trackedEntities: any[];
};

interface IssuePDFProps extends PDF {
  nonConformance: Database["public"]["Tables"]["nonConformance"]["Row"];
  nonConformanceTypes: Database["public"]["Tables"]["nonConformanceType"]["Row"][];
  actionTasks: ActionTask[];
  requiredActions: ListItem[];
  reviewers: Database["public"]["Tables"]["nonConformanceReviewer"]["Row"][];
  items: IssueItem[];
  associations?: Associations | null;
  assignees?: Record<string, string>;
  jobOperationStepRecords?: JobOperationStepWithRecords[];
  operationToJobId?: Record<string, string>;
}

const tw = createTw({
  theme: {
    fontFamily: {
      sans: ["Inter", "Helvetica", "Arial", "sans-serif"]
    },
    extend: {
      colors: {
        gray: {
          50: "#f9fafb",
          200: "#e5e7eb",
          400: "#9ca3af",
          600: "#4b5563",
          800: "#1f2937"
        }
      }
    }
  }
});

const formatDate = (dateStr: string | null) => {
  if (!dateStr) return null;
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric"
    });
  } catch {
    return dateStr;
  }
};

const IssuePDF = ({
  company,
  meta,
  nonConformance,
  nonConformanceTypes,
  actionTasks,
  requiredActions,
  reviewers,
  associations,
  assignees = {},
  jobOperationStepRecords = [],
  operationToJobId = {},
  title = "Issue Report"
}: IssuePDFProps) => {
  const sortedActionTasks = [...actionTasks].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
  );

  const ncType = nonConformanceTypes.find(
    (type) => type.id === nonConformance.nonConformanceTypeId
  );

  return (
    <Template
      title={title}
      meta={{
        author: meta?.author ?? "Carbon",
        keywords: meta?.keywords ?? "issue report",
        subject: meta?.subject ?? "Issue Report"
      }}
      footerLabel={`Issue #${nonConformance.nonConformanceId}`}
    >
      <Header
        company={company}
        title="Issue Report"
        documentId={nonConformance.nonConformanceId}
      />

      {/* Issue Details */}
      <View style={tw("border border-gray-200 mb-4")}>
        <View style={tw("flex flex-row")}>
          <View style={tw("w-1/2 p-3 border-r border-gray-200")}>
            <Text
              style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}
            >
              Issue Details
            </Text>
            <View style={tw("text-[10px] text-gray-800")}>
              {nonConformance.name && (
                <Text style={tw("font-bold")}>{nonConformance.name}</Text>
              )}
              {ncType?.name && (
                <Text style={tw("mt-1")}>Type: {ncType.name}</Text>
              )}
              {nonConformance.status && (
                <Text>Status: {nonConformance.status}</Text>
              )}
              <Text>
                Initiated By: {assignees[nonConformance.createdBy] || "Unknown"}
              </Text>
            </View>
          </View>
          <View style={tw("w-1/2 p-3")}>
            <Text
              style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}
            >
              Dates
            </Text>
            <View style={tw("text-[10px] text-gray-800")}>
              {nonConformance.openDate && (
                <Text>Started: {formatDate(nonConformance.openDate)}</Text>
              )}
              {nonConformance.closeDate && (
                <Text>Completed: {formatDate(nonConformance.closeDate)}</Text>
              )}
            </View>
          </View>
        </View>
      </View>

      {/* Associations */}
      {associations && (
        <View style={tw("border border-gray-200 mb-4")}>
          <View style={tw("p-3")}>
            <Text
              style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}
            >
              Associations
            </Text>
            <View style={tw("flex flex-col")}>
              {associations.items?.map((item: any) => (
                <View
                  key={item.id}
                  style={tw(
                    "flex flex-row gap-2 text-[10px] py-1 border-b border-gray-200"
                  )}
                >
                  <Text style={tw("w-1/4 font-bold text-gray-600")}>
                    Item:
                  </Text>
                  <Text style={tw("text-gray-800")}>
                    {item.documentReadableId}
                  </Text>
                  {item.disposition && (
                    <>
                      <Text style={tw("text-gray-400")}>-</Text>
                      <Text style={tw("text-gray-800")}>
                        {item.disposition}
                      </Text>
                    </>
                  )}
                  {item.quantity && (
                    <>
                      <Text style={tw("text-gray-400")}>-</Text>
                      <Text style={tw("text-gray-800")}>
                        Qty: {item.quantity}
                      </Text>
                    </>
                  )}
                </View>
              ))}
              {associations.customers?.map((customer: any) => (
                <View
                  key={customer.id}
                  style={tw(
                    "flex flex-row gap-2 text-[10px] py-1 border-b border-gray-200"
                  )}
                >
                  <Text style={tw("w-1/4 font-bold text-gray-600")}>
                    Customer:
                  </Text>
                  <Text style={tw("text-gray-800")}>
                    {customer.documentReadableId}
                  </Text>
                </View>
              ))}
              {associations.suppliers?.map((supplier: any) => (
                <View
                  key={supplier.id}
                  style={tw(
                    "flex flex-row gap-2 text-[10px] py-1 border-b border-gray-200"
                  )}
                >
                  <Text style={tw("w-1/4 font-bold text-gray-600")}>
                    Supplier:
                  </Text>
                  <Text style={tw("text-gray-800")}>
                    {supplier.documentReadableId}
                  </Text>
                </View>
              ))}
              {associations.jobOperations?.map((job: any) => (
                <View
                  key={job.id}
                  style={tw(
                    "flex flex-row gap-2 text-[10px] py-1 border-b border-gray-200"
                  )}
                >
                  <Text style={tw("w-1/4 font-bold text-gray-600")}>
                    Job Operation:
                  </Text>
                  <Text style={tw("text-gray-800")}>
                    {job.documentReadableId}
                  </Text>
                </View>
              ))}
              {associations.purchaseOrderLines?.map((po: any) => (
                <View
                  key={po.id}
                  style={tw(
                    "flex flex-row gap-2 text-[10px] py-1 border-b border-gray-200"
                  )}
                >
                  <Text style={tw("w-1/4 font-bold text-gray-600")}>
                    Purchase Order:
                  </Text>
                  <Text style={tw("text-gray-800")}>
                    {po.documentReadableId}
                  </Text>
                </View>
              ))}
              {associations.salesOrderLines?.map((so: any) => (
                <View
                  key={so.id}
                  style={tw(
                    "flex flex-row gap-2 text-[10px] py-1 border-b border-gray-200"
                  )}
                >
                  <Text style={tw("w-1/4 font-bold text-gray-600")}>
                    Sales Order:
                  </Text>
                  <Text style={tw("text-gray-800")}>
                    {so.documentReadableId}
                  </Text>
                </View>
              ))}
              {associations.shipmentLines?.map((shipment: any) => (
                <View
                  key={shipment.id}
                  style={tw(
                    "flex flex-row gap-2 text-[10px] py-1 border-b border-gray-200"
                  )}
                >
                  <Text style={tw("w-1/4 font-bold text-gray-600")}>
                    Shipment:
                  </Text>
                  <Text style={tw("text-gray-800")}>
                    {shipment.documentReadableId}
                  </Text>
                </View>
              ))}
              {associations.receiptLines?.map((receipt: any) => (
                <View
                  key={receipt.id}
                  style={tw(
                    "flex flex-row gap-2 text-[10px] py-1 border-b border-gray-200"
                  )}
                >
                  <Text style={tw("w-1/4 font-bold text-gray-600")}>
                    Receipt:
                  </Text>
                  <Text style={tw("text-gray-800")}>
                    {receipt.documentReadableId}
                  </Text>
                </View>
              ))}
              {associations.trackedEntities?.map((entity: any) => (
                <View
                  key={entity.id}
                  style={tw(
                    "flex flex-row gap-2 text-[10px] py-1 border-b border-gray-200"
                  )}
                >
                  <Text style={tw("w-1/4 font-bold text-gray-600")}>
                    Tracked Entity:
                  </Text>
                  <Text style={tw("text-gray-800")}>
                    {entity.documentReadableId}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      )}

      {/* Description of Issue */}
      {Object.keys(nonConformance.content ?? {}).length > 0 && (
        <View style={tw("border border-gray-200 mb-4")}>
          <View style={tw("p-3")}>
            <Text
              style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}
            >
              Description of Issue
            </Text>
            <View style={tw("mt-1")}>
              <Note content={nonConformance.content as JSONContent} />
            </View>
          </View>
        </View>
      )}

      {/* Action Tasks */}
      {sortedActionTasks.length > 0 && (
        <View style={tw("mb-4")}>
          {sortedActionTasks.map((task) => (
            <View
              key={task.id}
              style={tw("border border-gray-200 mb-4")}
              wrap={false}
            >
              <View style={tw("p-3")}>
                <Text
                  style={tw(
                    "text-[9px] font-bold text-gray-600 mb-1 uppercase"
                  )}
                >
                  {task.supplier?.name ? "Supplier " : ""}
                  {
                    requiredActions.find(
                      (action) => action.id === task.actionTypeId
                    )?.name
                  }
                </Text>
                <View style={tw("flex flex-col gap-1 text-[10px]")}>
                  {task.supplier?.name && (
                    <View style={tw("flex flex-row gap-2")}>
                      <Text style={tw("font-bold text-gray-600")}>
                        Supplier:
                      </Text>
                      <Text style={tw("text-gray-800")}>
                        {task.supplier.name}
                      </Text>
                    </View>
                  )}
                  {task.assignee && assignees[task.assignee] && (
                    <View style={tw("flex flex-row gap-2")}>
                      <Text style={tw("font-bold text-gray-600")}>
                        {task.supplier?.name ? "Verified by" : "Completed by"}:
                      </Text>
                      <Text style={tw("text-gray-800")}>
                        {assignees[task.assignee]}
                      </Text>
                    </View>
                  )}
                  {task.completedDate && (
                    <View style={tw("flex flex-row gap-2")}>
                      <Text style={tw("font-bold text-gray-600")}>
                        Completed on:
                      </Text>
                      <Text style={tw("text-gray-800")}>
                        {task.completedDate}
                      </Text>
                    </View>
                  )}
                </View>
                {Object.keys(task.notes ?? {}).length > 0 && (
                  <View style={tw("mt-2 pt-2 border-t border-gray-200")}>
                    <Note content={task.notes as JSONContent} />
                  </View>
                )}
                {/* Job Operation Step Records */}
                {jobOperationStepRecords
                  .filter((step) => step.nonConformanceActionId === task.id)
                  .some((step) =>
                    step.jobOperationStepRecord?.some(
                      (record) => record.booleanValue !== null
                    )
                  ) && (
                  <View style={tw("mt-2 pt-2 border-t border-gray-200")}>
                    <Text
                      style={tw(
                        "text-[9px] font-bold text-gray-600 mb-1 uppercase"
                      )}
                    >
                      Inspections
                    </Text>
                    {jobOperationStepRecords
                      .filter(
                        (step) => step.nonConformanceActionId === task.id
                      )
                      .map((step) =>
                        step.jobOperationStepRecord
                          ?.filter((record) => record.booleanValue !== null)
                          .map((record) => (
                            <View
                              key={record.id}
                              style={tw(
                                "flex flex-row gap-2 text-[10px] py-0.5"
                              )}
                            >
                              <View
                                style={{
                                  width: 10,
                                  height: 10,
                                  border: "1px solid #9ca3af",
                                  marginTop: 2,
                                  position: "relative"
                                }}
                              >
                                <Text
                                  style={{
                                    position: "absolute",
                                    fontSize: 10,
                                    fontWeight: "bold",
                                    lineHeight: 1,
                                    textAlign: "center",
                                    top: -3,
                                    left: -1.5
                                  }}
                                >
                                  {record.booleanValue ? "✓" : ""}
                                </Text>
                              </View>
                              <View style={tw("flex flex-col")}>
                                <Text style={tw("text-gray-800")}>
                                  {step.name}
                                </Text>
                                <Text
                                  style={tw(
                                    "text-[8px] text-gray-400 mt-0.5"
                                  )}
                                >
                                  {operationToJobId[step.operationId] && (
                                    <>
                                      Job{" "}
                                      {operationToJobId[step.operationId]} •{" "}
                                    </>
                                  )}
                                  {assignees[record.createdBy] || "Unknown"}{" "}
                                  •{" "}
                                  {
                                    new Date(record.createdAt)
                                      .toISOString()
                                      .split("T")[0]
                                  }
                                </Text>
                              </View>
                            </View>
                          ))
                      )}
                  </View>
                )}
              </View>
            </View>
          ))}
        </View>
      )}

      {/* MRB Reviewers */}
      {reviewers.length > 0 && (
        <View style={tw("border border-gray-200 mb-4")}>
          <View style={tw("p-3")}>
            <Text
              style={tw("text-[9px] font-bold text-gray-600 mb-2 uppercase")}
            >
              MRB
            </Text>
            {reviewers.map((reviewer, index) => (
              <View
                key={reviewer.id}
                style={tw(
                  `flex flex-col gap-1 py-2 ${
                    index < reviewers.length - 1
                      ? "border-b border-gray-200"
                      : ""
                  }`
                )}
              >
                <View style={tw("flex flex-row justify-between")}>
                  <Text style={tw("text-[10px] font-bold text-gray-800")}>
                    {reviewer.title}
                  </Text>
                  <Text style={tw("text-[10px] text-gray-600")}>
                    {reviewer.status}
                  </Text>
                </View>

                {Object.keys(reviewer.notes ?? {}).length > 0 && (
                  <View style={tw("mt-1")}>
                    <Note content={reviewer.notes as JSONContent} />
                  </View>
                )}
              </View>
            ))}
          </View>
        </View>
      )}
    </Template>
  );
};

export default IssuePDF;
