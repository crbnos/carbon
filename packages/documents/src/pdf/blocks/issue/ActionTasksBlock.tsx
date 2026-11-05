// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { JSONContent } from "@carbon/react";
import { Text, View } from "@react-pdf/renderer";
import { type DocumentBlock, issueTexts, makeText } from "../../../template";
import { Note } from "../../components";
import { useTw } from "../tw";
import type { ActionTask, IssueData } from "./types";
import { buildIssueInspectionVars, buildIssueTaskVars } from "./vars";

/** A supplier's task is verified by its assignee; any other is completed by them. */
function assigneeTexts(task: ActionTask) {
  return task.supplier?.name
    ? ({ label: "verifiedBy", value: "verifiedByValue" } as const)
    : ({ label: "completedBy", value: "completedByValue" } as const);
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
  const { actionTasks, jobOperationStepRecords } = data;

  const sortedActionTasks = [...actionTasks].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
  );

  if (sortedActionTasks.length === 0) return null;

  /** A label beside its value; nothing when the label is hidden or the value empty. */
  const labelled = (
    label: "supplier" | "verifiedBy" | "completedBy" | "completedOn",
    value:
      | "supplierValue"
      | "verifiedByValue"
      | "completedByValue"
      | "completedOnValue",
    row: Record<string, string>
  ) =>
    t.prints(value, row) ? (
      <View style={tw("flex flex-row gap-2")}>
        <Text style={tw("font-bold text-gray-600")}>{t(label)}</Text>
        <Text style={tw("text-gray-800")}>{t(value, row)}</Text>
      </View>
    ) : null;

  return (
    <View style={tw("mb-4")}>
      {sortedActionTasks.map((task) => {
        const row = data.values.row(
          "task",
          task.id,
          buildIssueTaskVars(task, data)
        );
        const assignee = assigneeTexts(task);
        return (
          <View
            key={task.id}
            style={tw("border border-gray-200 mb-4")}
            wrap={false}
          >
            <View style={tw("p-3")}>
              <Text
                style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}
              >
                {task.supplier?.name && t("supplierPrefix")
                  ? `${t("supplierPrefix")} `
                  : ""}
                {t("actionName", row)}
              </Text>
              <View style={tw("flex flex-col gap-1 text-[10px]")}>
                {labelled("supplier", "supplierValue", row)}
                {labelled(assignee.label, assignee.value, row)}
                {labelled("completedOn", "completedOnValue", row)}
              </View>
              {Object.keys(task.notes ?? {}).length > 0 ? (
                <View style={tw("mt-2 pt-2 border-t border-gray-200")}>
                  <Note content={task.notes as JSONContent} />
                </View>
              ) : null}
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
                        .map((record) => {
                          const inspection = data.values.row(
                            "inspection",
                            record.id,
                            buildIssueInspectionVars(
                              step,
                              record,
                              data,
                              t("unknown")
                            )
                          );
                          return (
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
                                  {t("stepCell", inspection)}
                                </Text>
                                <Text
                                  style={tw("text-[8px] text-gray-400 mt-0.5")}
                                >
                                  {t.prints("job", inspection)
                                    ? `${t("job", inspection)} `
                                    : ""}
                                  {t("recordCell", inspection)}
                                </Text>
                              </View>
                            </View>
                          );
                        })
                    )}
                </View>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}
