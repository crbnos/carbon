// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getMESUrl } from "@carbon/env";
import type { JSONContent } from "@carbon/react";
import { Image, Text, View } from "@react-pdf/renderer";
import { generateQRCode } from "../../../qr/qr-code";
import {
  jobTravelerTexts,
  makeText,
  type OperationsBlock as OperationsBlockType
} from "../../../template";
import { Note } from "../../components";
import { breakLongNotesWord } from "../../notesText";
import { Cell, TextCell } from "../Cell";
import { columnWidths } from "../columns";
import { tw } from "./tw";
import type { JobTravelerData } from "./types";
import {
  buildJobTravelerOperationVars,
  buildJobTravelerStepVars
} from "./vars";

/** Starts a timer on the operation in MES; `?type=` picks Setup, Labor or Machine. */
function getStartPath(operationId: string) {
  return `${getMESUrl()}/x/start/${operationId}`;
}

/** Records completed quantity on the operation in MES, finishing it at its target. */
function getEndPath(operationId: string) {
  return `${getMESUrl()}/x/end/${operationId}`;
}

/**
 * Opens the operation without starting anything. The MES decides from the
 * live membership whether it runs in a batch, so the code stays right when
 * the job leaves the batch after this page is printed.
 */
function getOperationPath(operationId: string) {
  return `${getMESUrl()}/x/operation/${operationId}`;
}

// The ruled uppercase title over a sub-section of an operation row.
const SUB_SECTION_TITLE = {
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
} as const;

