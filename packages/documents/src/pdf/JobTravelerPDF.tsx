import bwipjs from "@bwip-js/node";
import type { Database } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
import { Image, Text, View } from "@react-pdf/renderer";
import { createTw } from "react-pdf-tailwind";
import type { PDF } from "../types";
import { Header, Note, Template } from "./components";

interface JobTravelerProps extends PDF {
  job: Database["public"]["Views"]["jobs"]["Row"];
  jobMakeMethod: Database["public"]["Tables"]["jobMakeMethod"]["Row"];
  jobOperations: Database["public"]["Tables"]["jobOperation"]["Row"][];
  customer: Database["public"]["Tables"]["customer"]["Row"] | null;
  item: Database["public"]["Tables"]["item"]["Row"];
  batchNumber: string | undefined;
  notes?: JSONContent;
}

function getStartPath(operationId: string) {
  return `https://mes.carbonos.dev/x/start/${operationId}`;
}

function getEndPath(operationId: string) {
  return `https://mes.carbonos.dev/x/end/${operationId}`;
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
        {/* Header Section - Always at the top */}
        <View style={tw("mb-6")}>
          <Header
            title={job.jobId}
            subtitle={subtitle}
            tertiaryTitle={tertiaryTitle}
            company={company}
          />
          {/* Subheader with Make Method Information */}
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

          {jobOperations.map((operation, index) => {
            const setupQrCode =
              operation.setupTime > 0
                ? generateQRCode(`${getStartPath(operation.id)}?type=Setup`)
                : null;
            let laborQrCode =
              operation.laborTime > 0
                ? generateQRCode(`${getStartPath(operation.id)}?type=Labor`)
                : null;
            let machiningQrCode =
              operation.machineTime > 0
                ? generateQRCode(`${getStartPath(operation.id)}?type=Machine`)
                : null;
            let completeQrCode = generateQRCode(getEndPath(operation.id));

            if (
              setupQrCode === null &&
              laborQrCode === null &&
              machiningQrCode === null
            ) {
              laborQrCode = generateQRCode(
                `${getStartPath(operation.id)}?type=Labor`
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
                    <Text style={tw("font-bold")}>{operation.description}</Text>
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

async function generateQRCode(text: string): Promise<string> {
  const buffer = await bwipjs.toBuffer({
    bcid: "qrcode",
    text,
    scale: 2,
    height: 10,
    width: 10,
  });
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

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
