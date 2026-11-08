// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
import type { DocumentTemplate, ResolvedSection } from "../template";
import {
  documentValues,
  packingSlipTexts,
  resolveTemplate,
  type ValueCollector
} from "../template";
import type { PDF } from "../types";
import { resolveRegistrationLine } from "../utils/shared";
import { DocumentPage } from "./blocks/DocumentPage";
import { documentChrome } from "./blocks/documentChrome";
import type {
  PackingSlipData,
  PackingSlipDocumentType,
  PackingSlipRentalUnit
} from "./blocks/packingSlip";
import {
  buildPackingSlipVars,
  packingSlipBlockRegistry
} from "./blocks/packingSlip";

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
  /** Which title prints, and what the customer reference is called. */
  documentType?: PackingSlipDocumentType;
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
  documentType = "packingSlip",
  locale,
  trackedEntities,
  rentalUnits,
  thumbnails,
  template,
  sections = {}
}: PackingSlipProps) => {
  const resolved = resolveTemplate("packingSlip", template);
  const { theme, settings, footerSectionId } = resolved;

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
  const chrome = documentChrome({
    texts: packingSlipTexts.document,
    template: resolved,
    vars,
    sections
  });
  const { dt, documentNumber, headerOptions } = chrome;
  const documentTitle = dt(
    documentType === "deliveryTicket"
      ? "rentalTitle"
      : documentType === "receivingReport"
        ? "receivingReportTitle"
        : "title"
  );

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
    documentType,
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
    <DocumentPage
      chrome={{ ...chrome, documentTitle }}
      template={resolved}
      meta={meta}
      keywords="packing slip"
      footerDocumentId={shipment?.shipmentId}
      footerLabel={registration.label}
      showRegistrationLine={registration.show}
      registry={packingSlipBlockRegistry}
      data={data}
    />
  );
};

export default PackingSlipPDF;
