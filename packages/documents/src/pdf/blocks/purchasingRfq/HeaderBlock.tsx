// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { formatCityStatePostalCode } from "@carbon/utils";
import { Text, View } from "@react-pdf/renderer";
import { DEFAULT_HEADER_OPTIONS } from "../../../template";
import { LogoImage } from "../../components";
import { useTw } from "../tw";
import type { PurchasingRfqData } from "./types";

/**
 * Letterhead: the logo on the left, the company's address and contact details
 * on the right, a rule under both, then the title. The RFQ number and dates
 * sit in the letter below (PartiesBlock), as they would in a typed letter.
 */
export function HeaderBlock({ data }: { data: PurchasingRfqData }) {
  const tw = useTw();
  const { company } = data;
  const opts = { ...DEFAULT_HEADER_OPTIONS, ...data.headerOptions };
  const logoSrc =
    opts.logoVariant === "icon"
      ? (company.logoLightIcon ?? company.logoLight)
      : (company.logoLight ?? company.logoLightIcon);
  const showLogo = opts.showLogo && Boolean(logoSrc);
  const cityLine =
    company.city || company.stateProvince || company.postalCode
      ? formatCityStatePostalCode(
          company.city,
          company.stateProvince,
          company.postalCode
        )
      : null;
  const contactLines = [company.phone, company.email, company.website].filter(
    Boolean
  );

  return (
    <View style={tw("mb-6")}>
      <View style={tw("flex flex-row justify-between items-end pb-3")}>
        <View style={tw("shrink pr-6")}>
          {showLogo ? (
            <LogoImage
              src={logoSrc!}
              height={opts.logoHeight}
              crop={opts.logoCrop}
            />
          ) : (
            <Text style={tw("text-[18px] font-bold text-gray-800")}>
              {company.name}
            </Text>
          )}
        </View>
        {opts.showCompanyDetails ? (
          <View style={tw("flex flex-col items-end text-[8px] text-gray-600")}>
            {showLogo && company.name ? (
              <Text style={tw("font-bold text-gray-800")}>{company.name}</Text>
            ) : null}
            {company.addressLine1 ? <Text>{company.addressLine1}</Text> : null}
            {company.addressLine2 ? <Text>{company.addressLine2}</Text> : null}
            {cityLine ? <Text>{cityLine}</Text> : null}
            {contactLines.map((line) => (
              <Text key={line}>{line}</Text>
            ))}
          </View>
        ) : null}
      </View>
      <View style={tw("h-[1px] bg-gray-400")} />
      {opts.showDocumentTitle ? (
        <Text
          style={[
            tw("text-[16px] font-bold mt-5"),
            { color: data.theme.accent }
          ]}
        >
          Request for Quote
        </Text>
      ) : null}
    </View>
  );
}
