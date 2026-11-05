// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
import { Fragment } from "react";
import type { DocumentTemplate, ResolvedSection } from "../template";
import {
  documentValues,
  packingSlipTexts,
  resolveTemplate,
  type ValueCollector
} from "../template";
import type { PDF } from "../types";
import { resolveRegistrationLine } from "../utils/shared";
import { documentChrome } from "./blocks/documentChrome";
import type {
  PackingSlipData,
  PackingSlipRentalUnit
} from "./blocks/packingSlip";
import {
  buildPackingSlipVars,
  packingSlipBlockRegistry
} from "./blocks/packingSlip";
import { Template } from "./components";

interface PackingSlipProps extends PDF {
  valueCollector?: ValueCollector;
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
  rentalUnits?: PackingSlipRentalUnit[];
  thumbnails?: Record<string, string | null>;
  template?: DocumentTemplate | null;
  sections?: Record<string, ResolvedSection>;
  /** Which title prints: the packing slip's, or a rental shipment's delivery ticket. */
  kind?: "packingSlip" | "deliveryTicket";
}

const PackingSlipPDF = ({
  valueCollector,
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
  kind = "packingSlip",
  locale,
  trackedEntities,
  rentalUnits,
  thumbnails,
  template,
  sections = {}
}: PackingSlipProps) => {
  const { blocks, theme, settings, headerSectionId, footerSectionId } =
    resolveTemplate("packingSlip", template);

  const values = documentValues(settings.valueEdits, valueCollector);
  const vars = values.document(
    buildPackingSlipVars({
      shipment,
      customer,
      customerReference,
      sourceDocument,
      sourceDocumentId,
      shippingAddress,
      shippingMethod,
      paymentTerm,
      company,
      locale
    })
  );
  const {
    dt,
    documentNumber,
    footerText,
    headerOptions,
    headerContent,
    footerContent,
    showFooter,
    visibleBlocks
  } = documentChrome({
    texts: packingSlipTexts.document,
    settings,
    vars,
    blocks,
    sections,
    headerSectionId,
    footerSectionId
  });
  const documentTitle = dt(kind === "deliveryTicket" ? "rentalTitle" : "title");

  const registration = resolveRegistrationLine({
    company,
    footerSectionId,
    sections,
    settings,
    vars
  });

  const data: PackingSlipData = {
    documentTitle,
    documentNumber,
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
    rentalUnits,
    thumbnails,
    theme,
    sections,
    values,
    vars,
    headerOptions
  };

  return (
    <Template
      theme={theme}
      title={documentTitle}
      meta={{
        author: meta?.author ?? "Carbon",
        keywords: meta?.keywords ?? "packing slip",
        subject: meta?.subject ?? documentTitle
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
      footerText={footerText}
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
