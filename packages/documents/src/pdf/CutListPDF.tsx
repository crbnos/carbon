import { Document, Page, Text, View } from "@react-pdf/renderer";
import { createTw } from "react-pdf-tailwind";
import type { PDF } from "../types";

const tw = createTw({
  theme: {
    fontFamily: { sans: ["Helvetica", "Arial", "sans-serif"] },
    extend: { colors: { gray: { 500: "#7d7d7d" } } }
  }
});

export interface CutListLineRow {
  id: string;
  itemReadableId?: string | null;
  description?: string | null;
  pieceLength: number;
  pieceWidth?: number | null;
  quantity: number;
  quantityCut: number;
  jobReadableId?: string | null;
}

export interface CutListPatternRow {
  id: string;
  sequence: number;
  stockReadableId?: string | null;
  lotReadableId?: string | null;
  stockLength?: number | null;
  expectedRemnant?: number | null;
  cuts: { pieceLength: number; itemReadableId?: string | null }[];
}

export interface CutListPDFProps extends PDF {
  cutList: {
    cutListId: string;
    status: string;
    processName?: string | null;
    locationName?: string | null;
    kerf: number;
    endTrim: number;
    gripMargin: number;
    minRemnantLength: number;
    unitOfDimension: string;
    plannedYieldPct?: number | null;
  };
  lines: CutListLineRow[];
  patterns: CutListPatternRow[];
}

const COL_ITEM = "w-4/12 text-left pr-4";
const COL_JOB = "w-2/12 text-left pr-4";
const COL_LENGTH = "w-2/12 text-right pr-4";
const COL_QTY = "w-2/12 text-right pr-4";
const COL_CUT = "w-2/12 text-right";

/**
 * The sheet the saw operator works from: what to cut, and — when the run has
 * been planned — the exact sequence per bar with a box to tick off each one.
 * Paper survives a shop floor that a tablet sometimes doesn't.
 */
