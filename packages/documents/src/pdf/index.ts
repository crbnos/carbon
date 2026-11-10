// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getPurchaseOrderDisplayId } from "../utils/purchase-order";
import { getQuoteDisplayId } from "../utils/quote";
import type { BatchListMember } from "./BatchListPDF";
import { BatchListPDF } from "./BatchListPDF";
import type {
  CertificateOfConformanceConformity,
  CertificateOfConformanceData,
  CertificateOfConformanceHeader,
  CertificateOfConformanceLine,
  CertificateSigner
} from "./blocks/certificateOfConformance";
import { CONFORMITY_STATEMENT } from "./blocks/certificateOfConformance";
import {
  buildJobTravelerVars,
  type JobTravelerMaterial
} from "./blocks/jobTraveler";
import type { PurchaseOrderApproval } from "./blocks/purchaseOrder";
import CertificateOfConformancePDF from "./CertificateOfConformancePDF";
import type {
  ContractFinancingEventRow,
  ContractFinancingRow
} from "./ContractFinancingRequestPDF";
import ContractFinancingRequestPDF from "./ContractFinancingRequestPDF";
import { SAMPLE_CERTIFICATE_OF_CONFORMANCE } from "./certificateOfConformance.samples";
import { Footer } from "./components";
import type {
  FirstArticleInspectionPDFCharacteristic,
  FirstArticleInspectionPDFHeader,
  FirstArticleInspectionPDFIndexRow,
  FirstArticleInspectionPDFProduct,
  FirstArticleInspectionPDFProps
} from "./FirstArticleInspectionPDF";
import FirstArticleInspectionPDF from "./FirstArticleInspectionPDF";
import { SAMPLE_FIRST_ARTICLE_INSPECTION } from "./firstArticleInspection.samples";
import { ensureFont, getSafeFontFamily, registerDocumentFonts } from "./fonts";
import IssuePDF from "./IssuePDF";
import { SAMPLE_ISSUE } from "./issue.samples";
import JobTravelerPDF, { JobTravelerPageContent } from "./JobTravelerPDF";
import { SAMPLE_JOB_TRAVELER } from "./jobTraveler.samples";
import KanbanLabelPDF from "./KanbanLabelPDF";
import PackingSlipPDF from "./PackingSlipPDF";
import ProductLabelPDF from "./ProductLabelPDF";
import type { ProjectReaderSection } from "./ProjectReaderPDF";
import ProjectReaderPDF from "./ProjectReaderPDF";
import PurchaseOrderPDF from "./PurchaseOrderPDF";
import PurchaseReturnOrderPDF from "./PurchaseReturnOrderPDF";
import PurchasingRfqPDF from "./PurchasingRfqPDF";
import { DOCUMENT_PDFS } from "./preview-documents";
import { SAMPLE_PURCHASE_RETURN_ORDER } from "./purchaseReturnOrder.samples";
import QuotePDF from "./QuotePDF";
import SalesInvoicePDF from "./SalesInvoicePDF";
import SalesOrderPDF from "./SalesOrderPDF";
import SalesReturnOrderPDF from "./SalesReturnOrderPDF";
import type {
  ServiceJobEstimate,
  ServiceJobEstimateLine
} from "./ServiceJobEstimatePDF";
import ServiceJobEstimatePDF from "./ServiceJobEstimatePDF";
import StockTransferPDF from "./StockTransferPDF";
import StorageUnitLabelPDF from "./StorageUnitLabelPDF";
import { SAMPLE_SALES_ORDER } from "./salesOrder.samples";
import { SAMPLE_SALES_RETURN_ORDER } from "./salesReturnOrder.samples";
import { SAMPLE_SALES_INVOICE } from "./samples";
import { SAMPLE_TRACKING_LABEL } from "./trackingLabel.samples";

export { documentChrome } from "./blocks/documentChrome";
export type {
  BatchListMember,
  CertificateOfConformanceConformity,
  CertificateOfConformanceData,
  CertificateOfConformanceHeader,
  CertificateOfConformanceLine,
  CertificateSigner,
  ContractFinancingEventRow,
  ContractFinancingRow,
  FirstArticleInspectionPDFCharacteristic,
  FirstArticleInspectionPDFHeader,
  FirstArticleInspectionPDFIndexRow,
  FirstArticleInspectionPDFProduct,
  FirstArticleInspectionPDFProps,
  JobTravelerMaterial,
  ProjectReaderSection,
  PurchaseOrderApproval,
  ServiceJobEstimate,
  ServiceJobEstimateLine
};
export {
  BatchListPDF,
  buildJobTravelerVars,
  CertificateOfConformancePDF,
  CONFORMITY_STATEMENT,
  ContractFinancingRequestPDF,
  DOCUMENT_PDFS,
  ensureFont,
  FirstArticleInspectionPDF,
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
  SAMPLE_CERTIFICATE_OF_CONFORMANCE,
  SAMPLE_FIRST_ARTICLE_INSPECTION,
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
