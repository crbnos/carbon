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
  Payment,
  Transaction,
  Vendor,
} from "../models";
import type {
  ExportJobStatus,
  ProviderAuth,
  ProviderConfig,
  RateLimitInfo,
  SyncOptions,
  SyncResult,
  WebhookEvent,
} from "../service";
import { CoreProvider } from "../service";

export class XeroProvider extends CoreProvider {
  private baseUrl = "https://api.xero.com/api.xro/2.0";

  constructor(config: ProviderConfig) {
    super(config);
    if (config.baseUrl) {
      this.baseUrl = config.baseUrl;
    }
  }

  getAuthUrl(scopes: string[]): string {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri || "",
      scope: scopes.join(" "),
      state: crypto.randomUUID(),
    });

    return `https://login.xero.com/identity/connect/authorize?${params.toString()}`;
  }

  async exchangeCodeForToken(code: string): Promise<ProviderAuth> {
    const response = await fetch("https://identity.xero.com/connect/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(
          `${this.config.clientId}:${this.config.clientSecret}`
        )}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: this.config.redirectUri || "",
      }),
    });

    if (!response.ok) {
      throw new Error(`Auth failed: ${response.statusText}`);
    }

    const data = (await response.json()) as any;

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    };
  }

  async refreshAccessToken(): Promise<ProviderAuth> {
    if (!this.auth?.refreshToken) {
      throw new Error("No refresh token available");
    }

    const response = await fetch("https://identity.xero.com/connect/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(
          `${this.config.clientId}:${this.config.clientSecret}`
        )}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.auth.refreshToken,
      }),
    });

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.statusText}`);
    }

    const data = (await response.json()) as any;

    const newAuth = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    };

    this.setAuth(newAuth);
    return newAuth;
  }

  async validateAuth(): Promise<boolean> {
    if (!this.auth?.accessToken) {
      return false;
    }

    try {
      const response = await this.makeRequest("/Organisation");
      return response.ok;
    } catch {
      return false;
    }
  }

  protected async makeRequest(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<Response> {
    if (!this.auth?.accessToken) {
      throw new Error("No access token available");
    }

    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.auth.accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (response.status === 401) {
      // Try to refresh token
      await this.refreshAccessToken();

      // Retry the request
      return fetch(url, {
        ...options,
        headers: {
          Authorization: `Bearer ${this.auth.accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          ...options.headers,
        },
      });
    }

    return response;
  }

  private transformXeroCustomer(xeroCustomer: any): Customer {
    return {
      id: xeroCustomer.ContactID,
      name: xeroCustomer.Name,
      email: xeroCustomer.EmailAddress,
      phone: xeroCustomer.Phones?.[0]?.PhoneNumber,
      addresses: xeroCustomer.Addresses?.[0]
        ? [
            {
              street: xeroCustomer.Addresses[0].AddressLine1,
              city: xeroCustomer.Addresses[0].City,
              state: xeroCustomer.Addresses[0].Region,
              postalCode: xeroCustomer.Addresses[0].PostalCode,
              country: xeroCustomer.Addresses[0].Country,
            },
          ]
        : undefined,
      taxNumber: xeroCustomer.TaxNumber,
      currency: xeroCustomer.DefaultCurrency || "USD",
      isActive: xeroCustomer.ContactStatus === "ACTIVE",
      createdAt: xeroCustomer.CreatedDateUTC || new Date().toISOString(),
      updatedAt: xeroCustomer.UpdatedDateUTC || new Date().toISOString(),
    };
  }

  async getCustomers(options?: SyncOptions): Promise<SyncResult<Customer>> {
    const params = new URLSearchParams();

    if (options?.modifiedSince) {
      params.append("If-Modified-Since", options.modifiedSince.toISOString());
    }

    if (options?.includeArchived) {
      params.append("includeArchived", "true");
    }

    const response = await this.makeRequest(`/Contacts?${params.toString()}`);

    if (!response.ok) {
      throw new Error(`Failed to get customers: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    const customers = data.Contacts.map(this.transformXeroCustomer);

    return {
      data: customers,
      hasMore: false, // Xero doesn't use cursor-based pagination in this example
      pagination: {
        page: 1,
        limit: customers.length,
        total: customers.length,
        hasNext: false,
      },
    };
  }

  async getAccounts(options?: SyncOptions): Promise<SyncResult<Account>> {
    throw new Error("Not implemented yet");
  }

  async getAccount(id: string): Promise<Account> {
    throw new Error("Not implemented yet");
  }

  async createAccount(
    account: Omit<Account, "id" | "createdAt" | "updatedAt">
  ): Promise<Account> {
    throw new Error("Not implemented yet");
  }

  async updateAccount(id: string, account: Partial<Account>): Promise<Account> {
    throw new Error("Not implemented yet");
  }

  async deleteAccount(id: string): Promise<void> {
    throw new Error("Not implemented yet");
  }

  async getCompanyInfo(): Promise<CompanyInfo> {
    throw new Error("Not implemented yet");
  }

  async getCustomer(id: string): Promise<Customer> {
    const response = await this.makeRequest(`/Contacts/${id}`);

    if (!response.ok) {
      throw new Error(`Failed to get customer: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    return this.transformXeroCustomer(data.Contacts[0]);
  }

  async createCustomer(
    customer: Omit<Customer, "id" | "createdAt" | "updatedAt">
  ): Promise<Customer> {
    const xeroCustomer = {
      Name: customer.name,
      EmailAddress: customer.email,
      Phones: customer.phone
        ? [{ PhoneType: "DEFAULT", PhoneNumber: customer.phone }]
        : [],
      Addresses: customer.addresses?.[0]
        ? [
            {
              AddressType: "STREET",
              AddressLine1: customer.addresses[0].street,
              City: customer.addresses[0].city,
              Region: customer.addresses[0].state,
              PostalCode: customer.addresses[0].postalCode,
              Country: customer.addresses[0].country,
            },
          ]
        : [],
    };

    const response = await this.makeRequest("/Contacts", {
      method: "POST",
      body: JSON.stringify({ Contacts: [xeroCustomer] }),
    });

    if (!response.ok) {
      throw new Error(`Failed to create customer: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    return this.transformXeroCustomer(data.Contacts[0]);
  }

  async updateCustomer(
    id: string,
    customer: Partial<Customer>
  ): Promise<Customer> {
    // Similar implementation to createCustomer but with PUT method
    throw new Error("Not implemented yet");
  }

  async deleteCustomer(id: string): Promise<void> {
    // Xero doesn't support deletion, only archiving
    throw new Error("Xero does not support customer deletion, only archiving");
  }

  // Vendor operations
  async getVendors(options?: SyncOptions): Promise<SyncResult<Vendor>> {
    throw new Error("Not implemented yet");
  }

  async getVendor(id: string): Promise<Vendor> {
    throw new Error("Not implemented yet");
  }

  async createVendor(
    vendor: Omit<Vendor, "id" | "createdAt" | "updatedAt">
  ): Promise<Vendor> {
    throw new Error("Not implemented yet");
  }

  async updateVendor(id: string, vendor: Partial<Vendor>): Promise<Vendor> {
    throw new Error("Not implemented yet");
  }

  async deleteVendor(id: string): Promise<void> {
    throw new Error("Not implemented yet");
  }

  // Item operations
  async getItems(options?: SyncOptions): Promise<SyncResult<Item>> {
    throw new Error("Not implemented yet");
  }

  async getItem(id: string): Promise<Item> {
    throw new Error("Not implemented yet");
  }

  async createItem(
    item: Omit<Item, "id" | "createdAt" | "updatedAt">
  ): Promise<Item> {
    throw new Error("Not implemented yet");
  }

  async updateItem(id: string, item: Partial<Item>): Promise<Item> {
    throw new Error("Not implemented yet");
  }

  async deleteItem(id: string): Promise<void> {
    throw new Error("Not implemented yet");
  }

  // Invoice operations
  async getInvoices(options?: SyncOptions): Promise<SyncResult<Invoice>> {
    throw new Error("Not implemented yet");
  }

  async getInvoice(id: string): Promise<Invoice> {
    throw new Error("Not implemented yet");
  }

  async createInvoice(
    invoice: Omit<Invoice, "id" | "createdAt" | "updatedAt">
  ): Promise<Invoice> {
    throw new Error("Not implemented yet");
  }

  async updateInvoice(id: string, invoice: Partial<Invoice>): Promise<Invoice> {
    throw new Error("Not implemented yet");
  }

  async deleteInvoice(id: string): Promise<void> {
    throw new Error("Not implemented yet");
  }

  async sendInvoice(
    id: string,
    options?: { email?: string; subject?: string; message?: string }
  ): Promise<void> {
    throw new Error("Not implemented yet");
  }

  // Bill operations
  async getBills(options?: SyncOptions): Promise<SyncResult<Bill>> {
    throw new Error("Not implemented yet");
  }

  async getBill(id: string): Promise<Bill> {
    throw new Error("Not implemented yet");
  }

  async createBill(
    bill: Omit<Bill, "id" | "createdAt" | "updatedAt">
  ): Promise<Bill> {
    throw new Error("Not implemented yet");
  }

  async updateBill(id: string, bill: Partial<Bill>): Promise<Bill> {
    throw new Error("Not implemented yet");
  }

  async deleteBill(id: string): Promise<void> {
    throw new Error("Not implemented yet");
  }

  async getTransactions(
    options?: SyncOptions
  ): Promise<SyncResult<Transaction>> {
    throw new Error("Not implemented yet");
  }

  async getTransaction(id: string): Promise<Transaction> {
    throw new Error("Not implemented yet");
  }

  async createTransaction(
    transaction: Omit<Transaction, "id" | "createdAt" | "updatedAt">
  ): Promise<Transaction> {
    throw new Error("Not implemented yet");
  }

  async updateTransaction(
    id: string,
    transaction: Partial<Transaction>
  ): Promise<Transaction> {
    throw new Error("Not implemented yet");
  }

  async deleteTransaction(id: string): Promise<void> {
    throw new Error("Not implemented yet");
  }

  async reconcileTransaction(
    id: string,
    bankTransactionId: string
  ): Promise<Transaction> {
    throw new Error("Not implemented yet");
  }

  // Expense operations
  async getExpenses(options?: SyncOptions): Promise<SyncResult<Expense>> {
    throw new Error("Not implemented yet");
  }

  async getExpense(id: string): Promise<Expense> {
    throw new Error("Not implemented yet");
  }

  async createExpense(
    expense: Omit<Expense, "id" | "createdAt" | "updatedAt">
  ): Promise<Expense> {
    throw new Error("Not implemented yet");
  }

  async updateExpense(id: string, expense: Partial<Expense>): Promise<Expense> {
    throw new Error("Not implemented yet");
  }

  async deleteExpense(id: string): Promise<void> {
    throw new Error("Not implemented yet");
  }

  async submitExpense(id: string): Promise<Expense> {
    throw new Error("Not implemented yet");
  }

  async approveExpense(id: string): Promise<Expense> {
    throw new Error("Not implemented yet");
  }

  async rejectExpense(id: string, reason?: string): Promise<Expense> {
    throw new Error("Not implemented yet");
  }

  // Journal Entry operations
  async getJournalEntries(
    options?: SyncOptions
  ): Promise<SyncResult<JournalEntry>> {
    throw new Error("Not implemented yet");
  }

  async getJournalEntry(id: string): Promise<JournalEntry> {
    throw new Error("Not implemented yet");
  }

  async createJournalEntry(
    journalEntry: Omit<JournalEntry, "id" | "createdAt" | "updatedAt">
  ): Promise<JournalEntry> {
    throw new Error("Not implemented yet");
  }

  async updateJournalEntry(
    id: string,
    journalEntry: Partial<JournalEntry>
  ): Promise<JournalEntry> {
    throw new Error("Not implemented yet");
  }

  async deleteJournalEntry(id: string): Promise<void> {
    throw new Error("Not implemented yet");
  }

  async postJournalEntry(id: string): Promise<JournalEntry> {
    throw new Error("Not implemented yet");
  }

  // Payment operations
  async getPayments(options?: SyncOptions): Promise<SyncResult<Payment>> {
    throw new Error("Not implemented yet");
  }

  async getPayment(id: string): Promise<Payment> {
    throw new Error("Not implemented yet");
  }

  async createPayment(
    payment: Omit<Payment, "id" | "createdAt" | "updatedAt">
  ): Promise<Payment> {
    throw new Error("Not implemented yet");
  }

  async updatePayment(id: string, payment: Partial<Payment>): Promise<Payment> {
    throw new Error("Not implemented yet");
  }

  async deletePayment(id: string): Promise<void> {
    throw new Error("Not implemented yet");
  }

  async processPayment(id: string): Promise<Payment> {
    throw new Error("Not implemented yet");
  }

  async getAttachments(
    entityType: string,
    entityId: string,
    attachmentType?: string
  ): Promise<Attachment[]> {
    let endpoint = "";

    switch (entityType) {
      case "invoice":
        endpoint = `/Invoices/${entityId}/Attachments`;
        break;
      case "bill":
        endpoint = `/Bills/${entityId}/Attachments`;
        break;
      case "expense":
        endpoint = `/ExpenseClaims/${entityId}/Attachments`;
        break;
      case "transaction":
        endpoint = `/BankTransactions/${entityId}/Attachments`;
        break;
      default:
        throw new Error(
          `Attachments not supported for entity type: ${entityType}`
        );
    }

    const response = await this.makeRequest(endpoint);

    if (!response.ok) {
      throw new Error(`Failed to get attachments: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    return (
      data.Attachments?.map((att: any) => ({
        id: att.AttachmentID,
        filename: att.FileName,
        originalFilename: att.FileName,
        mimeType: att.MimeType,
        size: att.ContentLength,
        url: att.Url,
        downloadUrl: att.Url,
        entityType: entityType as any,
        entityId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })) || []
    );
  }

  async getAttachment(id: string): Promise<Attachment> {
    // Xero doesn't have a direct attachment endpoint, need to search through entities
    throw new Error("Direct attachment retrieval not supported by Xero API");
  }

  async downloadAttachment(id: string): Promise<ReadableStream | null> {
    // This would need to be implemented based on Xero's attachment download API
    const response = await this.makeRequest(`/Attachments/${id}/Content`);

    if (!response.ok) {
      return null;
    }

    return response.body;
  }

  async getAttachmentMetadata(id: string): Promise<any> {
    const response = await this.makeRequest(`/Attachments/${id}`);

    if (!response.ok) {
      throw new Error(
        `Failed to get attachment metadata: ${response.statusText}`
      );
    }

    return await response.json();
  }

  // Bulk operations
  async bulkCreate<T>(
    entityType: string,
    entities: T[]
  ): Promise<{ success: T[]; failed: { entity: T; error: string }[] }> {
    throw new Error("Not implemented yet");
  }

  async bulkUpdate<T>(
    entityType: string,
    entities: { id: string; data: Partial<T> }[]
  ): Promise<{ success: T[]; failed: { id: string; error: string }[] }> {
    throw new Error("Not implemented yet");
  }

  async bulkDelete(
    entityType: string,
    ids: string[]
  ): Promise<{ success: string[]; failed: { id: string; error: string }[] }> {
    throw new Error("Not implemented yet");
  }

  // Export operations
  async startBulkExport(request: BulkExport): Promise<string> {
    throw new Error("Not implemented yet");
  }

  async getBulkExportStatus(jobId: string): Promise<ExportJobStatus> {
    throw new Error("Not implemented yet");
  }

  async downloadBulkExport(jobId: string): Promise<ReadableStream> {
    throw new Error("Not implemented yet");
  }

  async cancelBulkExport(jobId: string): Promise<void> {
    throw new Error("Not implemented yet");
  }

  // Search operations
  async searchEntities(
    entityType: string,
    query: string,
    options?: SyncOptions
  ): Promise<SyncResult<any>> {
    throw new Error("Not implemented yet");
  }

  async searchAttachments(
    query: string,
    entityType?: string,
    entityId?: string
  ): Promise<Attachment[]> {
    throw new Error("Not implemented yet");
  }

  // Webhook operations
  async createWebhook(
    url: string,
    events: string[]
  ): Promise<{ id: string; secret: string }> {
    throw new Error("Not implemented yet");
  }

  async updateWebhook(
    id: string,
    url?: string,
    events?: string[]
  ): Promise<void> {
    throw new Error("Not implemented yet");
  }

  async deleteWebhook(id: string): Promise<void> {
    throw new Error("Not implemented yet");
  }

  async getWebhooks(): Promise<
    { id: string; url: string; events: string[]; active: boolean }[]
  > {
    throw new Error("Not implemented yet");
  }

  verifyWebhook(payload: string, signature: string, secret: string): boolean {
    throw new Error("Not implemented yet");
  }

  async processWebhook(payload: WebhookEvent): Promise<void> {
    throw new Error("Not implemented yet");
  }

  // Reporting operations
  async getBalanceSheet(
    date?: Date,
    options?: { includeComparison?: boolean }
  ): Promise<any> {
    throw new Error("Not implemented yet");
  }

  async getIncomeStatement(
    startDate?: Date,
    endDate?: Date,
    options?: { includeComparison?: boolean }
  ): Promise<any> {
    throw new Error("Not implemented yet");
  }

  async getCashFlowStatement(startDate?: Date, endDate?: Date): Promise<any> {
    throw new Error("Not implemented yet");
  }

  async getTrialBalance(date?: Date): Promise<any> {
    throw new Error("Not implemented yet");
  }

  async getAgingReport(
    type: "receivables" | "payables",
    date?: Date
  ): Promise<any> {
    throw new Error("Not implemented yet");
  }

  // Utility methods
  async validateEntity(
    entityType: string,
    data: any
  ): Promise<{ valid: boolean; errors: string[] }> {
    throw new Error("Not implemented yet");
  }

  async transformEntity(
    entityType: string,
    data: any,
    direction: "to" | "from"
  ): Promise<any> {
    throw new Error("Not implemented yet");
  }

  async getMetadata(
    entityType: string
  ): Promise<{ fields: any; relationships: any; actions: string[] }> {
    throw new Error("Not implemented yet");
  }

  async getRateLimitInfo(): Promise<RateLimitInfo> {
    // Xero rate limits are typically in response headers
    return {
      remaining: 100,
      reset: new Date(Date.now() + 60000),
      limit: 100,
    };
  }

  getProviderInfo(): { name: string; version: string; capabilities: string[] } {
    return {
      name: "Xero",
      version: "2.0",
      capabilities: ["customers", "invoices", "transactions", "attachments"],
    };
  }
}
