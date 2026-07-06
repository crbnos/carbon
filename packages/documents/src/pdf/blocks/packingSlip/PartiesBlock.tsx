import { formatDate } from "@carbon/utils";
import { Text, View } from "@react-pdf/renderer";
import { useTw } from "../tw";
import type { PackingSlipData } from "./types";

/** Ship-To address + Shipment details (date, source doc, customer PO, tracking). */
export function PartiesBlock({ data }: { data: PackingSlipData }) {
  const tw = useTw();
  const {
    customer,
    shippingAddress,
    shipment,
    sourceDocument,
    sourceDocumentId,
    customerReference,
    locale
  } = data;
  const {
    addressLine1,
    addressLine2,
    city,
    stateProvince,
    postalCode,
    countryCode
  } = shippingAddress ?? {};

  return (
    <View style={tw("border border-gray-200 mb-4")}>
      <View style={tw("flex flex-row")}>
        <View style={tw("w-1/2 p-3 border-r border-gray-200")}>
          <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
            Ship To
          </Text>
          <View style={tw("text-[10px] text-gray-800")}>
            {customer.name && (
              <Text style={tw("font-bold")}>{customer.name}</Text>
            )}
            {addressLine1 && <Text style={tw("mt-1")}>{addressLine1}</Text>}
            {addressLine2 && <Text>{addressLine2}</Text>}
            {city && <Text>{city}</Text>}
            {(stateProvince || postalCode) && (
              <Text>
                {[stateProvince, postalCode].filter(Boolean).join(" ")}
              </Text>
            )}
            {countryCode && <Text>{countryCode}</Text>}
          </View>
        </View>
        <View style={tw("w-1/2 p-3")}>
          <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
            Shipment Details
          </Text>
          <View style={tw("text-[10px] text-gray-800")}>
            {shipment?.postingDate && (
              <Text>
                Date: {formatDate(shipment.postingDate, undefined, locale)}
              </Text>
            )}
            {sourceDocument && sourceDocumentId && (
              <Text>
                {sourceDocument}: {sourceDocumentId}
              </Text>
            )}
            {customerReference && (
              <Text>Customer PO #: {customerReference}</Text>
            )}
            {shipment?.trackingNumber && (
              <Text>Tracking: {shipment.trackingNumber}</Text>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}
