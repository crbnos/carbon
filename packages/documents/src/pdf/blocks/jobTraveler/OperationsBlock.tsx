// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getMESUrl } from "@carbon/env";
import type { JSONContent } from "@carbon/react";
import { formatFactor } from "@carbon/utils";
import { Image, Text, View } from "@react-pdf/renderer";
import { generateQRCode } from "../../../qr/qr-code";
import type { OperationsBlock as OperationsBlockType } from "../../../template";
import { Note } from "../../components";
import { breakLongNotesWord } from "../../notesText";
import { tw } from "./tw";
import type { JobOperationWithSteps, JobTravelerData } from "./types";

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

/**
 * The sequence number printed for an operation. One that runs With Previous
 * shares the number of the operation it runs with.
 */
function getParallelizedOrder(
  index: number,
  item: JobOperationWithSteps,
  items: JobOperationWithSteps[]
) {
  if (item?.operationOrder !== "With Previous") return index + 1;
  // traverse backwards to find the first non-"With Previous" item.
  for (let i = index - 1; i >= 0; i--) {
    if (items[i]?.operationOrder !== "With Previous") {
      return i + 1;
    }
  }
  return 1;
}

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

  return (
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

          const setupTimeFormatted = formatFactor(
            operation.setupTime,
            operation.setupUnit
          );
          const laborTimeFormatted = formatFactor(
            operation.laborTime,
            operation.laborUnit
          );
          const machineTimeFormatted = formatFactor(
            operation.machineTime,
            operation.machineUnit
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
              wrap={includeWorkInstructions || Boolean(batchNotes)}
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
                    <Text style={tw("font-bold")}>{operation.description}</Text>
                  </View>
                  <View style={tw("w-3/12 text-left")}>
                    {hasExpectedTimes ? (
                      <View style={tw("flex flex-col gap-1")}>
                        {setupTimeFormatted ? (
                          <Text style={tw("text-[10px]")}>
                            Setup: {setupTimeFormatted}
                          </Text>
                        ) : null}
                        {laborTimeFormatted ? (
                          <Text style={tw("text-[10px]")}>
                            Labor: {laborTimeFormatted}
                          </Text>
                        ) : null}
                        {machineTimeFormatted ? (
                          <Text style={tw("text-[10px]")}>
                            Machine: {machineTimeFormatted}
                          </Text>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                </View>

                <View
                  style={tw(
                    "flex flex-row justify-between items-center py-3 px-[6px] border-gray-300 font-bold uppercase page-break-inside-avoid"
                  )}
                >
                  <Text style={tw("text-left pr-4")}>
                    {batch ? `Batch ${batch.readableId}` : "Actions"}
                  </Text>
                </View>

                <View style={tw("w-full flex flex-row justify-start gap-2")}>
                  {openQrCode ? (
                    <View style={tw("flex flex-col items-center w-1/4")}>
                      <Image src={openQrCode} style={tw("w-16 h-16")} />
                      <Text style={tw("text-[10px] mt-1")}>Open in MES</Text>
                    </View>
                  ) : null}
                  {batch ? (
                    <Text style={tw("w-3/4 self-center text-[10px]")}>
                      This operation runs with other jobs as one batch. Start
                      and complete it from the batch in MES.
                    </Text>
                  ) : null}
                  {isInside && setupQrCode ? (
                    <View style={tw("flex flex-col items-center w-1/4")}>
                      <>
                        <Image src={setupQrCode} style={tw("w-16 h-16")} />
                        <Text style={tw("text-[10px] mt-1")}>Setup</Text>
                      </>
                    </View>
                  ) : null}

                  {isInside && laborQrCode ? (
                    <View style={tw("flex flex-col items-center w-1/4")}>
                      <>
                        <Image src={laborQrCode} style={tw("w-16 h-16")} />
                        <Text style={tw("text-[10px] mt-1")}>Labor</Text>
                      </>
                    </View>
                  ) : null}
                  {isInside && machiningQrCode ? (
                    <View style={tw("flex flex-col items-center w-1/4")}>
                      <>
                        <Image src={machiningQrCode} style={tw("w-16 h-16")} />
                        <Text style={tw("text-[10px] mt-1")}>Machine</Text>
                      </>
                    </View>
                  ) : null}
                  {completeQrCode ? (
                    <View style={tw("flex flex-col items-center w-1/4")}>
                      <Image src={completeQrCode} style={tw("w-16 h-16")} />
                      <Text style={tw("text-[10px] mt-1")}>Complete</Text>
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
                    <Text style={SUB_SECTION_TITLE}>Batch Notes</Text>
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
                      <Text style={SUB_SECTION_TITLE}>Procedure Steps</Text>
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
                                {hasStepDescription ? (
                                  <Note
                                    title="Procedure Step"
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
                    <Note title="Work Instructions" content={workInstruction} />
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        })}
    </View>
  );
}