const CutListPDF = ({
  company,
  cutList,
  lines,
  patterns,
  meta,
  title = "Cut List"
}: CutListPDFProps) => {
  const unit = cutList.unitOfDimension;

  return (
    <Document
      title={title}
      author={meta?.author ?? "Carbon"}
      keywords={meta?.keywords ?? "cut list, manufacturing"}
      subject={meta?.subject ?? "Cut List"}
    >
      <Page size="LETTER" style={tw("p-12 text-xs font-sans")}>
        <View
          style={tw(
            "flex flex-row justify-between items-start mb-6 pb-4 border-b border-gray-300"
          )}
        >
          <View>
            <Text style={tw("text-xl font-bold mb-1")}>
              {cutList.cutListId}
            </Text>
            <Text style={tw("text-gray-500")}>{company?.name ?? ""}</Text>
          </View>
          <View style={tw("text-right")}>
            <Text style={tw("font-bold mb-1")}>{cutList.status}</Text>
            {cutList.processName ? (
              <Text style={tw("text-gray-500")}>{cutList.processName}</Text>
            ) : null}
            {cutList.locationName ? (
              <Text style={tw("text-gray-500")}>{cutList.locationName}</Text>
            ) : null}
          </View>
        </View>

        <View style={tw("flex flex-row mb-6 gap-8")}>
          <View>
            <Text style={tw("text-gray-500 uppercase text-[8px] mb-1")}>
              Kerf
            </Text>
            <Text>
              {cutList.kerf} {unit}
            </Text>
          </View>
          <View>
            <Text style={tw("text-gray-500 uppercase text-[8px] mb-1")}>
              End trim
            </Text>
            <Text>
              {cutList.endTrim} {unit}
            </Text>
          </View>
          <View>
            <Text style={tw("text-gray-500 uppercase text-[8px] mb-1")}>
              Grip margin
            </Text>
            <Text>
              {cutList.gripMargin} {unit}
            </Text>
          </View>
          <View>
            <Text style={tw("text-gray-500 uppercase text-[8px] mb-1")}>
              Min drop
            </Text>
            <Text>
              {cutList.minRemnantLength} {unit}
            </Text>
          </View>
          {cutList.plannedYieldPct !== null &&
          cutList.plannedYieldPct !== undefined ? (
            <View>
              <Text style={tw("text-gray-500 uppercase text-[8px] mb-1")}>
                Planned yield
              </Text>
              <Text>{Number(cutList.plannedYieldPct).toFixed(1)}%</Text>
            </View>
          ) : null}
        </View>

        <Text style={tw("font-bold uppercase text-[9px] mb-2")}>Pieces</Text>
        <View
          style={tw(
            "flex flex-row justify-between items-center py-2 px-[6px] border-t border-b border-gray-300 font-bold uppercase text-[8px]"
          )}
        >
          <Text style={tw(COL_ITEM)}>Material</Text>
          <Text style={tw(COL_JOB)}>Job</Text>
          <Text style={tw(COL_LENGTH)}>Length</Text>
          <Text style={tw(COL_QTY)}>Pieces</Text>
          <Text style={tw(COL_CUT)}>Cut</Text>
        </View>
        {lines.map((line) => (
          <View
            key={line.id}
            style={tw(
              "flex flex-row justify-between items-start border-b border-gray-300 py-2 px-[6px]"
            )}
            wrap={false}
          >
            <View style={tw(COL_ITEM)}>
              <Text style={tw("font-bold")}>{line.itemReadableId ?? ""}</Text>
              {line.description ? (
                <Text style={tw("text-gray-500")}>{line.description}</Text>
              ) : null}
            </View>
            <Text style={tw(COL_JOB)}>{line.jobReadableId ?? "—"}</Text>
            <Text style={tw(COL_LENGTH)}>
              {line.pieceLength}
              {line.pieceWidth ? ` x ${line.pieceWidth}` : ""} {unit}
            </Text>
            <Text style={tw(COL_QTY)}>{line.quantity}</Text>
            <Text style={tw(COL_CUT)}>{line.quantityCut}</Text>
          </View>
        ))}

        {patterns.length > 0 ? (
          <View style={tw("mt-8")} break={patterns.length > 6}>
            <Text style={tw("font-bold uppercase text-[9px] mb-2")}>
              Cut plan
            </Text>
            {patterns.map((pattern) => (
              <View
                key={pattern.id}
                style={tw("mb-4 border border-gray-300 rounded p-3")}
                wrap={false}
              >
                <View
                  style={tw("flex flex-row justify-between items-center mb-2")}
                >
                  <Text style={tw("font-bold")}>
                    #{pattern.sequence} {pattern.stockReadableId ?? ""}
                    {pattern.lotReadableId
                      ? `  ·  Lot ${pattern.lotReadableId}`
                      : ""}
                  </Text>
                  <Text style={tw("text-gray-500")}>
                    {pattern.stockLength ?? ""} {unit}
                  </Text>
                </View>
                {pattern.cuts.map((cut, index) => (
                  <View
                    key={`${pattern.id}-${index}`}
                    style={tw("flex flex-row items-center py-[2px]")}
                  >
                    <View
                      style={tw(
                        "w-3 h-3 border border-gray-500 rounded-sm mr-2"
                      )}
                    />
                    <Text style={tw("w-8")}>{index + 1}.</Text>
                    <Text style={tw("w-24 font-bold")}>
                      {cut.pieceLength} {unit}
                    </Text>
                    <Text style={tw("text-gray-500")}>
                      {cut.itemReadableId ?? ""}
                    </Text>
                  </View>
                ))}
                <Text style={tw("mt-2 text-gray-500")}>
                  Expected drop: {pattern.expectedRemnant ?? 0} {unit}
                  {"        "}Actual drop: ______ {unit}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </Page>
    </Document>
  );
};

export default CutListPDF;
