// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { JSONContent } from "@carbon/react";
import { Text, View } from "@react-pdf/renderer";
import { type DocumentBlock, issueTexts, makeText } from "../../../template";
import { Note } from "../../components";
import { useTw } from "../tw";
import type { ActionTask, IssueData } from "./types";

/** A supplier's task is verified by its assignee; any other is completed by them. */
function assigneeKey(task: ActionTask) {
  return task.supplier?.name ? "verifiedBy" : "completedBy";
}

/** Repeating action-task blocks, each with optional nested inspections. */
export function ActionTasksBlock({
  block,
  data
}: {
  block: DocumentBlock;
  data: IssueData;
}) {
  const tw = useTw();
  const t = makeText(issueTexts.actionTasks, block, data.vars);
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
              {task.supplier?.name ? t("supplierPrefix") : ""}
              {
                requiredActions.find(
                  (action) => action.id === task.actionTypeId
                )?.name
              }
            </Text>
            <View style={tw("flex flex-col gap-1 text-[10px]")}>
              {t.shows("supplier") && task.supplier?.name ? (
                <View style={tw("flex flex-row gap-2")}>
                  <Text style={tw("font-bold text-gray-600")}>
                    {t("supplier")}
                  </Text>
                  <Text style={tw("text-gray-800")}>{task.supplier.name}</Text>
                </View>
              ) : null}
              {t.shows(assigneeKey(task)) &&
              task.assignee &&
              assignees[task.assignee] ? (
                <View style={tw("flex flex-row gap-2")}>
                  <Text style={tw("font-bold text-gray-600")}>
                    {t(assigneeKey(task))}
                  </Text>
                  <Text style={tw("text-gray-800")}>
                    {assignees[task.assignee]}
                  </Text>
                </View>
              ) : null}
              {t.shows("completedOn") && task.completedDate ? (
                <View style={tw("flex flex-row gap-2")}>
                  <Text style={tw("font-bold text-gray-600")}>
                    {t("completedOn")}
                  </Text>
                  <Text style={tw("text-gray-800")}>{task.completedDate}</Text>
                </View>
              ) : null}
            </View>
            {Object.keys(task.notes ?? {}).length > 0 ? (
              <View style={tw("mt-2 pt-2 border-t border-gray-200")}>
                <Note content={task.notes as JSONContent} />
              </View>
            ) : null}
            {/* Job Operation Step Records */}
            {jobOperationStepRecords
              .filter((step) => step.nonConformanceActionId === task.id)
              .some((step) =>
                step.jobOperationStepRecord?.some(
                  (record) => record.booleanValue !== null
                )
              ) ? (
              <View style={tw("mt-2 pt-2 border-t border-gray-200")}>
                <Text
                  style={tw(
                    "text-[9px] font-bold text-gray-600 mb-1 uppercase"
                  )}
                >
                  {t("inspections")}
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
                              {operationToJobId[step.operationId] ? (
                                <>
                                  {t("job")}{" "}
                                  {operationToJobId[step.operationId]} •{" "}
                                </>
                              ) : null}
                              {assignees[record.createdBy] || t("unknown")} •{" "}
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
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}
