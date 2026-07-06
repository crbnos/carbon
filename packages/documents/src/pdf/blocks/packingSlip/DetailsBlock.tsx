import { Text, View } from "@react-pdf/renderer";
import { useTw } from "../tw";
import type { PackingSlipData } from "./types";

/** Shipping method + Payment terms box. */
export function DetailsBlock({ data }: { data: PackingSlipData }) {
  const tw = useTw();
  const { shippingMethod, paymentTerm } = data;

  return (
    <View style={tw("border border-gray-200 mb-4")}>
      <View style={tw("flex flex-row")}>
        <View style={tw("w-1/2 p-3 border-r border-gray-200")}>
          <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
            Shipping
          </Text>
          <View style={tw("text-[10px] text-gray-800")}>
            {shippingMethod?.name && <Text>Method: {shippingMethod.name}</Text>}
          </View>
        </View>
        <View style={tw("w-1/2 p-3")}>
          <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
            Payment
          </Text>
          <View style={tw("text-[10px] text-gray-800")}>
            {paymentTerm?.name && <Text>Terms: {paymentTerm.name}</Text>}
          </View>
        </View>
      </View>
    </View>
  );
}
