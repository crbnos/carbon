/**
 * Request/response models for the Avalara integration.
 *
 * These are intentionally scoped to the fields Carbon's consumers need (tax
 * determination #1044 and e-invoicing #1054) — this is not a full transcription
 * of the AvaTax swagger. Extend as consumers require more fields.
 */
export namespace Avalara {
  export type Environment = "sandbox" | "production";

  /** Which of the two Avalara API surfaces a request targets. */
  export type Surface = "avatax" | "einvoicing";

  // ---------------------------------------------------------------------------
  // AvaTax
  // ---------------------------------------------------------------------------

  /** `GET /api/v2/utilities/ping` */
  export type PingResult = {
    version: string;
    authenticated: boolean;
    authenticationType?: string;
    authenticatedUserName?: string | null;
    authenticatedUserId?: number | null;
    authenticatedAccountId?: number | null;
  };

  /** A subset of the AvaTax `CompanyModel`. */
  export type CompanyModel = {
    id: number;
    companyCode: string;
    name: string;
    isActive?: boolean;
    isDefault?: boolean;
    defaultCountry?: string;
  };

  /** AvaTax list envelope: `{ "@recordsetCount": n, value: T[] }`. */
  export type FetchResult<T> = {
    "@recordsetCount"?: number;
    value: T[];
  };

  export type DocumentType =
    | "SalesOrder"
    | "SalesInvoice"
    | "ReturnOrder"
    | "ReturnInvoice"
    | "PurchaseOrder"
    | "PurchaseInvoice";

  export type AddressInfo = {
    line1?: string;
    line2?: string;
    line3?: string;
    city?: string;
    region?: string;
    postalCode?: string;
    country?: string;
  };

  export type LineItemModel = {
    number?: string;
    quantity?: number;
    amount: number;
    taxCode?: string;
    itemCode?: string;
    description?: string;
    addresses?: { shipFrom?: AddressInfo; shipTo?: AddressInfo };
  };

  /** Body for `POST /api/v2/transactions/create`. */
  export type CreateTransactionModel = {
    type: DocumentType;
    companyCode: string;
    date: string;
    customerCode: string;
    /** Caller-supplied idempotency key (e.g. Carbon invoice id). */
    code?: string;
    /** When true, the document is committed on creation. */
    commit?: boolean;
    currencyCode?: string;
    addresses?: { shipFrom?: AddressInfo; shipTo?: AddressInfo };
    lines: LineItemModel[];
  };

  export type TransactionLineDetailModel = {
    jurisdictionCode?: string;
    jurisName?: string;
    jurisType?: string;
    taxName?: string;
    rate?: number;
    tax?: number;
    taxableAmount?: number;
    nonTaxableAmount?: number;
    country?: string;
    region?: string;
  };

  export type TransactionLineModel = {
    lineNumber?: string;
    tax?: number;
    taxableAmount?: number;
    details?: TransactionLineDetailModel[];
  };

  /** Response from create/commit/void transaction calls. */
  export type TransactionModel = {
    id?: number;
    code: string;
    companyId?: number;
    date?: string;
    status?: string;
    type?: DocumentType;
    totalAmount?: number;
    totalTax?: number;
    totalTaxable?: number;
    currencyCode?: string;
    lines?: TransactionLineModel[];
    summary?: TransactionLineDetailModel[];
  };

  /** `POST /api/v2/addresses/resolve` */
  export type AddressResolutionModel = {
    address?: AddressInfo;
    validatedAddresses?: AddressInfo[];
    coordinates?: { latitude?: number; longitude?: number };
    resolutionQuality?: string;
    messages?: Array<{ summary?: string; details?: string; severity?: string }>;
  };

  export type NexusModel = {
    id?: number;
    companyId?: number;
    country?: string;
    region?: string;
    jurisdictionTypeId?: string;
    jurisName?: string;
    nexusTypeId?: string;
  };

  // ---------------------------------------------------------------------------
  // E-invoicing
  // ---------------------------------------------------------------------------

  export type DocumentSubmitResponse = {
    id: string;
    status?: string;
    message?: string;
  };

  export type DocumentStatusEvent = {
    id: string;
    status: string;
    events?: Array<{ status?: string; timestamp?: string; message?: string }>;
  };

  export type Mandate = {
    countryCode: string;
    countryMandate?: string;
    description?: string;
    supportedByProvider?: boolean;
  };

  // ---------------------------------------------------------------------------
  // Errors
  // ---------------------------------------------------------------------------

  /** AvaTax error envelope: `{ error: { code, message, details: [...] } }`. */
  export type ErrorDetail = {
    code?: string;
    number?: number;
    message?: string;
    description?: string;
    faultCode?: string;
    severity?: string;
  };

  export type ErrorBody = {
    error?: {
      code?: string;
      message?: string;
      details?: ErrorDetail[];
    };
  };
}
