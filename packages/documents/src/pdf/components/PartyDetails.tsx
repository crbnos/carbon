import type { Database } from "@carbon/database";
import { formatCityStatePostalCode, isEoriCountry } from "@carbon/utils";
import { Text, View } from "@react-pdf/renderer";
import { createTw } from "react-pdf-tailwind";

type CounterParty = {
  name: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  stateProvince: string | null;
  postalCode: string | null;
  countryCode: string | null;
  taxId?: string | null;
  vatNumber?: string | null;
  eori?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
};

type CompanyAddressOverride = {
  name: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  stateProvince: string | null;
  postalCode: string | null;
  countryCode: string | null;
};

type PartyDetailsProps = {
  company: Database["public"]["Views"]["companies"]["Row"];
  companyAddressOverride?: CompanyAddressOverride;
  companyLabel: string;
  counterParty: CounterParty;
  counterPartyLabel: string;
  createdByFullName?: string | null;
  createdByEmail?: string | null;
  createdByPhone?: string | null;
  accountsPayableEmail?: string | null;
  accountsReceivableEmail?: string | null;
  /**
   * When true, skip Tax ID / VAT / EORI on the company side. The caller
   * is expected to render those elsewhere (e.g. PO Order Details box).
   */
  hideCompanyTaxLines?: boolean;
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

const PartyDetails = ({
  company,
  companyAddressOverride,
  companyLabel,
  counterParty,
  counterPartyLabel,
  createdByFullName,
  createdByEmail,
  createdByPhone,
  accountsPayableEmail,
  accountsReceivableEmail,
  hideCompanyTaxLines
}: PartyDetailsProps) => {
  const addr = companyAddressOverride ?? company;

  return (
    <View style={tw("border border-gray-200 mb-4")}>
      <View style={tw("flex flex-row")}>
        {/* Counter Party (addressee — top-left, letter-style) */}
        <View style={tw("w-1/2 p-3 border-r border-gray-200")}>
          <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
            {counterPartyLabel}
          </Text>
          <View style={tw("text-[9px] text-gray-800")}>
            {counterParty.name && (
              <Text style={tw("font-bold")}>{counterParty.name}</Text>
            )}
            {counterParty.addressLine1 && (
              <Text>{counterParty.addressLine1}</Text>
            )}
            {counterParty.addressLine2 && (
              <Text>{counterParty.addressLine2}</Text>
            )}
            {(counterParty.city ||
              counterParty.stateProvince ||
              counterParty.postalCode ||
              counterParty.countryCode) && (
              <Text>
                {[
                  formatCityStatePostalCode(
                    counterParty.city,
                    counterParty.stateProvince,
                    counterParty.postalCode
                  ),
                  counterParty.countryCode
                ]
                  .filter(Boolean)
                  .join(" ")}
              </Text>
            )}
            {counterParty.taxId && !isEoriCountry(counterParty.countryCode) && (
              <Text>Tax ID: {counterParty.taxId}</Text>
            )}
            {counterParty.vatNumber && (
              <Text>VAT No: {counterParty.vatNumber}</Text>
            )}
            {counterParty.eori && <Text>EORI: {counterParty.eori}</Text>}
            {counterParty.contactName && (
              <Text>Contact: {counterParty.contactName}</Text>
            )}
            {counterParty.contactEmail && (
              <Text>Email: {counterParty.contactEmail}</Text>
            )}
          </View>
        </View>

        {/* Company (sender — top-right) */}
        <View style={tw("w-1/2 p-3")}>
          <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
            {companyLabel}
          </Text>
          <View style={tw("text-[9px] text-gray-800")}>
            {company.name && (
              <Text style={tw("font-bold")}>{company.name}</Text>
            )}
            {companyAddressOverride?.name &&
              companyAddressOverride.name !== company.name && (
                <Text>{companyAddressOverride.name}</Text>
              )}
            {addr.addressLine1 && <Text>{addr.addressLine1}</Text>}
            {addr.addressLine2 && <Text>{addr.addressLine2}</Text>}
            {(addr.city ||
              addr.stateProvince ||
              addr.postalCode ||
              addr.countryCode) && (
              <Text>
                {[
                  formatCityStatePostalCode(
                    addr.city,
                    addr.stateProvince,
                    addr.postalCode
                  ),
                  addr.countryCode
                ]
                  .filter(Boolean)
                  .join(" ")}
              </Text>
            )}
            {!hideCompanyTaxLines && (
              <>
                {company.taxId && <Text>Tax ID: {company.taxId}</Text>}
                {company.vatNumber && (
                  <Text>VAT Number: {company.vatNumber}</Text>
                )}
                {company.eori && <Text>EORI: {company.eori}</Text>}
              </>
            )}
            {createdByFullName && <Text>Contact: {createdByFullName}</Text>}
            {createdByEmail && <Text>Email: {createdByEmail}</Text>}
            {createdByPhone && <Text>Phone: {createdByPhone}</Text>}
            {accountsPayableEmail && (
              <Text>
                Billing documents and enquiries to: {accountsPayableEmail}
              </Text>
            )}
            {accountsReceivableEmail && (
              <Text>Accounts Receivable: {accountsReceivableEmail}</Text>
            )}
          </View>
        </View>
      </View>
    </View>
  );
};

export { PartyDetails };
