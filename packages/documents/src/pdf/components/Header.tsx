import { formatCityStatePostalCode } from "@carbon/utils";
import { Image, Text, View } from "@react-pdf/renderer";
import { createTw } from "react-pdf-tailwind";
import type { Company } from "../../types";

type HeaderProps = {
  company: Company;
  title: string;
  documentId?: string | null;
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

const Header = ({ company, title, documentId }: HeaderProps) => {
  return (
    <>
      <View style={tw("flex flex-row justify-between mb-1")}>
        <View style={tw("flex flex-col flex-1")}>
          {company.logoLightIcon ? (
            <Image
              src={company.logoLightIcon}
              style={{ height: 50, width: 50, marginBottom: 4 }}
            />
          ) : (
            <View>
              <Text
                style={tw("text-2xl font-bold text-gray-800 tracking-tight")}
              >
                {company.name}
              </Text>
            </View>
          )}

          <View
            style={tw(
              "text-[10px] text-gray-600 {company.logoLightIcon ? 'mt-0.5' : '-mt-2'}"
            )}
          >
            {company.logoLightIcon && company.name && (
              <Text style={tw("font-semibold text-black")}>{company.name}</Text>
            )}
            {company.addressLine1 && <Text>{company.addressLine1}</Text>}
            {(company.city || company.stateProvince || company.postalCode) && (
              <Text>
                {formatCityStatePostalCode(
                  company.city,
                  company.stateProvince,
                  company.postalCode
                )}
              </Text>
            )}
            {company.phone && <Text>{company.phone}</Text>}
            {company.website && <Text>{company.website}</Text>}
          </View>
        </View>
        <View style={tw("flex flex-col items-end justify-start")}>
          <Text style={tw("text-2xl font-bold text-gray-800 tracking-tight")}>
            {title}
          </Text>
          {documentId && (
            <Text
              style={tw("text-sm font-bold text-gray-600 tracking-tight -mt-4")}
            >
              #{documentId}
            </Text>
          )}
        </View>
      </View>

      {/* Divider */}
      <View style={tw("h-[1px] bg-gray-200 mb-4")} />
    </>
  );
};

export { Header };
