/*
License: MIT
Author: Pontus Abrahamssons
Repository: https://github.com/midday-ai/zuno
*/

import type {
  Account,
  Attachment,
  Bill,
  BulkExport,
  CompanyInfo,
  Customer,
  Expense,
  Invoice,
  Item,
  JournalEntry,
  Pagination,
  Payment,
  Transaction,
  Vendor,
} from "./models";

export interface ProviderConfig {
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
  baseUrl?: string;
  accessToken?: string;
  refreshToken?: string;
  tenantId?: string;
  apiVersion?: string;
  environment?: "production" | "sandbox";
}

export interface ProviderAuth {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  tenantId?: string;
  scope?: string[];
}

export interface SyncOptions {
  modifiedSince?: Date;
  includeArchived?: boolean;
  includeDeleted?: boolean;
  batchSize?: number;
  page?: number;
  limit?: number;
  cursor?: string;
  search?: string;
  dateFrom?: Date;
  dateTo?: Date;
  status?: string;
  entityId?: string;
  entityType?: string;
  includeAttachments?: boolean;
  includeCustomFields?: boolean;
  includeRawData?: boolean;
}

export interface SyncResult<T> {
  data: T[];
  pagination?: Pagination;
  hasMore: boolean;
  cursor?: string;
  total?: number;
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: Date;
  retryAfter?: number;
}

export interface WebhookEvent {
  id: string;
  type: string;
  data: any;
  timestamp: Date;
  signature?: string;
}

export interface ExportJobStatus {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  progress: number;
  totalRecords?: number;
  processedRecords?: number;
  downloadUrl?: string;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

export abstract class CoreProvider {
  protected config: ProviderConfig;
  protected auth?: ProviderAuth;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  protected setAuth(auth: ProviderAuth) {
    this.auth = auth;
  }

  protected revokeAuth(): Promise<void> {
    return Promise.resolve();
  }

  // Authentication methods
  abstract getAuthUrl(scopes: string[]): string;
  abstract exchangeCodeForToken(code: string): Promise<ProviderAuth>;
  abstract refreshAccessToken(): Promise<ProviderAuth>;
  abstract validateAuth(): Promise<boolean>;

  // Company information
  abstract getCompanyInfo(): Promise<CompanyInfo>;

  // Account operations (Chart of Accounts)
  abstract getAccounts(options?: SyncOptions): Promise<SyncResult<Account>>;
  abstract getAccount(id: string): Promise<Account>;
  abstract createAccount(
    account: Omit<Account, "id" | "createdAt" | "updatedAt">
  ): Promise<Account>;
  abstract updateAccount(
    id: string,
    account: Partial<Account>
  ): Promise<Account>;
  abstract deleteAccount(id: string): Promise<void>;

  // Customer operations
  abstract getCustomers(options?: SyncOptions): Promise<SyncResult<Customer>>;
  abstract getCustomer(id: string): Promise<Customer>;
  abstract createCustomer(
    customer: Omit<Customer, "id" | "createdAt" | "updatedAt">
  ): Promise<Customer>;
  abstract updateCustomer(
    id: string,
    customer: Partial<Customer>
  ): Promise<Customer>;
  abstract deleteCustomer(id: string): Promise<void>;

  // Vendor operations
  abstract getVendors(options?: SyncOptions): Promise<SyncResult<Vendor>>;
  abstract getVendor(id: string): Promise<Vendor>;
  abstract createVendor(
    vendor: Omit<Vendor, "id" | "createdAt" | "updatedAt">
  ): Promise<Vendor>;
  abstract updateVendor(id: string, vendor: Partial<Vendor>): Promise<Vendor>;
  abstract deleteVendor(id: string): Promise<void>;

  // Item operations
  abstract getItems(options?: SyncOptions): Promise<SyncResult<Item>>;
  abstract getItem(id: string): Promise<Item>;
  abstract createItem(
    item: Omit<Item, "id" | "createdAt" | "updatedAt">
  ): Promise<Item>;
  abstract updateItem(id: string, item: Partial<Item>): Promise<Item>;
  abstract deleteItem(id: string): Promise<void>;

  // Invoice operations
  abstract getInvoices(options?: SyncOptions): Promise<SyncResult<Invoice>>;
  abstract getInvoice(id: string): Promise<Invoice>;
  abstract createInvoice(
    invoice: Omit<Invoice, "id" | "createdAt" | "updatedAt">
  ): Promise<Invoice>;
  abstract updateInvoice(
    id: string,
    invoice: Partial<Invoice>
  ): Promise<Invoice>;
  abstract deleteInvoice(id: string): Promise<void>;
  abstract sendInvoice(
    id: string,
    options?: { email?: string; subject?: string; message?: string }
  ): Promise<void>;

