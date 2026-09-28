import { formatCityStatePostalCode } from "@carbon/utils";
import { Text, View } from "@react-pdf/renderer";
import { useTw } from "../tw";
import { FieldCell, NOT_APPLICABLE } from "./Field";
import type { CertificateOfConformanceData } from "./types";

/** Fields 4 (Organization Name and Address) and 5 (Customer Name and Address). */
export function PartiesBlock({ data }: { data: CertificateOfConformanceData }) {
  const tw = useTw();
  const { company, customer } = data;
  const cityLine =
    company.city || company.stateProvince || company.postalCode
      ? formatCityStatePostalCode(
          company.city,
          company.stateProvince,
          company.postalCode
        )
      : null;
  const companyAddress = [
    company.addressLine1,
    company.addressLine2,
    cityLine,
    company.countryCode
  ].filter((line): line is string => Boolean(line));
  const customerAddress = customer.address.filter(Boolean);

  return (
    <View style={tw("border border-gray-200 mb-4 flex flex-row")}>
      <FieldCell
        number={4}
        label="Organization Name and Address"
        style="w-1/2 border-r border-gray-200"
      >
        <Text style={tw("font-bold")}>{company.name || NOT_APPLICABLE}</Text>
        {companyAddress.map((line, index) => (
          <Text key={index}>{line}</Text>
        ))}
      </FieldCell>
      <FieldCell number={5} label="Customer Name and Address" style="w-1/2">
        <Text style={tw("font-bold")}>{customer.name || NOT_APPLICABLE}</Text>
        {customerAddress.map((line, index) => (
          <Text key={index}>{line}</Text>
        ))}
      </FieldCell>
    </View>
  );
}
