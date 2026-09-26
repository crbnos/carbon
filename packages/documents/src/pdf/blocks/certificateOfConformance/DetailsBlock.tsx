import { Text, View } from "@react-pdf/renderer";
import { useTw } from "../tw";
import { FieldCell, NOT_APPLICABLE } from "./Field";
import type { CertificateOfConformanceData } from "./types";

/** Field 6 (Purchase Order Number). */
export function DetailsBlock({ data }: { data: CertificateOfConformanceData }) {
  const tw = useTw();

  return (
    <View style={tw("border border-gray-200 mb-4")}>
      <FieldCell number={6} label="Purchase Order Number">
        <Text>{data.purchaseOrderNumber || NOT_APPLICABLE}</Text>
      </FieldCell>
    </View>
  );
}