  // Bill operations
  abstract getBills(options?: SyncOptions): Promise<SyncResult<Bill>>;
  abstract getBill(id: string): Promise<Bill>;
  abstract createBill(
    bill: Omit<Bill, "id" | "createdAt" | "updatedAt">
  ): Promise<Bill>;
  abstract updateBill(id: string, bill: Partial<Bill>): Promise<Bill>;
  abstract deleteBill(id: string): Promise<void>;

  // Transaction operations
  abstract getTransactions(
    options?: SyncOptions
  ): Promise<SyncResult<Transaction>>;
  abstract getTransaction(id: string): Promise<Transaction>;
  abstract createTransaction(
    transaction: Omit<Transaction, "id" | "createdAt" | "updatedAt">
  ): Promise<Transaction>;
  abstract updateTransaction(
    id: string,
    transaction: Partial<Transaction>
  ): Promise<Transaction>;
  abstract deleteTransaction(id: string): Promise<void>;
  abstract reconcileTransaction(
    id: string,
    bankTransactionId: string
  ): Promise<Transaction>;

  // Expense operations
  abstract getExpenses(options?: SyncOptions): Promise<SyncResult<Expense>>;
  abstract getExpense(id: string): Promise<Expense>;
  abstract createExpense(
    expense: Omit<Expense, "id" | "createdAt" | "updatedAt">
  ): Promise<Expense>;
  abstract updateExpense(
    id: string,
    expense: Partial<Expense>
  ): Promise<Expense>;
  abstract deleteExpense(id: string): Promise<void>;
  abstract submitExpense(id: string): Promise<Expense>;
  abstract approveExpense(id: string): Promise<Expense>;
  abstract rejectExpense(id: string, reason?: string): Promise<Expense>;

  // Journal Entry operations
  abstract getJournalEntries(
    options?: SyncOptions
  ): Promise<SyncResult<JournalEntry>>;
  abstract getJournalEntry(id: string): Promise<JournalEntry>;
  abstract createJournalEntry(
    journalEntry: Omit<JournalEntry, "id" | "createdAt" | "updatedAt">
  ): Promise<JournalEntry>;
  abstract updateJournalEntry(
    id: string,
    journalEntry: Partial<JournalEntry>
  ): Promise<JournalEntry>;
  abstract deleteJournalEntry(id: string): Promise<void>;
  abstract postJournalEntry(id: string): Promise<JournalEntry>;

  // Payment operations
  abstract getPayments(options?: SyncOptions): Promise<SyncResult<Payment>>;
  abstract getPayment(id: string): Promise<Payment>;
  abstract createPayment(
    payment: Omit<Payment, "id" | "createdAt" | "updatedAt">
  ): Promise<Payment>;
  abstract updatePayment(
    id: string,
    payment: Partial<Payment>
  ): Promise<Payment>;
  abstract deletePayment(id: string): Promise<void>;
  abstract processPayment(id: string): Promise<Payment>;

  // Attachment operations (read-only)
  abstract getAttachments(
    entityType: string,
    entityId: string,
    attachmentType?: string
  ): Promise<Attachment[]>;
  abstract getAttachment(id: string): Promise<Attachment>;
  abstract downloadAttachment(id: string): Promise<ReadableStream | null>;
  abstract getAttachmentMetadata(id: string): Promise<any>;

  // Optional attachment methods
  generateSignedUrl?(attachmentId: string, expiresIn?: number): Promise<string>;
  streamAttachment?(attachmentId: string): Promise<ReadableStream>;

  // Bulk operations
  abstract bulkCreate<T>(
    entityType: string,
    entities: T[]
  ): Promise<{ success: T[]; failed: { entity: T; error: string }[] }>;
  abstract bulkUpdate<T>(
    entityType: string,
    entities: { id: string; data: Partial<T> }[]
  ): Promise<{ success: T[]; failed: { id: string; error: string }[] }>;
  abstract bulkDelete(
    entityType: string,
    ids: string[]
  ): Promise<{ success: string[]; failed: { id: string; error: string }[] }>;

  // Export operations
  abstract startBulkExport(request: BulkExport): Promise<string>; // Returns job ID
  abstract getBulkExportStatus(jobId: string): Promise<ExportJobStatus>;
  abstract downloadBulkExport(jobId: string): Promise<ReadableStream>;
  abstract cancelBulkExport(jobId: string): Promise<void>;

