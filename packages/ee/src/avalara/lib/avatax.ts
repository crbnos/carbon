import { AvalaraError, type AvalaraHttp } from "./client";
import type { Avalara } from "./types";

/**
 * AvaTax REST v2 surface. Every method returns `{ data, error }` and never
 * throws past the error taxonomy. Construct with an {@link AvalaraHttp} core and
 * the Avalara company code this Carbon company maps to.
 */
export class AvataxApi {
  constructor(
    private readonly http: AvalaraHttp,
    private readonly companyCode: string
  ) {}

  /**
   * `GET /api/v2/utilities/ping`. `authenticated: false` is surfaced as an
   * `auth` error so callers can treat a bad key as an auth failure.
   */
  async ping(): Promise<{
    data: Avalara.PingResult | null;
    error: AvalaraError | null;
  }> {
    const { data, error } = await this.http.request<Avalara.PingResult>(
      "avatax",
      "GET",
      "/api/v2/utilities/ping"
    );
    if (error) return { data: null, error };
    if (!data?.authenticated) {
      return {
        data: null,
        error: new AvalaraError({
          kind: "auth",
          message: "Avalara credentials are not authenticated"
        })
      };
    }
    return { data, error: null };
  }

  /** `GET /api/v2/companies` — up to 200 companies for dropdown options. */
  async listCompanies(): Promise<{
    data: Avalara.CompanyModel[] | null;
    error: AvalaraError | null;
  }> {
    const { data, error } = await this.http.request<
      Avalara.FetchResult<Avalara.CompanyModel>
    >("avatax", "GET", "/api/v2/companies", { query: { $top: 200 } });
    if (error) return { data: null, error };
    return { data: data?.value ?? [], error: null };
  }

  /**
   * Resolve a single company by its code. Returns a `not_found` error when the
   * code does not match an Avalara company.
   */
  async getCompanyByCode(code: string): Promise<{
    data: Avalara.CompanyModel | null;
    error: AvalaraError | null;
  }> {
    // Escape single quotes for the OData `$filter` string literal.
    const escaped = code.replace(/'/g, "''");
    const { data, error } = await this.http.request<
      Avalara.FetchResult<Avalara.CompanyModel>
    >("avatax", "GET", "/api/v2/companies", {
      query: { $filter: `companyCode eq '${escaped}'` }
    });
    if (error) return { data: null, error };
    const match = data?.value?.[0];
    if (!match) {
      return {
        data: null,
        error: new AvalaraError({
          kind: "not_found",
          message: `Avalara company code "${code}" was not found`
        })
      };
    }
    return { data: match, error: null };
  }

  /**
   * `POST /api/v2/transactions/create`.
   *
   * Idempotency contract: when `commit: true`, the caller MUST supply a stable
   * `code` (e.g. the Carbon invoice id) so Avalara overwrites the uncommitted
   * document rather than creating a duplicate. Committed creates are marked
   * non-retryable here — a retry after an ambiguous timeout is the caller's
   * responsibility, keyed by that idempotent `code`.
   */
  async createTransaction(
    model: Omit<Avalara.CreateTransactionModel, "companyCode"> & {
      companyCode?: string;
    }
  ): Promise<{
    data: Avalara.TransactionModel | null;
    error: AvalaraError | null;
  }> {
    const body: Avalara.CreateTransactionModel = {
      ...model,
      companyCode: model.companyCode ?? this.companyCode
    };
    return this.http.request<Avalara.TransactionModel>(
      "avatax",
      "POST",
      "/api/v2/transactions/create",
      {
        body,
        timeoutMs: 30_000,
        // Never auto-retry a commit. Only retry uncommitted creates that carry
        // a stable `code` (idempotency key) so a retry overwrites the same
        // document rather than duplicating it; codeless creates are one-shot.
        retryable: body.commit !== true && !!body.code
      }
    );
  }

  /** `POST /api/v2/companies/{companyCode}/transactions/{code}/commit`. */
  async commitTransaction(transactionCode: string): Promise<{
    data: Avalara.TransactionModel | null;
    error: AvalaraError | null;
  }> {
    return this.http.request<Avalara.TransactionModel>(
      "avatax",
      "POST",
      `/api/v2/companies/${encodeURIComponent(
        this.companyCode
      )}/transactions/${encodeURIComponent(transactionCode)}/commit`,
      { body: { commit: true } }
    );
  }

  /** `POST /api/v2/companies/{companyCode}/transactions/{code}/void`. */
  async voidTransaction(
    transactionCode: string,
    reason:
      | "DocVoided"
      | "DocDeleted"
      | "PostFailed"
      | "AdjustmentCancelled" = "DocVoided"
  ): Promise<{
    data: Avalara.TransactionModel | null;
    error: AvalaraError | null;
  }> {
    return this.http.request<Avalara.TransactionModel>(
      "avatax",
      "POST",
      `/api/v2/companies/${encodeURIComponent(
        this.companyCode
      )}/transactions/${encodeURIComponent(transactionCode)}/void`,
      { body: { code: reason } }
    );
  }

  /** `POST /api/v2/addresses/resolve`. */
  async resolveAddress(address: Avalara.AddressInfo): Promise<{
    data: Avalara.AddressResolutionModel | null;
    error: AvalaraError | null;
  }> {
    return this.http.request<Avalara.AddressResolutionModel>(
      "avatax",
      "POST",
      "/api/v2/addresses/resolve",
      { body: address }
    );
  }

  /** `GET /api/v2/companies/{avalaraCompanyId}/nexus`. */
  async listNexus(avalaraCompanyId: number): Promise<{
    data: Avalara.NexusModel[] | null;
    error: AvalaraError | null;
  }> {
    const { data, error } = await this.http.request<
      Avalara.FetchResult<Avalara.NexusModel>
    >("avatax", "GET", `/api/v2/companies/${avalaraCompanyId}/nexus`);
    if (error) return { data: null, error };
    return { data: data?.value ?? [], error: null };
  }
}
