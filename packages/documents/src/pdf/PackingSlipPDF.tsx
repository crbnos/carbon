import type { Database } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
import { Fragment } from "react";
import type { DocumentTemplate, ResolvedSection } from "../template";
import {
  DEFAULT_HEADER_OPTIONS,
  interpolateContent,
  resolveTemplate
} from "../template";
import type { PDF } from "../types";
import { resolveRegistrationLine } from "../utils/shared";
import type { PackingSlipData } from "./blocks/packingSlip";
import {
  buildPackingSlipVars,
  packingSlipBlockRegistry
} from "./blocks/packingSlip";
import { Template } from "./components";

interface PackingSlipProps extends PDF {
  customer:
    | Database["public"]["Tables"]["customer"]["Row"]
    | Database["public"]["Tables"]["supplier"]["Row"];
  customerReference?: string;
  sourceDocument?: string;
  sourceDocumentId?: string;
  shipment: Database["public"]["Tables"]["shipment"]["Row"];
  shipmentLines: Database["public"]["Views"]["shipmentLines"]["Row"][];
  shippingAddress: Database["public"]["Tables"]["address"]["Row"] | null;
  paymentTerm: { id: string; name: string };
  shippingMethod: { id: string; name: string };
  terms: JSONContent;
  trackedEntities: Database["public"]["Tables"]["trackedEntity"]["Row"][];
  thumbnails?: Record<string, string | null>;
  template?: DocumentTemplate | null;
  sections?: Record<string, ResolvedSection>;
}

const PackingSlipPDF = ({
  company,
  customer,
  meta,
  customerReference,
  sourceDocument,
  sourceDocumentId,
  shipment,
  shipmentLines,
  shippingAddress,
  terms,
  paymentTerm,
  shippingMethod,
  title = "Packing Slip",
  locale,
  trackedEntities,
  thumbnails,
  template,
  sections = {}
}: PackingSlipProps) => {
  const { blocks, theme, settings, headerSectionId, footerSectionId } =
    resolveTemplate("packingSlip", template);

  const vars = buildPackingSlipVars({
    shipment,
    customer,
    shippingAddress,
    company
  });

  const headerOptions = {
    ...DEFAULT_HEADER_OPTIONS,
    ...(headerSectionId ? (sections[headerSectionId]?.config ?? {}) : {})
  };

  const registration = resolveRegistrationLine({
    company,
    footerSectionId,
    sections,
    settings,
    vars
  });

  const data: PackingSlipData = {
    company,
    locale,
    customer,
    customerReference,
    sourceDocument,
    sourceDocumentId,
    shipment,
    shipmentLines,
    shippingAddress,
    paymentTerm,
    shippingMethod,
    terms,
    trackedEntities,
    thumbnails,
    theme,
    sections,
    vars,
    headerOptions
  };

  const headerSection = headerSectionId
    ? sections[headerSectionId]?.content
    : undefined;
  const footerSection = footerSectionId
    ? sections[footerSectionId]?.content
    : undefined;
  const headerContent = headerSection
    ? interpolateContent(headerSection, vars)
    : undefined;
  const footerContent = footerSection
    ? interpolateContent(footerSection, vars)
    : undefined;

  const showHeader = headerSectionId !== null;
  const showFooter = footerSectionId !== null;
  const visibleBlocks = blocks.filter(
    (block) => block.visible && !(block.type === "header" && !showHeader)
  );

  return (
    <Template
      theme={theme}
      title={title}
      meta={{
        author: meta?.author ?? "Carbon",
        keywords: meta?.keywords ?? "packing slip",
        subject: meta?.subject ?? "Packing Slip"
      }}
      footerLabel={registration.label}
      footerDocumentId={shipment?.shipmentId}
      showFooter={showFooter}
      showPageNumbers={settings.showPageNumbers}
      pageNumberFormat={settings.pageNumberFormat}
      showRegistrationLine={registration.show}
      fontFamily={settings.fontFamily}
      headerContent={headerContent}
      footerContent={footerContent}
    >
      {visibleBlocks.map((block) => {
        const render = packingSlipBlockRegistry[block.type];
        if (!render) return null;
        return <Fragment key={block.id}>{render({ block, data })}</Fragment>;
      })}
    </Template>
  );
};

export default PackingSlipPDF;
