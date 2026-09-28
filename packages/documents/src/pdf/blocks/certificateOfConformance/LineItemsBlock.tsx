import { Text, View } from "@react-pdf/renderer";
import {
  DEFAULT_LINE_ITEMS_OPTIONS,
  type LineItemsBlock as LineItemsBlockType
} from "../../../template";
import { itemTextOverflowStyle } from "../itemText";
import { useTw } from "../tw";
import { NONE, NOT_APPLICABLE } from "./Field";
import type { CertificateOfConformanceData } from "./types";

const COLUMNS = {
  itemNumber: "w-[16%]",
  quantity: "w-[10%]",
  description: "w-[22%]",
  revision: "w-[11%]",
  traceability: "w-[24%]",
  remarks: "w-[17%]"
} as const;

/** Fields 7–12, one row per shipped line. */
export function LineItemsBlock({
  block,
  data
}: {
  block: LineItemsBlockType;
  data: CertificateOfConformanceData;
}) {
  const tw = useTw();
  const { lines, theme } = data;
  const opts = { ...DEFAULT_LINE_ITEMS_OPTIONS, ...block.options };
  const overflow = itemTextOverflowStyle(opts);

  return (
    <View style={tw("mb-4")}>
      {/* Header row — repeats on every page the table spans. */}
      <View
        fixed
        style={[
          tw("flex flex-row py-2 px-3 text-[8px] font-bold"),
          { backgroundColor: theme.accent, color: theme.accentForeground }
        ]}
      >
        <Text style={tw(`${COLUMNS.itemNumber} pr-2`)}>7 Item Number</Text>
        <Text style={tw(`${COLUMNS.quantity} pr-2`)}>8 Quantity</Text>
        <Text style={tw(`${COLUMNS.description} pr-2`)}>9 Description</Text>
        <Text style={tw(`${COLUMNS.revision} pr-2`)}>10 Revision</Text>
        <Text style={tw(`${COLUMNS.traceability} pr-2`)}>11 Traceability</Text>
        <Text style={tw(COLUMNS.remarks)}>12 Remarks</Text>
      </View>

      {lines.length === 0 ? (
        <View
          style={tw(
            "flex flex-row py-2 px-3 border-b border-gray-200 text-[10px]"
          )}
          wrap={false}
        >
          <Text style={tw("text-gray-800")}>{NOT_APPLICABLE}</Text>
        </View>
      ) : (
        lines.map((line, index) => {
          const rowBg =
            !opts.zebra || index % 2 === 0 ? "bg-white" : "bg-gray-50";
          return (
            <View
              key={index}
              style={tw(
                `flex flex-row py-2 px-3 border-b border-gray-200 text-[9px] text-gray-800 ${rowBg}`
              )}
              wrap={false}
            >
              <Text
                style={{ ...tw(`${COLUMNS.itemNumber} pr-2`), ...overflow }}
              >
                {line.itemNumber || NOT_APPLICABLE}
              </Text>
              <Text style={tw(`${COLUMNS.quantity} pr-2`)}>
                {line.quantity || NOT_APPLICABLE}
              </Text>
              <Text
                style={{ ...tw(`${COLUMNS.description} pr-2`), ...overflow }}
              >
                {line.description || NOT_APPLICABLE}
              </Text>
              <Text style={tw(`${COLUMNS.revision} pr-2`)}>
                {line.revision || NOT_APPLICABLE}
              </Text>
              <View style={tw(`${COLUMNS.traceability} pr-2 flex flex-col`)}>
                {line.traceability.length === 0 ? (
                  <Text>{NOT_APPLICABLE}</Text>
                ) : (
                  line.traceability.map((entry) => (
                    <Text key={entry.id}>
                      {entry.quantity
                        ? `${entry.id} (${entry.quantity})`
                        : entry.id}
                    </Text>
                  ))
                )}
              </View>
              <Text style={tw(COLUMNS.remarks)}>{line.remarks || NONE}</Text>
            </View>
          );
        })
      )}
    </View>
  );
}