  // Search operations
  abstract searchEntities(
    entityType: string,
    query: string,
    options?: SyncOptions
  ): Promise<SyncResult<any>>;
  abstract searchAttachments(
    query: string,
    entityType?: string,
    entityId?: string
  ): Promise<Attachment[]>;

  // Webhook operations
  abstract createWebhook(
    url: string,
    events: string[]
  ): Promise<{ id: string; secret: string }>;
  abstract updateWebhook(
    id: string,
    url?: string,
    events?: string[]
  ): Promise<void>;
  abstract deleteWebhook(id: string): Promise<void>;
  abstract getWebhooks(): Promise<
    { id: string; url: string; events: string[]; active: boolean }[]
  >;
  abstract verifyWebhook(
    payload: string,
    signature: string,
    secret: string
  ): boolean;
  abstract processWebhook(payload: WebhookEvent): Promise<void>;

  // Reporting operations
  abstract getBalanceSheet(
    date?: Date,
    options?: { includeComparison?: boolean }
  ): Promise<any>;
  abstract getIncomeStatement(
    startDate?: Date,
    endDate?: Date,
    options?: { includeComparison?: boolean }
  ): Promise<any>;
  abstract getCashFlowStatement(startDate?: Date, endDate?: Date): Promise<any>;
  abstract getTrialBalance(date?: Date): Promise<any>;
  abstract getAgingReport(
    type: "receivables" | "payables",
    date?: Date
  ): Promise<any>;

  // Utility methods
  abstract getRateLimitInfo(): Promise<RateLimitInfo>;
  abstract getProviderInfo(): {
    name: string;
    version: string;
    capabilities: string[];
  };
  abstract validateEntity(
    entityType: string,
    data: any
  ): Promise<{ valid: boolean; errors: string[] }>;
  abstract transformEntity(
    entityType: string,
    data: any,
    direction: "to" | "from"
  ): Promise<any>;
  abstract getMetadata(
    entityType: string
  ): Promise<{ fields: any; relationships: any; actions: string[] }>;

  // Helper methods for providers
  protected async makeRequest(
    endpoint: string,
    request: RequestInit = {}
  ): Promise<Response> {
    const url = new URL(endpoint, this.config.baseUrl);
    const { method = "GET", headers = {}, body } = request;

    const requestHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      ...(headers as Record<string, string>),
    };

    if (this.auth?.accessToken) {
      requestHeaders["Authorization"] = `Bearer ${this.auth.accessToken}`;
    }

    const requestOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    if (body && method !== "GET") {
      requestOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url.toString(), requestOptions);

    // Handle rate limiting
    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      if (retryAfter) {
        await new Promise((resolve) =>
          setTimeout(resolve, parseInt(retryAfter) * 1000)
        );
        return this.makeRequest(endpoint, request);
      }
    }

    // Handle auth errors
    if (response.status === 401 && this.auth?.refreshToken) {
      try {
        await this.refreshAccessToken();
        const updatedHeaders: Record<string, string> = { ...requestHeaders };
        updatedHeaders["Authorization"] = `Bearer ${this.auth.accessToken}`;
        return fetch(url.toString(), {
          ...requestOptions,
          headers: updatedHeaders,
        });
      } catch (error) {
        throw new Error("Authentication failed and refresh token is invalid");
      }
    }

    return response;
  }

  protected handleError(error: any, context?: string): never {
    const message = context ? `${context}: ${error.message}` : error.message;
    throw new Error(message);
  }

  protected validateConfig(): void {
    if (!this.config.clientId || !this.config.clientSecret) {
      throw new Error("Client ID and Client Secret are required");
    }
  }

  protected async retryOperation<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    delay: number = 1000
  ): Promise<T> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await operation();
      } catch (error) {
        if (i === maxRetries - 1) throw error;
        await new Promise((resolve) =>
          setTimeout(resolve, delay * Math.pow(2, i))
        );
      }
    }
    throw new Error("Max retries exceeded");
  }

  protected generateChecksum(data: string): string {
    // Simple checksum for data integrity
    let checksum = 0;
    for (let i = 0; i < data.length; i++) {
      checksum += data.charCodeAt(i);
    }
    return checksum.toString(16);
  }

  protected formatDate(date: Date): string {
    return date.toISOString().split("T")[0];
  }

  protected parseDate(dateString: string): Date {
    return new Date(dateString);
  }

  protected sanitizeData(data: any): any {
    // Remove sensitive information before logging
    const sanitized = { ...data };
    const sensitiveFields = ["password", "token", "secret", "key", "auth"];

    for (const field of sensitiveFields) {
      if (sanitized[field]) {
        sanitized[field] = "[REDACTED]";
      }
    }

    return sanitized;
  }
}
