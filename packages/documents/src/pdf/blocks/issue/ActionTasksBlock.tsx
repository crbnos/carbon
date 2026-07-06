import type { JSONContent } from "@carbon/react";
import { Text, View } from "@react-pdf/renderer";
import { Note } from "../../components";
import { useTw } from "../tw";
import type { IssueData } from "./types";

/** Repeating action-task blocks, each with optional nested inspections. */
export function ActionTasksBlock({ data }: { data: IssueData }) {
  const tw = useTw();
  const {
    actionTasks,
    requiredActions,
    assignees,
    jobOperationStepRecords,
    operationToJobId
  } = data;

  const sortedActionTasks = [...actionTasks].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
  );

  if (sortedActionTasks.length === 0) return null;

  return (
    <View style={tw("mb-4")}>
      {sortedActionTasks.map((task) => (
        <View
          key={task.id}
          style={tw("border border-gray-200 mb-4")}
          wrap={false}
        >
          <View style={tw("p-3")}>
            <Text
              style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}
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
                  <Text style={tw("font-bold text-gray-600")}>Supplier:</Text>
                  <Text style={tw("text-gray-800")}>{task.supplier.name}</Text>
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
                  <Text style={tw("text-gray-800")}>{task.completedDate}</Text>
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
                  .filter((step) => step.nonConformanceActionId === task.id)
                  .map((step) =>
                    step.jobOperationStepRecord
                      ?.filter((record) => record.booleanValue !== null)
                      .map((record) => (
                        <View
                          key={record.id}
                          style={tw("flex flex-row gap-2 text-[10px] py-0.5")}
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
                            <Text style={tw("text-gray-800")}>{step.name}</Text>
                            <Text style={tw("text-[8px] text-gray-400 mt-0.5")}>
                              {operationToJobId[step.operationId] && (
                                <>Job {operationToJobId[step.operationId]} • </>
                              )}
                              {assignees[record.createdBy] || "Unknown"} •{" "}
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
  );
}
