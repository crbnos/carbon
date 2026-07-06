import type { ComponentType } from "react";
import type { DocumentTemplateType } from "../template";
import IssuePDF from "./IssuePDF";
import { SAMPLE_ISSUE } from "./issue.samples";
import JobTravelerPDF from "./JobTravelerPDF";
import { SAMPLE_JOB_TRAVELER } from "./jobTraveler.samples";
import PackingSlipPDF from "./PackingSlipPDF";
import ProductLabelPDF from "./ProductLabelPDF";
import PurchaseOrderPDF from "./PurchaseOrderPDF";
import { SAMPLE_PACKING_SLIP } from "./packingSlip.samples";
import { SAMPLE_PURCHASE_ORDER } from "./purchaseOrder.samples";
import QuotePDF from "./QuotePDF";
import { SAMPLE_QUOTE } from "./quote.samples";
import SalesInvoicePDF from "./SalesInvoicePDF";
import SalesOrderPDF from "./SalesOrderPDF";
import StockTransferPDF from "./StockTransferPDF";
import { SAMPLE_SALES_ORDER } from "./salesOrder.samples";
import { SAMPLE_SALES_INVOICE } from "./samples";
import { SAMPLE_STOCK_TRANSFER } from "./stockTransfer.samples";
import { SAMPLE_TRACKING_LABEL } from "./trackingLabel.samples";

/**
 * Maps a document type to its PDF component + sample fixture, so the template
 * preview route can render any supported document generically. Adding a doc =
 * add an entry here (plus its enum / default template / registry).
 */
type PreviewEntry = { Component: ComponentType<any>; sample: any };

export const DOCUMENT_PDFS: Record<DocumentTemplateType, PreviewEntry> = {
  salesInvoice: { Component: SalesInvoicePDF, sample: SAMPLE_SALES_INVOICE },
  salesOrder: { Component: SalesOrderPDF, sample: SAMPLE_SALES_ORDER },
  purchaseOrder: {
    Component: PurchaseOrderPDF,
    sample: SAMPLE_PURCHASE_ORDER
  },
  quote: { Component: QuotePDF, sample: SAMPLE_QUOTE },
  packingSlip: { Component: PackingSlipPDF, sample: SAMPLE_PACKING_SLIP },
  stockTransfer: {
    Component: StockTransferPDF,
    sample: SAMPLE_STOCK_TRANSFER
  },
  jobTraveler: {
    Component: JobTravelerPDF,
    sample: SAMPLE_JOB_TRAVELER
  },
  issue: { Component: IssuePDF, sample: SAMPLE_ISSUE },
  trackingLabel: {
    Component: ProductLabelPDF,
    sample: SAMPLE_TRACKING_LABEL
  }
};
