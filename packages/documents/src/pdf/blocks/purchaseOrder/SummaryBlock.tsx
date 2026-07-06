import { Text, View } from "@react-pdf/renderer";
import type { SummaryBlock as SummaryBlockType } from "../../../template";
import { getTotal } from "../../../utils/purchase-order";
import { useTw } from "../tw";
import type { PurchaseOrderData } from "./types";

export function SummaryBlock({
  block,
  data
}: {
  block: SummaryBlockType;
  data: PurchaseOrderData;
}) {
  const tw = useTw();
  const { purchaseOrderLines, purchaseOrder, currencyCode, numberFormatter } =
    data;
  const taxLabel = block.options?.taxLabel?.trim() || "Tax";

  const shippingCost = purchaseOrder?.supplierShippingCost ?? 0;
  const taxAmount = purchaseOrderLines.reduce(
    (acc, line) => acc + (line.supplierTaxAmount ?? 0),
    0
  );

  return (
    <View style={tw("mb-4")}>
      <View
        style={[
          tw("flex flex-row py-1.5 px-3 text-[9px]"),
          { backgroundColor: "rgba(249, 250, 251, 0.6)" }
        ]}
      >
        <Text style={tw("w-[87%] text-right pr-3 text-gray-600")}>
          Subtotal ({currencyCode})
        </Text>
        <Text style={tw("w-[13%] text-center text-gray-800")}>
          {numberFormatter.format(
            purchaseOrderLines.reduce((sum, line) => {
              if (line?.purchaseQuantity && line?.supplierUnitPrice) {
                return sum + line.purchaseQuantity * line.supplierUnitPrice;
              }
              return sum;
            }, 0)
          )}
        </Text>
      </View>

      {shippingCost > 0 && (
        <View
          style={[
            tw("flex flex-row py-1.5 px-3 text-[9px]"),
            { backgroundColor: "rgba(249, 250, 251, 0.6)" }
          ]}
        >
          <Text style={tw("w-[87%] text-right pr-3 text-gray-600")}>
            Shipping ({currencyCode})
          </Text>
          <Text style={tw("w-[13%] text-center text-gray-800")}>
            {numberFormatter.format(shippingCost)}
          </Text>
        </View>
      )}

      {taxAmount > 0 && (
        <View
          style={[
            tw("flex flex-row py-1.5 px-3 text-[9px]"),
            { backgroundColor: "rgba(249, 250, 251, 0.6)" }
          ]}
        >
          <Text style={tw("w-[87%] text-right pr-3 text-gray-600")}>
            {taxLabel} ({currencyCode})
          </Text>
          <Text style={tw("w-[13%] text-center text-gray-800")}>
            {numberFormatter.format(taxAmount)}
          </Text>
        </View>
      )}

      <View style={tw("h-[1px] bg-gray-200")} />
      <View style={tw("flex flex-row py-2 px-3 text-[9px]")}>
        <Text style={tw("w-[87%] text-right pr-3 text-gray-800 font-bold")}>
          Total ({currencyCode})
        </Text>
        <Text style={tw("w-[13%] text-center text-gray-800 font-bold")}>
          {numberFormatter.format(getTotal(purchaseOrderLines) + shippingCost)}
        </Text>
      </View>
    </View>
  );
}
