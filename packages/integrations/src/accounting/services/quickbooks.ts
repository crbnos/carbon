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
  ProviderAuth,
  ProviderConfig,
  RateLimitInfo,
  SyncOptions,
  SyncResult,
} from "../service";
import { CoreProvider } from "../service";

export class QuickBooksProvider extends CoreProvider {
  private baseUrl = "https://sandbox-quickbooks.api.intuit.com";
  private discoveryUrl = "https://appcenter.intuit.com/connect/oauth2";

  constructor(config: ProviderConfig) {
    super(config);
    if (config.environment === "production") {
      this.baseUrl = "https://quickbooks.api.intuit.com";
    }
  }

  getAuthUrl(scopes: string[]): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      scope: scopes.join(" ") || "com.intuit.quickbooks.accounting",
      redirect_uri: this.config.redirectUri || "",
      response_type: "code",
      access_type: "offline",
      state: crypto.randomUUID(),
    });

    return `${this.discoveryUrl}?${params.toString()}`;
  }

  async exchangeCodeForToken(code: string): Promise<ProviderAuth> {
    const response = await fetch(
      "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
      {
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
      }
    );

    if (!response.ok) {
      throw new Error(`Auth failed: ${response.statusText}`);
    }

    const data = (await response.json()) as any;

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
      tenantId: data.realmId, // QuickBooks uses realmId as tenant identifier
    };
  }

  async refreshAccessToken(): Promise<ProviderAuth> {
    if (!this.auth?.refreshToken) {
      throw new Error("No refresh token available");
    }

    const response = await fetch(
      "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
      {
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
      }
    );

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.statusText}`);
    }

    const data = (await response.json()) as any;

    const newAuth = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
      tenantId: this.auth.tenantId,
    };

    this.setAuth(newAuth);
    return newAuth;
  }

  async validateAuth(): Promise<boolean> {
    if (!this.auth?.accessToken || !this.auth?.tenantId) {
      return false;
    }

    try {
      const response = await this.request("/v3/company/companyinfo");
      return response.ok;
    } catch {
      return false;
    }
  }

  private async request(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<Response> {
    if (!this.auth?.tenantId) {
      throw new Error("No tenant ID available");
    }

    const url = `${this.baseUrl}${endpoint}/${this.auth.tenantId}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.headers as Record<string, string>),
    };

    if (this.auth?.accessToken) {
      headers["Authorization"] = `Bearer ${this.auth.accessToken}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    // Handle rate limiting
    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      if (retryAfter) {
        await new Promise((resolve) =>
          setTimeout(resolve, parseInt(retryAfter) * 1000)
        );
        return this.request(endpoint, options);
      }
    }

    // Handle token refresh
    if (response.status === 401 && this.auth?.refreshToken) {
      await this.refreshAccessToken();
      const updatedHeaders = { ...headers };
      updatedHeaders["Authorization"] = `Bearer ${this.auth.accessToken}`;
      return fetch(url, { ...options, headers: updatedHeaders });
    }

    return response;
  }

  // Transform data to unified format
  private transformCustomer(
    qbCustomer: any
  ): Customer & { syncToken?: string } {
    return {
      id: qbCustomer.Id,
      name: qbCustomer.Name,
      displayName: qbCustomer.DisplayName || qbCustomer.Name,
      email: qbCustomer.PrimaryEmailAddr?.Address,
      website: qbCustomer.WebAddr?.URI,
      phone: qbCustomer.PrimaryPhone?.FreeFormNumber
        ? {
            number: qbCustomer.PrimaryPhone.FreeFormNumber,
            type: "work" as any,
          }
        : undefined,
      addresses: this.transformAddresses(
        qbCustomer.BillAddr,
        qbCustomer.ShipAddr
      ),
      taxNumber: qbCustomer.ResaleNum,
      currency: qbCustomer.CurrencyRef?.value || "USD",
      paymentTerms: qbCustomer.PaymentMethodRef?.name,
      isActive: qbCustomer.Active,
      balance: qbCustomer.Balance,
      creditLimit: qbCustomer.CreditLimit,
      createdAt: qbCustomer.MetaData?.CreateTime || new Date().toISOString(),
      updatedAt:
        qbCustomer.MetaData?.LastUpdatedTime || new Date().toISOString(),
      syncToken: qbCustomer.SyncToken,
    };
  }

  private transformVendor(qbVendor: any): Vendor & { syncToken?: string } {
    return {
      id: qbVendor.Id,
      name: qbVendor.Name,
      displayName: qbVendor.DisplayName || qbVendor.Name,
      email: qbVendor.PrimaryEmailAddr?.Address,
      website: qbVendor.WebAddr?.URI,
      phone: qbVendor.PrimaryPhone?.FreeFormNumber
        ? {
            number: qbVendor.PrimaryPhone.FreeFormNumber,
            type: "work" as any,
          }
        : undefined,
      addresses: this.transformAddresses(qbVendor.BillAddr),
      taxNumber: qbVendor.TaxIdentifier,
      currency: qbVendor.CurrencyRef?.value || "USD",
      paymentTerms: qbVendor.PaymentMethodRef?.name,
      isActive: qbVendor.Active,
      balance: qbVendor.Balance,
      createdAt: qbVendor.MetaData?.CreateTime || new Date().toISOString(),
      updatedAt: qbVendor.MetaData?.LastUpdatedTime || new Date().toISOString(),
      syncToken: qbVendor.SyncToken,
    };
  }

  private transformAddresses(billAddr?: any, shipAddr?: any): any[] {
    const addresses = [];

    if (billAddr) {
      addresses.push({
        type: "billing" as any,
        street: billAddr.Line1,
        street2: billAddr.Line2,
        city: billAddr.City,
        state: billAddr.CountrySubDivisionCode,
        postalCode: billAddr.PostalCode,
        country: billAddr.Country,
      });
    }

    if (shipAddr && shipAddr.Id !== billAddr?.Id) {
      addresses.push({
        type: "shipping" as any,
        street: shipAddr.Line1,
        street2: shipAddr.Line2,
        city: shipAddr.City,
        state: shipAddr.CountrySubDivisionCode,
        postalCode: shipAddr.PostalCode,
        country: shipAddr.Country,
      });
    }

    return addresses.filter((addr) => addr.street || addr.city);
  }

  private transformInvoice(qbInvoice: any): Invoice & { syncToken?: string } {
    return {
      id: qbInvoice.Id,
      number: qbInvoice.DocNumber,
      customerId: qbInvoice.CustomerRef?.value,
      customerName: qbInvoice.CustomerRef?.name,
      issueDate: qbInvoice.TxnDate,
      dueDate: qbInvoice.DueDate,
      status: this.mapInvoiceStatus(qbInvoice.EmailStatus, qbInvoice.Balance),
      currency: qbInvoice.CurrencyRef?.value || "USD",
      subtotal: qbInvoice.TotalAmt - qbInvoice.TxnTaxDetail?.TotalTax || 0,
      taxAmount: qbInvoice.TxnTaxDetail?.TotalTax || 0,
      total: qbInvoice.TotalAmt,
      amountDue: qbInvoice.Balance,
      reference: qbInvoice.CustomerMemo?.value,
      notes: qbInvoice.PrivateNote,
      lineItems:
        qbInvoice.Line?.filter(
          (line: any) => line.DetailType === "SalesItemLineDetail"
        ).map((line: any) => ({
          id: line.Id,
          itemId: line.SalesItemLineDetail?.ItemRef?.value,
          description: line.Description,
          quantity: line.SalesItemLineDetail?.Qty,
          unitPrice: line.SalesItemLineDetail?.UnitPrice,
          discount: line.DiscountLineDetail?.DiscountPercent,
          total: line.Amount,
          taxAmount: line.SalesItemLineDetail?.TaxCodeRef?.value,
          accountId: line.SalesItemLineDetail?.ItemRef?.value,
        })) || [],
      createdAt: qbInvoice.MetaData?.CreateTime || new Date().toISOString(),
      updatedAt:
        qbInvoice.MetaData?.LastUpdatedTime || new Date().toISOString(),
      syncToken: qbInvoice.SyncToken,
    };
  }

  private mapInvoiceStatus(
    emailStatus: string,
    balance: number
  ): "draft" | "sent" | "paid" | "overdue" | "cancelled" | "void" {
    if (balance === 0) return "paid";
    if (emailStatus === "EmailSent") return "sent";
    return "draft";
  }

  private transformBill(qbBill: any): Bill & { syncToken?: string } {
    return {
      id: qbBill.Id,
      number: qbBill.DocNumber,
      vendorId: qbBill.VendorRef?.value,
      vendorName: qbBill.VendorRef?.name,
      issueDate: qbBill.TxnDate,
      dueDate: qbBill.DueDate,
      status: qbBill.Balance === 0 ? ("paid" as any) : ("sent" as any),
      currency: qbBill.CurrencyRef?.value || "USD",
      subtotal: qbBill.TotalAmt - qbBill.TxnTaxDetail?.TotalTax || 0,
      taxAmount: qbBill.TxnTaxDetail?.TotalTax || 0,
      total: qbBill.TotalAmt,
      amountDue: qbBill.Balance,
      reference: qbBill.MemoRef?.value,
      notes: qbBill.PrivateNote,
      createdAt: qbBill.MetaData?.CreateTime || new Date().toISOString(),
      updatedAt: qbBill.MetaData?.LastUpdatedTime || new Date().toISOString(),
      syncToken: qbBill.SyncToken,
    };
  }

  private transformItem(qbItem: any): Item & { syncToken?: string } {
    return {
      id: qbItem.Id,
      name: qbItem.Name,
      sku: qbItem.Sku,
      description: qbItem.Description,
      unitPrice: qbItem.UnitPrice,
      unitOfMeasure: qbItem.QtyOnHand?.UnitOfMeasure,
      isActive: qbItem.Active,
      isSold: qbItem.Type === "Service" || qbItem.Type === "Inventory",
      isPurchased: qbItem.Type === "Inventory",
      quantityOnHand: qbItem.QtyOnHand?.quantity,
      createdAt: qbItem.MetaData?.CreateTime || new Date().toISOString(),
      updatedAt: qbItem.MetaData?.LastUpdatedTime || new Date().toISOString(),
      syncToken: qbItem.SyncToken,
    };
  }

  private transformAccount(qbAccount: any): Account & { syncToken?: string } {
    return {
      id: qbAccount.Id,
      name: qbAccount.Name,
      code: qbAccount.AcctNum || qbAccount.Id,
      description: qbAccount.Description,
      accountType: this.mapAccountType(qbAccount.AccountType),
      accountSubType: qbAccount.AccountSubType,
      isActive: qbAccount.Active,
      currency: qbAccount.CurrencyRef?.value || "USD",
      currentBalance: qbAccount.CurrentBalance,
      createdAt: qbAccount.MetaData?.CreateTime || new Date().toISOString(),
      updatedAt:
        qbAccount.MetaData?.LastUpdatedTime || new Date().toISOString(),
      syncToken: qbAccount.SyncToken,
    };
  }

  private mapAccountType(
    qbType: string
  ):
    | "asset"
    | "liability"
    | "equity"
    | "income"
    | "expense"
    | "accounts_receivable"
    | "accounts_payable"
    | "bank"
    | "credit_card"
    | "current_asset"
    | "fixed_asset"
    | "other_asset"
    | "current_liability"
    | "long_term_liability"
    | "cost_of_goods_sold"
    | "other_income"
    | "other_expense" {
    switch (qbType) {
      case "Asset":
      case "Other Current Asset":
        return "current_asset";
      case "Fixed Asset":
        return "fixed_asset";
      case "Bank":
        return "bank";
      case "Accounts Receivable":
        return "accounts_receivable";
      case "Liability":
      case "Other Current Liability":
        return "current_liability";
      case "Long Term Liability":
        return "long_term_liability";
      case "Accounts Payable":
        return "accounts_payable";
      case "Credit Card":
        return "credit_card";
      case "Equity":
        return "equity";
      case "Income":
        return "income";
      case "Other Income":
        return "other_income";
      case "Expense":
        return "expense";
      case "Other Expense":
        return "other_expense";
      case "Cost of Goods Sold":
        return "cost_of_goods_sold";
      default:
        return "other_asset";
    }
  }

  private transformExpense(qbExpense: any): Expense & { syncToken?: string } {
    return {
      id: qbExpense.Id,
      amount: qbExpense.TotalAmt,
      currency: qbExpense.CurrencyRef?.value || "USD",
      date: qbExpense.TxnDate,
      description: qbExpense.PrivateNote || `Expense ${qbExpense.DocNumber}`,
      // accountId:
      //   qbExpense.Line?.[0]?.AccountBasedExpenseLineDetail?.AccountRef?.value,
      // accountName:
      //   qbExpense.Line?.[0]?.AccountBasedExpenseLineDetail?.AccountRef?.name,
      vendorId: qbExpense.EntityRef?.value,
      vendorName: qbExpense.EntityRef?.name,
      reference: qbExpense.DocNumber,
      paymentMethod: qbExpense.PaymentMethodRef?.value,
      accountId: qbExpense.AccountRef?.value,
      accountName: qbExpense.AccountRef?.name,
      status: "approved" as any,
      createdAt: qbExpense.MetaData?.CreateTime || new Date().toISOString(),
      updatedAt:
        qbExpense.MetaData?.LastUpdatedTime || new Date().toISOString(),
      syncToken: qbExpense.SyncToken,
    };
  }

  private transformPayment(qbPayment: any): Payment & { syncToken?: string } {
    return {
      id: qbPayment.Id,
      amount: qbPayment.TotalAmt,
      currency: qbPayment.CurrencyRef?.value || "USD",
      date: qbPayment.TxnDate,
      paymentMethod: qbPayment.PaymentMethodRef?.value,
      customerId: qbPayment.CustomerRef?.value,
      reference: qbPayment.PaymentRefNum,
      accountId: qbPayment.AccountRef?.value,
      accountName: qbPayment.AccountRef?.name,
      vendorId: qbPayment.EntityRef?.value,
      invoiceId: qbPayment.PaymentRef?.value,
      billId: qbPayment.BillRef?.value,
      contactName: qbPayment.ContactRef?.name,
      status: "completed" as any,
      createdAt: qbPayment.MetaData?.CreateTime || new Date().toISOString(),
      updatedAt:
        qbPayment.MetaData?.LastUpdatedTime || new Date().toISOString(),
      syncToken: qbPayment.SyncToken,
    };
  }

  // Helper methods to transform our data to QuickBooks format
  private customerToQB(
    customer: Omit<Customer, "id" | "createdAt" | "updatedAt">
  ): any {
    return {
      Name: customer.name,
      DisplayName: customer.displayName || customer.name,
      PrimaryEmailAddr: customer.email
        ? { Address: customer.email }
        : undefined,
      WebAddr: customer.website ? { URI: customer.website } : undefined,
      PrimaryPhone: customer.phone
        ? { FreeFormNumber: customer.phone.number }
        : undefined,
      BillAddr: customer.addresses?.[0]
        ? {
            Line1: customer.addresses[0].street,
            Line2: customer.addresses[0].street2,
            City: customer.addresses[0].city,
            CountrySubDivisionCode: customer.addresses[0].state,
            PostalCode: customer.addresses[0].postalCode,
            Country: customer.addresses[0].country,
          }
        : undefined,
      ResaleNum: customer.taxNumber,
      Active: customer.isActive !== false,
    };
  }

  private vendorToQB(
    vendor: Omit<Vendor, "id" | "createdAt" | "updatedAt">
  ): any {
    return {
      Name: vendor.name,
      DisplayName: vendor.displayName || vendor.name,
      PrimaryEmailAddr: vendor.email ? { Address: vendor.email } : undefined,
      WebAddr: vendor.website ? { URI: vendor.website } : undefined,
      PrimaryPhone: vendor.phone
        ? { FreeFormNumber: vendor.phone.number }
        : undefined,
      BillAddr: vendor.addresses?.[0]
        ? {
            Line1: vendor.addresses[0].street,
            Line2: vendor.addresses[0].street2,
            City: vendor.addresses[0].city,
            CountrySubDivisionCode: vendor.addresses[0].state,
            PostalCode: vendor.addresses[0].postalCode,
            Country: vendor.addresses[0].country,
          }
        : undefined,
      TaxIdentifier: vendor.taxNumber,
      Active: vendor.isActive !== false,
    };
  }

  // Company Info
  async getCompanyInfo(): Promise<CompanyInfo> {
    const response = await this.request("/v3/company/companyinfo");
    if (!response.ok) {
      throw new Error(`Failed to get company info: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    const company = data.QueryResponse.CompanyInfo[0];

    return {
      id: company.Id,
      name: company.CompanyName,
      legalName: company.LegalName || company.CompanyName,
      email: company.Email?.Address,
      phone: company.PrimaryPhone?.FreeFormNumber,
      website: company.WebAddr?.URI,
      addresses: company.CompanyAddr
        ? [
            {
              type: "billing" as any,
              street: company.CompanyAddr.Line1,
              street2: company.CompanyAddr.Line2,
              city: company.CompanyAddr.City,
              state: company.CompanyAddr.CountrySubDivisionCode,
              postalCode: company.CompanyAddr.PostalCode,
              country: company.CompanyAddr.Country,
            },
          ]
        : [],
      taxNumber: company.LegalAddr?.Line1, // QB doesn't have direct tax number
      baseCurrency: company.Country === "US" ? "USD" : "USD",
      createdAt: company.MetaData?.CreateTime || new Date().toISOString(),
      updatedAt: company.MetaData?.LastUpdatedTime || new Date().toISOString(),
    };
  }

  // Account operations
  async getAccounts(options?: SyncOptions): Promise<SyncResult<Account>> {
    const response = await this.request(
      "/v3/company/query?query=SELECT * FROM Account"
    );
    if (!response.ok) {
      throw new Error(`Failed to get accounts: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    const accounts =
      data.QueryResponse?.Account?.map(this.transformAccount.bind(this)) || [];

    return {
      data: accounts,
      hasMore: false,
      pagination: {
        page: 1,
        limit: accounts.length,
        total: accounts.length,
        hasNext: false,
      },
    };
  }

  async getAccount(id: string): Promise<Account> {
    const response = await this.request(
      `/v3/company/query?query=SELECT * FROM Account WHERE Id = '${id}'`
    );
    if (!response.ok) {
      throw new Error(`Failed to get account: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    const account = data.QueryResponse?.Account?.[0];

    if (!account) {
      throw new Error("Account not found");
    }

    return this.transformAccount(account);
  }

  async createAccount(
    account: Omit<Account, "id" | "createdAt" | "updatedAt">
  ): Promise<Account> {
    const qbAccount = {
      Name: account.name,
      AcctNum: account.code,
      Description: account.description,
      AccountType: account.accountType,
      Active: account.isActive !== false,
    };

    const response = await this.request("/v3/company/account", {
      method: "POST",
      body: JSON.stringify(qbAccount),
    });

    if (!response.ok) {
      throw new Error(`Failed to create account: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    return this.transformAccount(data.Account);
  }

  async updateAccount(id: string, account: Partial<Account>): Promise<Account> {
    // First get the existing account for sync token
    const existing = (await this.getAccount(id)) as Account & {
      syncToken?: string;
    };

    const qbAccount: any = {
      Id: id,
      SyncToken: existing.syncToken || "0",
    };

    if (account.name) qbAccount.Name = account.name;
    if (account.code) qbAccount.AcctNum = account.code;
    if (account.description) qbAccount.Description = account.description;
    if (account.isActive !== undefined) qbAccount.Active = account.isActive;

    const response = await this.request("/v3/company/account", {
      method: "POST",
      body: JSON.stringify(qbAccount),
    });

    if (!response.ok) {
      throw new Error(`Failed to update account: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    return this.transformAccount(data.Account);
  }

  async deleteAccount(id: string): Promise<void> {
    // QuickBooks doesn't allow deleting accounts, only deactivating
    await this.updateAccount(id, { isActive: false });
  }

  // Customer operations
  async getCustomers(options?: SyncOptions): Promise<SyncResult<Customer>> {
    let query = "SELECT * FROM Customer";
    if (options?.modifiedSince) {
      query += ` WHERE Metadata.LastUpdatedTime > '${options.modifiedSince.toISOString()}'`;
    }

    const response = await this.request(
      `/v3/company/query?query=${encodeURIComponent(query)}`
    );
    if (!response.ok) {
      throw new Error(`Failed to get customers: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    const customers =
      data.QueryResponse?.Customer?.map(this.transformCustomer.bind(this)) ||
      [];

    return {
      data: customers,
      hasMore: false,
      pagination: {
        page: 1,
        limit: customers.length,
        total: customers.length,
        hasNext: false,
      },
    };
  }

  async getCustomer(id: string): Promise<Customer> {
    const response = await this.request(
      `/v3/company/query?query=SELECT * FROM Customer WHERE Id = '${id}'`
    );
    if (!response.ok) {
      throw new Error(`Failed to get customer: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    const customer = data.QueryResponse?.Customer?.[0];

    if (!customer) {
      throw new Error("Customer not found");
    }

    return this.transformCustomer(customer);
  }

  async createCustomer(
    customer: Omit<Customer, "id" | "createdAt" | "updatedAt">
  ): Promise<Customer> {
    const qbCustomer = this.customerToQB(customer);

    const response = await this.request("/v3/company/customer", {
      method: "POST",
      body: JSON.stringify(qbCustomer),
    });

    if (!response.ok) {
      throw new Error(`Failed to create customer: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    return this.transformCustomer(data.Customer);
  }

  async updateCustomer(
    id: string,
    customer: Partial<Customer>
  ): Promise<Customer> {
    // First get the existing customer for sync token
    const existing = (await this.getCustomer(id)) as Customer & {
      syncToken?: string;
    };

    const qbCustomer: any = {
      Id: id,
      SyncToken: existing.syncToken || "0",
    };

    if (customer.name) qbCustomer.Name = customer.name;
    if (customer.displayName) qbCustomer.DisplayName = customer.displayName;
    if (customer.email)
      qbCustomer.PrimaryEmailAddr = { Address: customer.email };
    if (customer.website) qbCustomer.WebAddr = { URI: customer.website };
    if (customer.phone)
      qbCustomer.PrimaryPhone = { FreeFormNumber: customer.phone.number };
    if (customer.addresses?.[0]) {
      const addr = customer.addresses[0];
      qbCustomer.BillAddr = {
        Line1: addr.street,
        Line2: addr.street2,
        City: addr.city,
        CountrySubDivisionCode: addr.state,
        PostalCode: addr.postalCode,
        Country: addr.country,
      };
    }
    if (customer.taxNumber) qbCustomer.ResaleNum = customer.taxNumber;
    if (customer.isActive !== undefined) qbCustomer.Active = customer.isActive;

    const response = await this.request("/v3/company/customer", {
      method: "POST",
      body: JSON.stringify(qbCustomer),
    });

    if (!response.ok) {
      throw new Error(`Failed to update customer: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    return this.transformCustomer(data.Customer);
  }

  async deleteCustomer(id: string): Promise<void> {
    // QuickBooks doesn't allow deleting customers, only deactivating
    await this.updateCustomer(id, { isActive: false });
  }

  // Vendor operations
  async getVendors(options?: SyncOptions): Promise<SyncResult<Vendor>> {
    let query = "SELECT * FROM Vendor";
    if (options?.modifiedSince) {
      query += ` WHERE Metadata.LastUpdatedTime > '${options.modifiedSince.toISOString()}'`;
    }

    const response = await this.request(
      `/v3/company/query?query=${encodeURIComponent(query)}`
    );
    if (!response.ok) {
      throw new Error(`Failed to get vendors: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    const vendors =
      data.QueryResponse?.Vendor?.map(this.transformVendor.bind(this)) || [];

    return {
      data: vendors,
      hasMore: false,
      pagination: {
        page: 1,
        limit: vendors.length,
        total: vendors.length,
        hasNext: false,
      },
    };
  }

  async getVendor(id: string): Promise<Vendor> {
    const response = await this.request(
      `/v3/company/query?query=SELECT * FROM Vendor WHERE Id = '${id}'`
    );
    if (!response.ok) {
      throw new Error(`Failed to get vendor: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    const vendor = data.QueryResponse?.Vendor?.[0];

    if (!vendor) {
      throw new Error("Vendor not found");
    }

    return this.transformVendor(vendor);
  }

  async createVendor(
    vendor: Omit<Vendor, "id" | "createdAt" | "updatedAt">
  ): Promise<Vendor> {
    const qbVendor = this.vendorToQB(vendor);

    const response = await this.request("/v3/company/vendor", {
      method: "POST",
      body: JSON.stringify(qbVendor),
    });

    if (!response.ok) {
      throw new Error(`Failed to create vendor: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    return this.transformVendor(data.Vendor);
  }

  async updateVendor(id: string, vendor: Partial<Vendor>): Promise<Vendor> {
    // First get the existing vendor for sync token
    const existing = (await this.getVendor(id)) as Vendor & {
      syncToken?: string;
    };

    const qbVendor: any = {
      Id: id,
      SyncToken: existing.syncToken || "0",
    };

    if (vendor.name) qbVendor.Name = vendor.name;
    if (vendor.displayName) qbVendor.DisplayName = vendor.displayName;
    if (vendor.email) qbVendor.PrimaryEmailAddr = { Address: vendor.email };
    if (vendor.website) qbVendor.WebAddr = { URI: vendor.website };
    if (vendor.phone)
      qbVendor.PrimaryPhone = { FreeFormNumber: vendor.phone.number };
    if (vendor.addresses?.[0]) {
      const addr = vendor.addresses[0];
      qbVendor.BillAddr = {
        Line1: addr.street,
        Line2: addr.street2,
        City: addr.city,
        CountrySubDivisionCode: addr.state,
        PostalCode: addr.postalCode,
        Country: addr.country,
      };
    }
    if (vendor.taxNumber) qbVendor.TaxIdentifier = vendor.taxNumber;
    if (vendor.isActive !== undefined) qbVendor.Active = vendor.isActive;

    const response = await this.request("/v3/company/vendor", {
      method: "POST",
      body: JSON.stringify(qbVendor),
    });

    if (!response.ok) {
      throw new Error(`Failed to update vendor: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    return this.transformVendor(data.Vendor);
  }

  async deleteVendor(id: string): Promise<void> {
    // QuickBooks doesn't allow deleting vendors, only deactivating
    await this.updateVendor(id, { isActive: false });
  }

  // Item operations
  async getItems(options?: SyncOptions): Promise<SyncResult<Item>> {
    const response = await this.request(
      "/v3/company/query?query=SELECT * FROM Item"
    );
    if (!response.ok) {
      throw new Error(`Failed to get items: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    const items =
      data.QueryResponse?.Item?.map(this.transformItem.bind(this)) || [];

    return {
      data: items,
      hasMore: false,
      pagination: {
        page: 1,
        limit: items.length,
        total: items.length,
        hasNext: false,
      },
    };
  }

  async getItem(id: string): Promise<Item> {
    const response = await this.request(
      `/v3/company/query?query=SELECT * FROM Item WHERE Id = '${id}'`
    );
    if (!response.ok) {
      throw new Error(`Failed to get item: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    const item = data.QueryResponse?.Item?.[0];

    if (!item) {
      throw new Error("Item not found");
    }

    return this.transformItem(item);
  }

  async createItem(
    item: Omit<Item, "id" | "createdAt" | "updatedAt">
  ): Promise<Item> {
    const qbItem = {
      Name: item.name,
      Sku: item.sku,
      Description: item.description,
      UnitPrice: item.unitPrice,
      Type: item.isSold ? "Service" : "NonInventory",
      Active: item.isActive !== false,
    };

    const response = await this.request("/v3/company/item", {
      method: "POST",
      body: JSON.stringify(qbItem),
    });

    if (!response.ok) {
      throw new Error(`Failed to create item: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    return this.transformItem(data.Item);
  }

  async updateItem(id: string, item: Partial<Item>): Promise<Item> {
    // First get the existing item for sync token
    const existing = (await this.getItem(id)) as Item & { syncToken?: string };

    const qbItem: any = {
      Id: id,
      SyncToken: existing.syncToken || "0",
    };

    if (item.name) qbItem.Name = item.name;
    if (item.sku) qbItem.Sku = item.sku;
    if (item.description) qbItem.Description = item.description;
    if (item.unitPrice) qbItem.UnitPrice = item.unitPrice;
    if (item.isActive !== undefined) qbItem.Active = item.isActive;

    const response = await this.request("/v3/company/item", {
      method: "POST",
      body: JSON.stringify(qbItem),
    });

    if (!response.ok) {
      throw new Error(`Failed to update item: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    return this.transformItem(data.Item);
  }

  async deleteItem(id: string): Promise<void> {
    // QuickBooks doesn't allow deleting items, only deactivating
    await this.updateItem(id, { isActive: false });
  }

  // Invoice operations
  async getInvoices(options?: SyncOptions): Promise<SyncResult<Invoice>> {
    let query = "SELECT * FROM Invoice";
    if (options?.modifiedSince) {
      query += ` WHERE Metadata.LastUpdatedTime > '${options.modifiedSince.toISOString()}'`;
    }

    const response = await this.request(
      `/v3/company/query?query=${encodeURIComponent(query)}`
    );
    if (!response.ok) {
      throw new Error(`Failed to get invoices: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    const invoices =
      data.QueryResponse?.Invoice?.map(this.transformInvoice.bind(this)) || [];

    return {
      data: invoices,
      hasMore: false,
      pagination: {
        page: 1,
        limit: invoices.length,
        total: invoices.length,
        hasNext: false,
      },
    };
  }

  async getInvoice(id: string): Promise<Invoice> {
    const response = await this.request(
      `/v3/company/query?query=SELECT * FROM Invoice WHERE Id = '${id}'`
    );
    if (!response.ok) {
      throw new Error(`Failed to get invoice: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    const invoice = data.QueryResponse?.Invoice?.[0];

    if (!invoice) {
      throw new Error("Invoice not found");
    }

    return this.transformInvoice(invoice);
  }

  async createInvoice(
    invoice: Omit<Invoice, "id" | "createdAt" | "updatedAt">
  ): Promise<Invoice> {
    const qbInvoice = {
      CustomerRef: { value: invoice.customerId },
      TxnDate: invoice.issueDate,
      DueDate: invoice.dueDate,
      DocNumber: invoice.number,
      CustomerMemo: invoice.reference
        ? { value: invoice.reference }
        : undefined,
      PrivateNote: invoice.notes,
      Line:
        invoice.lineItems?.map((item) => ({
          DetailType: "SalesItemLineDetail",
          Amount: item.total,
          Description: item.description,
          SalesItemLineDetail: {
            ItemRef: { value: item.itemId },
            Qty: item.quantity,
            UnitPrice: item.unitPrice,
          },
        })) || [],
    };

    const response = await this.request("/v3/company/invoice", {
      method: "POST",
      body: JSON.stringify(qbInvoice),
    });

    if (!response.ok) {
      throw new Error(`Failed to create invoice: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    return this.transformInvoice(data.Invoice);
  }

  async updateInvoice(id: string, invoice: Partial<Invoice>): Promise<Invoice> {
    // First get the existing invoice for sync token
    const existing = (await this.getInvoice(id)) as Invoice & {
      syncToken?: string;
    };

    const qbInvoice: any = {
      Id: id,
      SyncToken: existing.syncToken || "0",
    };

    if (invoice.customerId)
      qbInvoice.CustomerRef = { value: invoice.customerId };
    if (invoice.issueDate) qbInvoice.TxnDate = invoice.issueDate;
    if (invoice.dueDate) qbInvoice.DueDate = invoice.dueDate;
    if (invoice.number) qbInvoice.DocNumber = invoice.number;
    if (invoice.reference)
      qbInvoice.CustomerMemo = { value: invoice.reference };
    if (invoice.notes) qbInvoice.PrivateNote = invoice.notes;
    if (invoice.lineItems) {
      qbInvoice.Line = invoice.lineItems.map((item) => ({
        DetailType: "SalesItemLineDetail",
        Amount: item.total,
        Description: item.description,
        SalesItemLineDetail: {
          ItemRef: { value: item.itemId },
          Qty: item.quantity,
          UnitPrice: item.unitPrice,
        },
      }));
    }

    const response = await this.request("/v3/company/invoice", {
      method: "POST",
      body: JSON.stringify(qbInvoice),
    });

    if (!response.ok) {
      throw new Error(`Failed to update invoice: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    return this.transformInvoice(data.Invoice);
  }

  async deleteInvoice(id: string): Promise<void> {
    // First get the existing invoice for sync token
    const existing = (await this.getInvoice(id)) as Invoice & {
      syncToken?: string;
    };

    const response = await this.request(
      `/v3/company/invoice?operation=delete`,
      {
        method: "POST",
        body: JSON.stringify({
          Id: id,
          SyncToken: existing.syncToken || "0",
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to delete invoice: ${response.statusText}`);
    }
  }

  async sendInvoice(
    id: string,
    options?: { email?: string; subject?: string; message?: string }
  ): Promise<void> {
    const response = await this.request(
      `/v3/company/invoice/${id}/send?sendTo=${options?.email || ""}`,
      {
        method: "POST",
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to send invoice: ${response.statusText}`);
    }
  }

  // Bill operations
  async getBills(options?: SyncOptions): Promise<SyncResult<Bill>> {
    const response = await this.request(
      "/v3/company/query?query=SELECT * FROM Bill"
    );
    if (!response.ok) {
      throw new Error(`Failed to get bills: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    const bills =
      data.QueryResponse?.Bill?.map(this.transformBill.bind(this)) || [];

    return {
      data: bills,
      hasMore: false,
      pagination: {
        page: 1,
        limit: bills.length,
        total: bills.length,
        hasNext: false,
      },
    };
  }

  async getBill(id: string): Promise<Bill> {
    const response = await this.request(
      `/v3/company/query?query=SELECT * FROM Bill WHERE Id = '${id}'`
    );
    if (!response.ok) {
      throw new Error(`Failed to get bill: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    const bill = data.QueryResponse?.Bill?.[0];

    if (!bill) {
      throw new Error("Bill not found");
    }

    return this.transformBill(bill);
  }

  async createBill(
    bill: Omit<Bill, "id" | "createdAt" | "updatedAt">
  ): Promise<Bill> {
    const qbBill = {
      VendorRef: { value: bill.vendorId },
      TxnDate: bill.issueDate,
      DueDate: bill.dueDate,
      DocNumber: bill.number,
      MemoRef: bill.reference ? { value: bill.reference } : undefined,
      PrivateNote: bill.notes,
      TotalAmt: bill.total,
    };

    const response = await this.request("/v3/company/bill", {
      method: "POST",
      body: JSON.stringify(qbBill),
    });

    if (!response.ok) {
      throw new Error(`Failed to create bill: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    return this.transformBill(data.Bill);
  }

  async updateBill(id: string, bill: Partial<Bill>): Promise<Bill> {
    // First get the existing bill for sync token
    const existing = (await this.getBill(id)) as Bill & { syncToken?: string };

    const qbBill: any = {
      Id: id,
      SyncToken: existing.syncToken || "0",
    };

    if (bill.vendorId) qbBill.VendorRef = { value: bill.vendorId };
    if (bill.issueDate) qbBill.TxnDate = bill.issueDate;
    if (bill.dueDate) qbBill.DueDate = bill.dueDate;
    if (bill.number) qbBill.DocNumber = bill.number;
    if (bill.reference) qbBill.MemoRef = { value: bill.reference };
    if (bill.notes) qbBill.PrivateNote = bill.notes;
    if (bill.total) qbBill.TotalAmt = bill.total;

    const response = await this.request("/v3/company/bill", {
      method: "POST",
      body: JSON.stringify(qbBill),
    });

    if (!response.ok) {
      throw new Error(`Failed to update bill: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    return this.transformBill(data.Bill);
  }

  async deleteBill(id: string): Promise<void> {
    // First get the existing bill for sync token
    const existing = (await this.getBill(id)) as Bill & { syncToken?: string };

    const response = await this.request(`/v3/company/bill?operation=delete`, {
      method: "POST",
      body: JSON.stringify({
        Id: id,
        SyncToken: existing.syncToken || "0",
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to delete bill: ${response.statusText}`);
    }
  }

  // Transaction operations (Limited)
  async getTransactions(
    options?: SyncOptions
  ): Promise<SyncResult<Transaction>> {
    // QuickBooks doesn't have a direct transactions endpoint
    // We can combine multiple entity types if needed
    return {
      data: [],
      hasMore: false,
      pagination: {
        page: 1,
        limit: 0,
        total: 0,
        hasNext: false,
      },
    };
  }

  async getTransaction(id: string): Promise<Transaction> {
    throw new Error(
      "Direct transaction operations not supported by QuickBooks API"
    );
  }

  async createTransaction(
    transaction: Omit<Transaction, "id" | "createdAt" | "updatedAt">
  ): Promise<Transaction> {
    throw new Error(
      "Direct transaction operations not supported by QuickBooks API"
    );
  }

  async updateTransaction(
    id: string,
    transaction: Partial<Transaction>
  ): Promise<Transaction> {
    throw new Error(
      "Direct transaction operations not supported by QuickBooks API"
    );
  }

  async deleteTransaction(id: string): Promise<void> {
    throw new Error(
      "Direct transaction operations not supported by QuickBooks API"
    );
  }

  async reconcileTransaction(
    id: string,
    bankTransactionId: string
  ): Promise<Transaction> {
    throw new Error(
      "Direct transaction operations not supported by QuickBooks API"
    );
  }

  // Expense operations
  async getExpenses(options?: SyncOptions): Promise<SyncResult<Expense>> {
    const response = await this.request(
      '/v3/company/query?query=SELECT * FROM Purchase WHERE PaymentType = "Cash"'
    );
    if (!response.ok) {
      throw new Error(`Failed to get expenses: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    const expenses =
      data.QueryResponse?.Purchase?.map(this.transformExpense.bind(this)) || [];

    return {
      data: expenses,
      hasMore: false,
      pagination: {
        page: 1,
        limit: expenses.length,
        total: expenses.length,
        hasNext: false,
      },
    };
  }

  async getExpense(id: string): Promise<Expense> {
    const response = await this.request(
      `/v3/company/query?query=SELECT * FROM Purchase WHERE Id = '${id}'`
    );
    if (!response.ok) {
      throw new Error(`Failed to get expense: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    const expense = data.QueryResponse?.Purchase?.[0];

    if (!expense) {
      throw new Error("Expense not found");
    }

    return this.transformExpense(expense);
  }

  async createExpense(
    expense: Omit<Expense, "id" | "createdAt" | "updatedAt">
  ): Promise<Expense> {
    const qbExpense = {
      EntityRef: expense.vendorId ? { value: expense.vendorId } : undefined,
      TxnDate: expense.date,
      TotalAmt: expense.amount,
      PaymentType: "Cash",
      PrivateNote: expense.description,
      Line: [
        {
          DetailType: "AccountBasedExpenseLineDetail",
          Amount: expense.amount,
          AccountBasedExpenseLineDetail: {
            AccountRef: { value: expense.accountId || expense.category },
          },
        },
      ],
    };

    const response = await this.request("/v3/company/purchase", {
      method: "POST",
      body: JSON.stringify(qbExpense),
    });

    if (!response.ok) {
      throw new Error(`Failed to create expense: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    return this.transformExpense(data.Purchase);
  }

  async updateExpense(id: string, expense: Partial<Expense>): Promise<Expense> {
    // First get the existing expense for sync token
    const existing = (await this.getExpense(id)) as Expense & {
      syncToken?: string;
    };

    const qbExpense: any = {
      Id: id,
      SyncToken: existing.syncToken || "0",
    };

    if (expense.vendorId) qbExpense.EntityRef = { value: expense.vendorId };
    if (expense.date) qbExpense.TxnDate = expense.date;
    if (expense.amount) qbExpense.TotalAmt = expense.amount;
    if (expense.description) qbExpense.PrivateNote = expense.description;
    if (expense.accountId || expense.category) {
      qbExpense.Line = [
        {
          DetailType: "AccountBasedExpenseLineDetail",
          Amount: expense.amount,
          AccountBasedExpenseLineDetail: {
            AccountRef: { value: expense.accountId || expense.category },
          },
        },
      ];
    }

    const response = await this.request("/v3/company/purchase", {
      method: "POST",
      body: JSON.stringify(qbExpense),
    });

    if (!response.ok) {
      throw new Error(`Failed to update expense: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    return this.transformExpense(data.Purchase);
  }

  async deleteExpense(id: string): Promise<void> {
    // First get the existing expense for sync token
    const existing = (await this.getExpense(id)) as Expense & {
      syncToken?: string;
    };

    const response = await this.request(
      `/v3/company/purchase?operation=delete`,
      {
        method: "POST",
        body: JSON.stringify({
          Id: id,
          SyncToken: existing.syncToken || "0",
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to delete expense: ${response.statusText}`);
    }
  }

  async submitExpense(id: string): Promise<Expense> {
    // QuickBooks doesn't have expense submission workflow
    return await this.getExpense(id);
  }

  async approveExpense(id: string): Promise<Expense> {
    // QuickBooks doesn't have expense approval workflow
    return await this.getExpense(id);
  }

  async rejectExpense(id: string, reason?: string): Promise<Expense> {
    // QuickBooks doesn't have expense rejection workflow
    return await this.getExpense(id);
  }

  // Journal Entry operations
  async getJournalEntries(
    options?: SyncOptions
  ): Promise<SyncResult<JournalEntry>> {
    const response = await this.request(
      "/v3/company/query?query=SELECT * FROM JournalEntry"
    );
    if (!response.ok) {
      throw new Error(`Failed to get journal entries: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    const journalEntries =
      data.QueryResponse?.JournalEntry?.map((entry: any) => ({
        id: entry.Id,
        number: entry.DocNumber,
        date: entry.TxnDate,
        description: entry.PrivateNote,
        reference: entry.DocNumber,
        status: "posted" as any,
        currency: "USD",
        createdAt: entry.MetaData?.CreateTime || new Date().toISOString(),
        updatedAt: entry.MetaData?.LastUpdatedTime || new Date().toISOString(),
      })) || [];

    return {
      data: journalEntries,
      hasMore: false,
      pagination: {
        page: 1,
        limit: journalEntries.length,
        total: journalEntries.length,
        hasNext: false,
      },
    };
  }

  async getJournalEntry(id: string): Promise<JournalEntry> {
    const response = await this.request(
      `/v3/company/query?query=SELECT * FROM JournalEntry WHERE Id = '${id}'`
    );
    if (!response.ok) {
      throw new Error(`Failed to get journal entry: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    const entry = data.QueryResponse?.JournalEntry?.[0];

    if (!entry) {
      throw new Error("Journal entry not found");
    }

    return {
      id: entry.Id,
      number: entry.DocNumber,
      date: entry.TxnDate,
      description: entry.PrivateNote,
      reference: entry.DocNumber,
      status: "posted" as any,
      currency: "USD",
      createdAt: entry.MetaData?.CreateTime || new Date().toISOString(),
      updatedAt: entry.MetaData?.LastUpdatedTime || new Date().toISOString(),
    };
  }

  async createJournalEntry(
    journalEntry: Omit<JournalEntry, "id" | "createdAt" | "updatedAt">
  ): Promise<JournalEntry> {
    const qbJournalEntry = {
      TxnDate: journalEntry.date,
      DocNumber: journalEntry.number,
      PrivateNote: journalEntry.description,
      Line:
        journalEntry.lineItems?.map((row) => ({
          DetailType: "JournalEntryLineDetail",
          Amount: row.debitAmount || row.creditAmount,
          Description: row.description,
          JournalEntryLineDetail: {
            PostingType: row.debitAmount ? "Debit" : "Credit",
            AccountRef: { value: row.accountId },
          },
        })) || [],
    };

    const response = await this.request("/v3/company/journalentry", {
      method: "POST",
      body: JSON.stringify(qbJournalEntry),
    });

    if (!response.ok) {
      throw new Error(`Failed to create journal entry: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    const entry = data.JournalEntry;

    return {
      id: entry.Id,
      number: entry.DocNumber,
      date: entry.TxnDate,
      description: entry.PrivateNote,
      reference: entry.DocNumber,
      status: "posted" as any,
      currency: "USD",
      createdAt: entry.MetaData?.CreateTime || new Date().toISOString(),
      updatedAt: entry.MetaData?.LastUpdatedTime || new Date().toISOString(),
    };
  }

  async updateJournalEntry(
    id: string,
    journalEntry: Partial<JournalEntry>
  ): Promise<JournalEntry> {
    // First get the existing entry for sync token
    const existing = (await this.getJournalEntry(id)) as JournalEntry & {
      syncToken?: string;
    };

    const qbJournalEntry: any = {
      Id: id,
      SyncToken: existing.syncToken || "0",
    };

    if (journalEntry.date) qbJournalEntry.TxnDate = journalEntry.date;
    if (journalEntry.number) qbJournalEntry.DocNumber = journalEntry.number;
    if (journalEntry.description)
      qbJournalEntry.PrivateNote = journalEntry.description;
    if (journalEntry.lineItems) {
      qbJournalEntry.Line = journalEntry.lineItems.map((row) => ({
        DetailType: "JournalEntryLineDetail",
        Amount: row.debitAmount || row.creditAmount,
        Description: row.description,
        JournalEntryLineDetail: {
          PostingType: row.debitAmount ? "Debit" : "Credit",
          AccountRef: { value: row.accountId },
        },
      }));
    }

    const response = await this.request("/v3/company/journalentry", {
      method: "POST",
      body: JSON.stringify(qbJournalEntry),
    });

    if (!response.ok) {
      throw new Error(`Failed to update journal entry: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    const entry = data.JournalEntry;

    return {
      id: entry.Id,
      number: entry.DocNumber,
      date: entry.TxnDate,
      description: entry.PrivateNote,
      reference: entry.DocNumber,
      status: "posted" as any,
      currency: "USD",
      createdAt: entry.MetaData?.CreateTime || new Date().toISOString(),
      updatedAt: entry.MetaData?.LastUpdatedTime || new Date().toISOString(),
    };
  }

  async deleteJournalEntry(id: string): Promise<void> {
    // First get the existing entry for sync token
    const existing = (await this.getJournalEntry(id)) as JournalEntry & {
      syncToken?: string;
    };

    const response = await this.request(
      `/v3/company/journalentry?operation=delete`,
      {
        method: "POST",
        body: JSON.stringify({
          Id: id,
          SyncToken: existing.syncToken || "0",
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to delete journal entry: ${response.statusText}`);
    }
  }

  async postJournalEntry(id: string): Promise<JournalEntry> {
    // QuickBooks journal entries are automatically posted
    return await this.getJournalEntry(id);
  }

  // Payment operations
  async getPayments(options?: SyncOptions): Promise<SyncResult<Payment>> {
    const response = await this.request(
      "/v3/company/query?query=SELECT * FROM Payment"
    );
    if (!response.ok) {
      throw new Error(`Failed to get payments: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    const payments =
      data.QueryResponse?.Payment?.map(this.transformPayment.bind(this)) || [];

    return {
      data: payments,
      hasMore: false,
      pagination: {
        page: 1,
        limit: payments.length,
        total: payments.length,
        hasNext: false,
      },
    };
  }

  async getPayment(id: string): Promise<Payment> {
    const response = await this.request(
      `/v3/company/query?query=SELECT * FROM Payment WHERE Id = '${id}'`
    );
    if (!response.ok) {
      throw new Error(`Failed to get payment: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    const payment = data.QueryResponse?.Payment?.[0];

    if (!payment) {
      throw new Error("Payment not found");
    }

    return this.transformPayment(payment);
  }

  async createPayment(
    payment: Omit<Payment, "id" | "createdAt" | "updatedAt">
  ): Promise<Payment> {
    const qbPayment = {
      CustomerRef: { value: payment.customerId },
      TxnDate: payment.date,
      TotalAmt: payment.amount,
      PaymentMethodRef: payment.paymentMethod
        ? { value: payment.paymentMethod }
        : undefined,
      PaymentRefNum: payment.reference,
    };

    const response = await this.request("/v3/company/payment", {
      method: "POST",
      body: JSON.stringify(qbPayment),
    });

    if (!response.ok) {
      throw new Error(`Failed to create payment: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    return this.transformPayment(data.Payment);
  }

  async updatePayment(id: string, payment: Partial<Payment>): Promise<Payment> {
    // First get the existing payment for sync token
    const existing = (await this.getPayment(id)) as Payment & {
      syncToken?: string;
    };

    const qbPayment: any = {
      Id: id,
      SyncToken: existing.syncToken || "0",
    };

    if (payment.customerId)
      qbPayment.CustomerRef = { value: payment.customerId };
    if (payment.date) qbPayment.TxnDate = payment.date;
    if (payment.amount) qbPayment.TotalAmt = payment.amount;
    if (payment.paymentMethod)
      qbPayment.PaymentMethodRef = { value: payment.paymentMethod };
    if (payment.reference) qbPayment.PaymentRefNum = payment.reference;

    const response = await this.request("/v3/company/payment", {
      method: "POST",
      body: JSON.stringify(qbPayment),
    });

    if (!response.ok) {
      throw new Error(`Failed to update payment: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    return this.transformPayment(data.Payment);
  }

  async deletePayment(id: string): Promise<void> {
    // First get the existing payment for sync token
    const existing = (await this.getPayment(id)) as Payment & {
      syncToken?: string;
    };

    const response = await this.request(
      `/v3/company/payment?operation=delete`,
      {
        method: "POST",
        body: JSON.stringify({
          Id: id,
          SyncToken: existing.syncToken || "0",
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to delete payment: ${response.statusText}`);
    }
  }

  async processPayment(id: string): Promise<Payment> {
    // QuickBooks payments are automatically processed
    return await this.getPayment(id);
  }

  // Attachment operations
  async getAttachments(
    entityType: string,
    entityId: string,
    attachmentType?: string
  ): Promise<Attachment[]> {
    const response = await this.request(
      `/v3/company/query?query=SELECT * FROM Attachable WHERE AttachableRef.EntityRef.value = '${entityId}'`
    );

    if (!response.ok) {
      throw new Error(`Failed to get attachments: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    return (
      data.QueryResponse?.Attachable?.map((att: any) => ({
        id: att.Id,
        filename: att.FileName,
        originalFilename: att.FileName,
        mimeType: att.ContentType,
        size: att.Size,
        url: att.TempDownloadUri,
        downloadUrl: att.TempDownloadUri,
        entityType: entityType as any,
        entityId,
        description: att.Note,
        createdAt: att.MetaData?.CreateTime || new Date().toISOString(),
        updatedAt: att.MetaData?.LastUpdatedTime || new Date().toISOString(),
      })) || []
    );
  }

  async getAttachment(id: string): Promise<Attachment> {
    const response = await this.request(
      `/v3/company/query?query=SELECT * FROM Attachable WHERE Id = '${id}'`
    );

    if (!response.ok) {
      throw new Error(`Failed to get attachment: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    const att = data.QueryResponse?.Attachable?.[0];

    if (!att) {
      throw new Error("Attachment not found");
    }

    return {
      id: att.Id,
      filename: att.FileName,
      originalFilename: att.FileName,
      mimeType: att.ContentType,
      size: att.Size,
      url: att.TempDownloadUri,
      downloadUrl: att.TempDownloadUri,
      entityType: "invoice" as any, // Default
      entityId: att.AttachableRef?.[0]?.EntityRef?.value,
      description: att.Note,
      createdAt: att.MetaData?.CreateTime || new Date().toISOString(),
      updatedAt: att.MetaData?.LastUpdatedTime || new Date().toISOString(),
    };
  }

  async downloadAttachment(id: string): Promise<ReadableStream | null> {
    const attachment = await this.getAttachment(id);

    if (!attachment.downloadUrl) {
      return null;
    }

    const response = await fetch(attachment.downloadUrl);

    if (!response.ok) {
      return null;
    }

    return response.body;
  }

  async getAttachmentMetadata(id: string): Promise<any> {
    const attachment = await this.getAttachment(id);
    return {
      id: attachment.id,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      size: attachment.size,
      url: attachment.url,
      description: attachment.description,
    };
  }

  // Bulk operations
  async bulkCreate<T>(
    entityType: string,
    entities: T[]
  ): Promise<{ success: T[]; failed: { entity: T; error: string }[] }> {
    const success: T[] = [];
    const failed: { entity: T; error: string }[] = [];

    for (const entity of entities) {
      try {
        let result: any;
        switch (entityType) {
          case "customers":
            result = await this.createCustomer(entity as any);
            break;
          case "vendors":
            result = await this.createVendor(entity as any);
            break;
          case "invoices":
            result = await this.createInvoice(entity as any);
            break;
          case "bills":
            result = await this.createBill(entity as any);
            break;
          case "items":
            result = await this.createItem(entity as any);
            break;
          case "accounts":
            result = await this.createAccount(entity as any);
            break;
          case "expenses":
            result = await this.createExpense(entity as any);
            break;
          case "payments":
            result = await this.createPayment(entity as any);
            break;
          case "journal_entries":
            result = await this.createJournalEntry(entity as any);
            break;
          default:
            throw new Error(
              `Bulk creation not supported for entity type: ${entityType}`
            );
        }
        success.push(result);
      } catch (error) {
        failed.push({
          entity,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return { success, failed };
  }

  async bulkUpdate<T>(
    entityType: string,
    entities: { id: string; data: Partial<T> }[]
  ): Promise<{ success: T[]; failed: { id: string; error: string }[] }> {
    const success: T[] = [];
    const failed: { id: string; error: string }[] = [];

    for (const { id, data } of entities) {
      try {
        let result: any;
        switch (entityType) {
          case "customers":
            result = await this.updateCustomer(id, data as any);
            break;
          case "vendors":
            result = await this.updateVendor(id, data as any);
            break;
          case "invoices":
            result = await this.updateInvoice(id, data as any);
            break;
          case "bills":
            result = await this.updateBill(id, data as any);
            break;
          case "items":
            result = await this.updateItem(id, data as any);
            break;
          case "accounts":
            result = await this.updateAccount(id, data as any);
            break;
          case "expenses":
            result = await this.updateExpense(id, data as any);
            break;
          case "payments":
            result = await this.updatePayment(id, data as any);
            break;
          case "journal_entries":
            result = await this.updateJournalEntry(id, data as any);
            break;
          default:
            throw new Error(
              `Bulk update not supported for entity type: ${entityType}`
            );
        }
        success.push(result);
      } catch (error) {
        failed.push({
          id,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return { success, failed };
  }

  async bulkDelete(
    entityType: string,
    ids: string[]
  ): Promise<{ success: string[]; failed: { id: string; error: string }[] }> {
    const success: string[] = [];
    const failed: { id: string; error: string }[] = [];

    for (const id of ids) {
      try {
        switch (entityType) {
          case "customers":
            await this.deleteCustomer(id);
            break;
          case "vendors":
            await this.deleteVendor(id);
            break;
          case "invoices":
            await this.deleteInvoice(id);
            break;
          case "bills":
            await this.deleteBill(id);
            break;
          case "items":
            await this.deleteItem(id);
            break;
          case "accounts":
            await this.deleteAccount(id);
            break;
          case "expenses":
            await this.deleteExpense(id);
            break;
          case "payments":
            await this.deletePayment(id);
            break;
          case "journal_entries":
            await this.deleteJournalEntry(id);
            break;
          default:
            throw new Error(
              `Bulk deletion not supported for entity type: ${entityType}`
            );
        }
        success.push(id);
      } catch (error) {
        failed.push({
          id,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return { success, failed };
  }

  // Export operations
  async startBulkExport(request: BulkExport): Promise<string> {
    const jobId = crypto.randomUUID();
    // In a real implementation, this would queue a job
    return jobId;
  }

  async getExportStatus(jobId: string): Promise<any> {
    return {
      jobId,
      status: "completed",
      progress: 100,
    };
  }

  async getExportResult(jobId: string): Promise<any> {
    throw new Error("Export result retrieval not implemented yet");
  }

  async getRateLimitInfo(): Promise<RateLimitInfo> {
    return {
      remaining: 500, // QuickBooks allows 500 requests per minute
      reset: new Date(Date.now() + 60000),
      limit: 500,
    };
  }

  getProviderInfo(): { name: string; version: string; capabilities: string[] } {
    return {
      name: "QuickBooks Online",
      version: "3.0",
      capabilities: [
        "customers",
        "vendors",
        "invoices",
        "bills",
        "items",
        "accounts",
        "expenses",
        "payments",
        "journal_entries",
        "attachments",
        "full_crud",
      ],
    };
  }

  // Missing abstract methods implementation
  async getBulkExportStatus(jobId: string): Promise<any> {
    return {
      jobId,
      status: "completed",
      progress: 100,
    };
  }

  async downloadBulkExport(jobId: string): Promise<ReadableStream> {
    throw new Error("Bulk export download not implemented yet");
  }

  async cancelBulkExport(jobId: string): Promise<void> {
    throw new Error("Bulk export cancellation not implemented yet");
  }

  async searchEntities(
    entityType: string,
    query: string,
    options?: SyncOptions
  ): Promise<SyncResult<any>> {
    throw new Error("Entity search not implemented yet");
  }

  async searchAttachments(
    query: string,
    entityType?: string,
    entityId?: string
  ): Promise<Attachment[]> {
    throw new Error("Attachment search not implemented yet");
  }

  async createWebhook(
    url: string,
    events: string[]
  ): Promise<{ id: string; secret: string }> {
    throw new Error("Webhook creation not supported by QuickBooks API");
  }

  async updateWebhook(
    id: string,
    url?: string,
    events?: string[]
  ): Promise<void> {
    throw new Error("Webhook updates not supported by QuickBooks API");
  }

  async deleteWebhook(id: string): Promise<void> {
    throw new Error("Webhook deletion not supported by QuickBooks API");
  }

  async getWebhooks(): Promise<
    { id: string; url: string; events: string[]; active: boolean }[]
  > {
    throw new Error("Webhook listing not supported by QuickBooks API");
  }

  verifyWebhook(payload: string, signature: string, secret: string): boolean {
    throw new Error("Webhook verification not supported by QuickBooks API");
  }

  async processWebhook(payload: any): Promise<void> {
    throw new Error("Webhook processing not supported by QuickBooks API");
  }

  async getBalanceSheet(
    date?: Date,
    options?: { includeComparison?: boolean }
  ): Promise<any> {
    throw new Error("Balance sheet reports not implemented yet");
  }

  async getIncomeStatement(
    startDate?: Date,
    endDate?: Date,
    options?: { includeComparison?: boolean }
  ): Promise<any> {
    throw new Error("Income statement reports not implemented yet");
  }

  async getCashFlowStatement(startDate?: Date, endDate?: Date): Promise<any> {
    throw new Error("Cash flow reports not implemented yet");
  }

  async getTrialBalance(date?: Date): Promise<any> {
    throw new Error("Trial balance reports not implemented yet");
  }

  async getAgingReport(
    type: "receivables" | "payables",
    date?: Date
  ): Promise<any> {
    throw new Error("Aging reports not implemented yet");
  }

  async validateEntity(
    entityType: string,
    data: any
  ): Promise<{ valid: boolean; errors: string[] }> {
    return { valid: true, errors: [] };
  }

  async transformEntity(
    entityType: string,
    data: any,
    direction: "to" | "from"
  ): Promise<any> {
    return data;
  }

  async getMetadata(
    entityType: string
  ): Promise<{ fields: any; relationships: any; actions: string[] }> {
    return {
      fields: {},
      relationships: {},
      actions: ["read", "create", "update", "delete"],
    };
  }
}
