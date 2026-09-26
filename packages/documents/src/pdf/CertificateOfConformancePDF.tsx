import { Text, View } from "@react-pdf/renderer";
import { Fragment } from "react";
import type { DocumentTemplate, ResolvedSection } from "../template";
import {
  DEFAULT_HEADER_OPTIONS,
  interpolateContent,
  resolveTemplate
} from "../template";
import type { PDF } from "../types";
import { resolveRegistrationLine } from "../utils/shared";
import type { CertificateOfConformanceData } from "./blocks/certificateOfConformance";
import {
  buildCertificateOfConformanceVars,
  certificateOfConformanceBlockRegistry
} from "./blocks/certificateOfConformance";
import { Template } from "./components";

interface CertificateOfConformanceProps
  extends PDF,
    Pick<
      CertificateOfConformanceData,
      | "certificate"
      | "customer"
      | "purchaseOrderNumber"
      | "lines"
      | "conformity"
      | "notes"
    > {
  template?: DocumentTemplate | null;
  sections?: Record<string, ResolvedSection>;
}

/**
 * Faint, rotated "PREVIEW" repeated on every page of an unissued certificate,
 * so a preview can never be mistaken for the issued record.
 */
function PreviewMark() {
  return (
    <View
      fixed
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: "center",
        justifyContent: "center"
      }}
    >
      <Text
        style={{
          fontSize: 120,
          fontWeight: "bold",
          opacity: 0.08,
          transform: "rotate(-45deg)"
        }}
      >
        PREVIEW
      </Text>
    </View>
  );
}

const CertificateOfConformancePDF = ({
  company,
  locale,
  meta,
  title = "Certificate of Conformance",
  certificate,
  customer,
  purchaseOrderNumber,
  lines,
  conformity,
  notes,
  template,
  sections = {}
}: CertificateOfConformanceProps) => {
  const { blocks, theme, settings, headerSectionId, footerSectionId } =
    resolveTemplate("certificateOfConformance", template);

  const vars = buildCertificateOfConformanceVars({
    certificate,
    customer,
    purchaseOrderNumber,
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

  const data: CertificateOfConformanceData = {
    company,
    locale,
    theme,
    sections,
    vars,
    headerOptions,
    certificate,
    customer,
    purchaseOrderNumber,
    lines,
    conformity,
    notes
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
        keywords:
          meta?.keywords ??
          (certificate.issued
            ? "certificate of conformance"
            : "certificate of conformance, PREVIEW"),
        // The PDF metadata carries the preview state too, so a saved preview
        // announces itself in any viewer's document properties.
        subject:
          meta?.subject ??
          (certificate.issued
            ? "Certificate of Conformance"
            : "Certificate of Conformance (PREVIEW - NOT ISSUED)")
      }}
      footerLabel={registration.label}
      footerDocumentId={certificate.number}
      showFooter={showFooter}
      showPageNumbers={settings.showPageNumbers}
      pageNumberFormat={settings.pageNumberFormat}
      showRegistrationLine={registration.show}
      fontFamily={settings.fontFamily}
      headerContent={headerContent}
      footerContent={footerContent}
    >
      {!certificate.issued && <PreviewMark />}
      {visibleBlocks.map((block) => {
        const render = certificateOfConformanceBlockRegistry[block.type];
        if (!render) return null;
        return <Fragment key={block.id}>{render({ block, data })}</Fragment>;
      })}
    </Template>
  );
};

export default CertificateOfConformancePDF;
