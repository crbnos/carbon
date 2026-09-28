import { Text, View } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import { useTw } from "../tw";

/** Printed when an AS9163 header/line field has no value (9163 §5.2). */
export const NOT_APPLICABLE = "N/A";
/** Printed when a field-13 group or a remark has nothing to report. */
export const NONE = "None";

/** "4 Organization Name and Address" — the numbered AS9163 field caption. */
export function FieldLabel({
  number,
  label
}: {
  number: number;
  label: string;
}) {
  const tw = useTw();
  return (
    <Text style={tw("text-[8px] font-bold text-gray-600 mb-1 uppercase")}>
      {`${number} ${label}`}
    </Text>
  );
}

/** A bordered cell holding one numbered field. */
export function FieldCell({
  number,
  label,
  children,
  style
}: {
  number: number;
  label: string;
  children: ReactNode;
  style?: string;
}) {
  const tw = useTw();
  return (
    <View style={tw(`p-3 ${style ?? ""}`)}>
      <FieldLabel number={number} label={label} />
      <View style={tw("text-[10px] text-gray-800")}>{children}</View>
    </View>
  );
}
