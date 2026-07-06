import { formatCityStatePostalCode } from "@carbon/utils";
import { Text, View } from "@react-pdf/renderer";
import { DEFAULT_HEADER_OPTIONS, type HeaderOptions } from "../../template";
import type { Company } from "../../types";
import { useTw } from "../blocks/tw";
import { LogoImage } from "./LogoImage";

type HeaderProps = {
  company: Company;
  title: string;
  documentId?: string | null;
  documentSubId?: string | null;
  date?: string | null;
  currencyCode?: string | null;
  locale?: string;
  /** Per-template display options (logo + which fields show). */
  options?: HeaderOptions;
  /**
   * When true, the header is wrapped in <View fixed> so it repeats on
   * every page. Used by PO PDF; sales PDFs default to non-fixed (page 1 only).
   */
  fixed?: boolean;
};

const Header = ({
  company,
  title,
  documentId,
  documentSubId,
  options,
  fixed
}: HeaderProps) => {
  const tw = useTw();
  const opts = { ...DEFAULT_HEADER_OPTIONS, ...options };
  // `icon` variant prefers the square logo; `mark` prefers the full logo.
  const logoSrc =
    opts.logoVariant === "icon"
      ? (company.logoLightIcon ?? company.logoLight)
      : (company.logoLight ?? company.logoLightIcon);
  const showLogo = opts.showLogo && Boolean(logoSrc);
  // Name fallback only when a logo is wanted but missing. With the logo turned
  // off, render nothing here (the company name still shows in the details block).
  const showNameFallback = opts.showLogo && !logoSrc;

  const headerView = (
    <View style={tw("flex flex-row justify-between mb-1")}>
      <View style={tw("flex flex-row")}>
        {showLogo ? (
          <LogoImage
            src={logoSrc!}
            height={opts.logoHeight}
            crop={opts.logoCrop}
            marginRight={12}
          />
        ) : showNameFallback ? (
          <Text style={tw("text-2xl font-bold text-gray-800 mr-3")}>
            {company.name}
          </Text>
        ) : null}
        {opts.showCompanyDetails && (
          <View style={tw("flex flex-col text-[9px] text-gray-800")}>
            {company.name && (
              <Text style={tw("font-bold")}>{company.name}</Text>
            )}
            {company.addressLine1 && <Text>{company.addressLine1}</Text>}
            {company.addressLine2 && <Text>{company.addressLine2}</Text>}
            {(company.city || company.stateProvince || company.postalCode) && (
              <Text>
                {formatCityStatePostalCode(
                  company.city,
                  company.stateProvince,
                  company.postalCode
                )}
              </Text>
            )}
          </View>
        )}
      </View>
      <View style={tw("flex flex-col items-end justify-start")}>
        {opts.showDocumentTitle && (
          <Text style={tw("text-2xl font-bold text-gray-800")}>{title}</Text>
        )}
        {opts.showDocumentId && documentId && (
          <Text style={tw("text-sm font-bold text-gray-600 -mt-4")}>
            {documentId}
          </Text>
        )}
        {documentSubId && (
          <Text style={tw("text-[8px] font-bold text-gray-600")}>
            {documentSubId}
          </Text>
        )}
      </View>
    </View>
  );

  if (fixed) {
    return (
      <>
        <View fixed>{headerView}</View>
        <View fixed style={tw("h-[1px] bg-gray-200 mb-4")} />
      </>
    );
  }

  return (
    <>
      {headerView}
      <View style={tw("h-[1px] bg-gray-200 mb-4")} />
    </>
  );
};

export { Header };