/** Routing table: seq, operation, expected times, QR actions, steps, work instructions. */
export function OperationsBlock({
  block,
  data
}: {
  block: OperationsBlockType;
  data: JobTravelerData;
}) {
  const { jobOperations } = data;
  const includeWorkInstructions = block.showWorkInstructions ?? false;
  const t = makeText(jobTravelerTexts.operations, block, data.vars);
  const w = columnWidths(
    [
      { key: "seq", width: 100 / 12 },
      { key: "operation", width: 800 / 12 },
      { key: "expectedTimes", width: 25 }
    ],
    t.shows,
    "operation"
  );

  return (
    <View style={tw("mb-6 text-xs")}>
      <View
        style={tw(
          "flex flex-row justify-between items-center py-3 px-[6px] border-t border-b border-gray-300 font-bold uppercase page-break-inside-avoid gap-x-6"
        )}
      >
        <TextCell width={w.seq} style={tw("text-left")}>
          {t("seq")}
        </TextCell>
        <TextCell width={w.operation} style={tw("text-left")}>
          {t("operation")}
        </TextCell>
        <TextCell width={w.expectedTimes} style={tw("text-left")}>
          {t("expectedTimes")}
        </TextCell>
      </View>

      {jobOperations
        .sort((a, b) => a.order - b.order)
        .map((operation, index) => {
          const row = data.values.row(
            "operation",
            operation.id,
            buildJobTravelerOperationVars(operation, index + 1, data)
          );
          const isInside = operation.operationType !== "Outside Processing";
          // A batched operation runs on the batch's shared timer and is
          // completed with the whole batch, so its row gets no start or
          // complete codes: those would time and complete this job alone.
          const batch = operation.jobOperationBatch ?? null;
          const batchNotes = batch?.notes?.trim() ? batch.notes : null;
          const openQrCode = batch
            ? () => generateQRCode(getOperationPath(operation.id), 10)
            : null;
          const setupQrCode =
            !batch && operation.setupTime > 0
              ? generateQRCode(`${getStartPath(operation.id)}?type=Setup`, 10)
              : null;
          let laborQrCode =
            !batch && operation.laborTime > 0
              ? generateQRCode(`${getStartPath(operation.id)}?type=Labor`, 10)
              : null;
          const machiningQrCode =
            !batch && operation.machineTime > 0
              ? generateQRCode(`${getStartPath(operation.id)}?type=Machine`, 10)
              : null;
          const completeQrCode = batch
            ? null
            : generateQRCode(getEndPath(operation.id), 10);

          if (
            !batch &&
            setupQrCode === null &&
            laborQrCode === null &&
            machiningQrCode === null
          ) {
            laborQrCode = generateQRCode(
              `${getStartPath(operation.id)}?type=Labor`,
              10
            );
          }

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
              wrap={includeWorkInstructions || Boolean(batchNotes)}
            >
              <View style={tw("flex flex-col gap-y-4")} wrap={false}>
                <View
                  style={tw(
                    "flex flex-row justify-between items-start gap-x-6"
                  )}
                  wrap={false}
                >
                  <TextCell width={w.seq} style={tw("font-bold text-left")}>
                    {t("seqCell", row)}
                  </TextCell>
                  <Cell width={w.operation} style={tw("text-left text-[12px]")}>
                    <Text style={tw("font-bold")}>
                      {t("operationCell", row)}
                    </Text>
                  </Cell>
                  <Cell width={w.expectedTimes} style={tw("text-left")}>
                    <View style={tw("flex flex-col gap-1")}>
                      {t.prints("expectedSetup", row) ? (
                        <Text style={tw("text-[10px]")}>
                          {t("expectedSetup", row)}
                        </Text>
                      ) : null}
                      {t.prints("expectedLabor", row) ? (
                        <Text style={tw("text-[10px]")}>
                          {t("expectedLabor", row)}
                        </Text>
                      ) : null}
                      {t.prints("expectedMachine", row) ? (
                        <Text style={tw("text-[10px]")}>
                          {t("expectedMachine", row)}
                        </Text>
                      ) : null}
                    </View>
                  </Cell>
                </View>

                <View
                  style={tw(
                    "flex flex-row justify-between items-center py-3 px-[6px] border-gray-300 font-bold uppercase page-break-inside-avoid"
                  )}
                >
                  <Text style={tw("text-left pr-4")}>
                    {batch
                      ? `${t("batch")} ${t("batchValue", row)}`.trim()
                      : t("actions")}
                  </Text>
                </View>

                <View style={tw("w-full flex flex-row justify-start gap-2")}>
                  {openQrCode ? (
                    <View style={tw("flex flex-col items-center w-1/4")}>
                      <Image src={openQrCode} style={tw("w-16 h-16")} />
                      <Text style={tw("text-[10px] mt-1")}>
                        {t("openInMes")}
                      </Text>
                    </View>
                  ) : null}
                  {batch ? (
                    <Text style={tw("w-3/4 self-center text-[10px]")}>
                      {t("batchInstructions")}
                    </Text>
                  ) : null}
                  {isInside && setupQrCode ? (
                    <View style={tw("flex flex-col items-center w-1/4")}>
                      <>
                        <Image src={setupQrCode} style={tw("w-16 h-16")} />
                        <Text style={tw("text-[10px] mt-1")}>
                          {t("actionSetup")}
                        </Text>
                      </>
                    </View>
                  ) : null}

                  {isInside && laborQrCode ? (
                    <View style={tw("flex flex-col items-center w-1/4")}>
                      <>
                        <Image src={laborQrCode} style={tw("w-16 h-16")} />
                        <Text style={tw("text-[10px] mt-1")}>
                          {t("actionLabor")}
                        </Text>
                      </>
                    </View>
                  ) : null}
                  {isInside && machiningQrCode ? (
                    <View style={tw("flex flex-col items-center w-1/4")}>
                      <>
                        <Image src={machiningQrCode} style={tw("w-16 h-16")} />
                        <Text style={tw("text-[10px] mt-1")}>
                          {t("actionMachine")}
                        </Text>
                      </>
                    </View>
                  ) : null}
                  {completeQrCode ? (
                    <View style={tw("flex flex-col items-center w-1/4")}>
                      <Image src={completeQrCode} style={tw("w-16 h-16")} />
                      <Text style={tw("text-[10px] mt-1")}>
                        {t("complete")}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>

              {/* The planner's notes from the batch builder: plain text, so
                  line breaks print as typed. First, as in the MES. They take
                  the batch row's columns: nothing under the QR code, then the
                  same left and right edges as the sentence beside it. */}
              {batchNotes ? (
                <View
                  style={tw(
                    "w-full flex flex-row justify-start gap-2 mt-2 mb-2"
                  )}
                >
                  <View style={tw("w-1/4")} />
                  <View style={tw("w-3/4")}>
                    <Text style={SUB_SECTION_TITLE}>{t("batchNotes")}</Text>
                    <Text
                      style={tw("text-[9px]")}
                      hyphenationCallback={breakLongNotesWord}
                    >
                      {batchNotes}
                    </Text>
                  </View>
                </View>
              ) : null}

              {hasWorkInstruction || hasProcedureSteps ? (
                <View style={tw("mt-2 ml-8")}>
                  {hasProcedureSteps ? (
                    <View style={tw("mb-2")}>
                      <Text style={SUB_SECTION_TITLE}>
                        {t("procedureSteps")}
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
                                  {t(
                                    "stepNameCell",
                                    data.values.row(
                                      "step",
                                      step.id,
                                      buildJobTravelerStepVars(step)
                                    )
                                  )}
                                </Text>
                                {hasStepDescription ? (
                                  <Note
                                    title={t("procedureStep")}
                                    content={stepDescription}
                                  />
                                ) : null}
                              </View>
                            </View>
                          );
                        })}
                    </View>
                  ) : null}
                  {hasWorkInstruction ? (
                    <Note
                      title={t("workInstructions")}
                      content={workInstruction}
                    />
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        })}
    </View>
  );
}
