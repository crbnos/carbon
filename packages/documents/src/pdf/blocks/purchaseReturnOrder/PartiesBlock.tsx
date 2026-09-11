import { formatDate } from "@carbon/utils";
import { Text, View } from "@react-pdf/renderer";
import { getCountryName } from "../../../utils/shared";
import { AddressBlock } from "../../components";
import { useTw } from "../tw";
import type { PurchaseReturnOrderData, ReturnOrderAddress } from "./types";

function resolveCountry(address?: ReturnOrderAddress | null): string {
  if (!address) return "";
  return address.country ?? getCountryName(address.countryCode);
}

export function PartiesBlock({ data }: { data: PurchaseReturnOrderData }) {
  const tw = useTw();
  const { purchaseReturnOrder, supplierAddress, shipFromAddress, locale } =
    data;

  return (
    <View style={tw("border border-gray-200 mb-4")}>
      <View style={tw("flex flex-row")}>
        {/* LEFT — the supplier the goods return to */}
        <View style={tw("w-1/2 p-3 border-r border-gray-200")}>
          <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
            Return To
          </Text>
          <View style={tw("text-[9px] text-gray-800")}>
            <AddressBlock
              name={supplierAddress?.name}
              addressLine1={supplierAddress?.addressLine1}
              addressLine2={supplierAddress?.addressLine2}
              city={supplierAddress?.city}
              stateProvince={supplierAddress?.stateProvince}
              postalCode={supplierAddress?.postalCode}
              country={resolveCountry(supplierAddress)}
            />
          </View>
        </View>

        {/* RIGHT — Return Details + Ship From stacked */}
        <View style={tw("w-1/2 flex flex-col")}>
          <View style={tw("p-3 border-b border-gray-200")}>
            <Text
              style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}
            >
              Return Details
            </Text>
            <View style={tw("text-[9px] text-gray-800")}>
              {purchaseReturnOrder?.purchaseReturnOrderId && (
                <Text>
                  Return Number: {purchaseReturnOrder.purchaseReturnOrderId}
                </Text>
              )}
              {purchaseReturnOrder?.supplierReference && (
                <Text>
                  Supplier RMA #: {purchaseReturnOrder.supplierReference}
                </Text>
              )}
              {purchaseReturnOrder?.orderDate && (
                <Text>
                  Date:{" "}
                  {formatDate(purchaseReturnOrder.orderDate, undefined, locale)}
                </Text>
              )}
              {purchaseReturnOrder?.expirationDate && (
                <Text>
                  Expires:{" "}
                  {formatDate(
                    purchaseReturnOrder.expirationDate,
                    undefined,
                    locale
                  )}
                </Text>
              )}
            </View>
          </View>

          <View style={tw("p-3")}>
            <Text
              style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}
            >
              Ship From
            </Text>
            <View style={tw("text-[9px] text-gray-800")}>
              <AddressBlock
                name={shipFromAddress?.name ?? data.company?.name}
                addressLine1={shipFromAddress?.addressLine1}
                addressLine2={shipFromAddress?.addressLine2}
                city={shipFromAddress?.city}
                stateProvince={shipFromAddress?.stateProvince}
                postalCode={shipFromAddress?.postalCode}
                country={resolveCountry(shipFromAddress)}
              />
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}
