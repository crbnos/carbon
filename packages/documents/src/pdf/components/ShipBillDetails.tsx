import { formatCityStatePostalCode } from "@carbon/utils";
import { Text, View } from "@react-pdf/renderer";
import { createTw } from "react-pdf-tailwind";

type Address = {
  name: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  stateProvince: string | null;
  postalCode: string | null;
  countryCode: string | null;
};

type ShipBillDetailsProps = {
  shipTo: Address;
  shipToLabel?: string;
  billTo?: Address;
  billToLabel?: string;
};

const tw = createTw({
  theme: {
    fontFamily: {
      sans: ["Inter", "Helvetica", "Arial", "sans-serif"]
    },
    extend: {
      colors: {
        gray: {
          50: "#f9fafb",
          200: "#e5e7eb",
          400: "#9ca3af",
          600: "#4b5563",
          800: "#1f2937"
        }
      }
    }
  }
});

const AddressBlock = ({ address }: { address: Address }) => (
  <View style={tw("text-[10px] text-gray-800")}>
    {address.name && <Text style={tw("font-bold")}>{address.name}</Text>}
    {address.addressLine1 && <Text>{address.addressLine1}</Text>}
    {address.addressLine2 && <Text>{address.addressLine2}</Text>}
    {(address.city ||
      address.stateProvince ||
      address.postalCode ||
      address.countryCode) && (
      <Text>
        {[
          formatCityStatePostalCode(
            address.city,
            address.stateProvince,
            address.postalCode
          ),
          address.countryCode
        ]
          .filter(Boolean)
          .join(" ")}
      </Text>
    )}
  </View>
);

const ShipBillDetails = ({
  shipTo,
  shipToLabel = "Deliver To",
  billTo,
  billToLabel = "Bill To"
}: ShipBillDetailsProps) => {
  return (
    <View style={tw("border border-gray-200 mb-4")}>
      <View style={tw("flex flex-row")}>
        <View
          style={tw(`w-1/2 p-3${billTo ? " border-r border-gray-200" : ""}`)}
        >
          <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
            {shipToLabel}
          </Text>
          <AddressBlock address={shipTo} />
        </View>
        {billTo && (
          <View style={tw("w-1/2 p-3")}>
            <Text
              style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}
            >
              {billToLabel}
            </Text>
            <AddressBlock address={billTo} />
          </View>
        )}
      </View>
    </View>
  );
};

export { ShipBillDetails };
