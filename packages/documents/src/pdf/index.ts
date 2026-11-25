// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getPurchaseOrderDisplayId } from "../utils/purchase-order";
import { getQuoteDisplayId } from "../utils/quote";
import type { BatchListMember } from "./BatchListPDF";
import { BatchListPDF } from "./BatchListPDF";
import {
  buildJobTravelerVars,
  type JobTravelerMaterial
} from "./blocks/jobTraveler";
import type { PurchaseOrderApproval } from "./blocks/purchaseOrder";
import { Footer } from "./components";
import type {
  ContractFinancingEventRow,
  ContractFinancingRow
} from "./ContractFinancingRequestPDF";
import ContractFinancingRequestPDF from "./ContractFinancingRequestPDF";
import { ensureFont, getSafeFontFamily, registerDocumentFonts } from "./fonts";
import { SAMPLE_ISSUE } from "./issue.samples";
import IssuePDF from "./IssuePDF";
import { SAMPLE_JOB_TRAVELER } from "./jobTraveler.samples";
import JobTravelerPDF, { JobTravelerPageContent } from "./JobTravelerPDF";
import KanbanLabelPDF from "./KanbanLabelPDF";
import PackingSlipPDF from "./PackingSlipPDF";
import { DOCUMENT_PDFS } from "./preview-documents";
import ProductLabelPDF from "./ProductLabelPDF";
import type { ProjectReaderSection } from "./ProjectReaderPDF";
import ProjectReaderPDF from "./ProjectReaderPDF";
import PurchaseOrderPDF from "./PurchaseOrderPDF";
import { SAMPLE_PURCHASE_RETURN_ORDER } from "./purchaseReturnOrder.samples";
import PurchaseReturnOrderPDF from "./PurchaseReturnOrderPDF";
import PurchasingRfqPDF from "./PurchasingRfqPDF";
import QuotePDF from "./QuotePDF";
import SalesInvoicePDF from "./SalesInvoicePDF";
import { SAMPLE_SALES_ORDER } from "./salesOrder.samples";
import SalesOrderPDF from "./SalesOrderPDF";
import { SAMPLE_SALES_RETURN_ORDER } from "./salesReturnOrder.samples";
import SalesReturnOrderPDF from "./SalesReturnOrderPDF";
import { SAMPLE_SALES_INVOICE } from "./samples";
import type {
  ServiceJobEstimate,
  ServiceJobEstimateLine
} from "./ServiceJobEstimatePDF";
import ServiceJobEstimatePDF from "./ServiceJobEstimatePDF";
import StockTransferPDF from "./StockTransferPDF";
import StorageUnitLabelPDF from "./StorageUnitLabelPDF";
import { SAMPLE_TRACKING_LABEL } from "./trackingLabel.samples";

export { documentChrome } from "./blocks/documentChrome";
export type {
  BatchListMember,
  ContractFinancingEventRow,
  ContractFinancingRow,
  JobTravelerMaterial,
  ProjectReaderSection,
  PurchaseOrderApproval,
  ServiceJobEstimate,
  ServiceJobEstimateLine
};
export {
  BatchListPDF,
  buildJobTravelerVars,
  ContractFinancingRequestPDF,
  DOCUMENT_PDFS,
  ensureFont,
  Footer,
  getPurchaseOrderDisplayId,
  getQuoteDisplayId,
  getSafeFontFamily,
  IssuePDF,
  JobTravelerPageContent,
  JobTravelerPDF,
  KanbanLabelPDF,
  PackingSlipPDF,
  ProductLabelPDF,
  ProjectReaderPDF,
  PurchaseOrderPDF,
  PurchaseReturnOrderPDF,
  PurchasingRfqPDF,
  QuotePDF,
  registerDocumentFonts,
  SAMPLE_ISSUE,
  SAMPLE_JOB_TRAVELER,
  SAMPLE_PURCHASE_RETURN_ORDER,
  SAMPLE_SALES_INVOICE,
  SAMPLE_SALES_ORDER,
  SAMPLE_SALES_RETURN_ORDER,
  SAMPLE_TRACKING_LABEL,
  SalesInvoicePDF,
  SalesOrderPDF,
  SalesReturnOrderPDF,
  ServiceJobEstimatePDF,
  StockTransferPDF,
  StorageUnitLabelPDF
};
