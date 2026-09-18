import { formatDate } from "@carbon/utils";
import { Text, View } from "@react-pdf/renderer";
import { getCountryName } from "../../../utils/shared";
import { AddressBlock } from "../../components";
import { useTw } from "../tw";
import type { ReturnOrderAddress, SalesReturnOrderData } from "./types";

function resolveCountry(address?: ReturnOrderAddress | null): string {
  if (!address) return "";
  return address.country ?? getCountryName(address.countryCode);
}

export function PartiesBlock({ data }: { data: SalesReturnOrderData }) {
  const tw = useTw();
  const { salesReturnOrder, customerAddress, returnToAddress, locale } = data;

  return (
    <View style={tw("border border-gray-200 mb-4")}>
      <View style={tw("flex flex-row")}>
        {/* LEFT — the returning customer */}
        <View style={tw("w-1/2 p-3 border-r border-gray-200")}>
          <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
            Customer
          </Text>
          <View style={tw("text-[9px] text-gray-800")}>
            <AddressBlock
              name={customerAddress?.name}
              addressLine1={customerAddress?.addressLine1}
              addressLine2={customerAddress?.addressLine2}
              city={customerAddress?.city}
              stateProvince={customerAddress?.stateProvince}
              postalCode={customerAddress?.postalCode}
              country={resolveCountry(customerAddress)}
            />
          </View>
        </View>

        {/* RIGHT — Return Details + Return To stacked */}
        <View style={tw("w-1/2 flex flex-col")}>
          <View style={tw("p-3 border-b border-gray-200")}>
            <Text
              style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}
            >
              Return Details
            </Text>
            <View style={tw("text-[9px] text-gray-800")}>
              {salesReturnOrder?.salesReturnOrderId && (
                <Text>RMA Number: {salesReturnOrder.salesReturnOrderId}</Text>
              )}
              {salesReturnOrder?.orderDate && (
                <Text>
                  Date:{" "}
                  {formatDate(salesReturnOrder.orderDate, undefined, locale)}
                </Text>
              )}
              {salesReturnOrder?.expirationDate && (
                <Text>
                  Expires:{" "}
                  {formatDate(
                    salesReturnOrder.expirationDate,
                    undefined,
                    locale
                  )}
                </Text>
              )}
              {salesReturnOrder?.customerReference && (
                <Text>Customer Ref: {salesReturnOrder.customerReference}</Text>
              )}
            </View>
          </View>

          <View style={tw("p-3")}>
            <Text
              style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}
            >
              Return To
            </Text>
            <View style={tw("text-[9px] text-gray-800")}>
              <AddressBlock
                name={returnToAddress?.name ?? data.company?.name}
                addressLine1={returnToAddress?.addressLine1}
                addressLine2={returnToAddress?.addressLine2}
                city={returnToAddress?.city}
                stateProvince={returnToAddress?.stateProvince}
                postalCode={returnToAddress?.postalCode}
                country={resolveCountry(returnToAddress)}
              />
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}
