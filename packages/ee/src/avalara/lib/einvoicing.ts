import type { AvalaraError, AvalaraHttp } from "./client";
import type { Avalara } from "./types";

/**
 * Avalara e-invoicing (ELR) surface. Authenticated with an Avalara Identity
 * OAuth2 bearer token (client-credentials) rather than the AvaTax license key —
 * the token manager lives in {@link AvalaraHttp}. When the e-invoicing
 * credentials (`AVALARA_CLIENT_ID` / `AVALARA_CLIENT_SECRET`) are absent, every
 * method resolves to a `not_configured` error, so the e-invoicing consumer
 * (#1054) can compile against this interface without those creds being set.
 *
 * The document-building (UBL/CII), submission orchestration, and mandate UX are
 * explicit non-scope of the foundation — this is the typed transport only.
 */
export class EinvoicingApi {
  constructor(private readonly http: AvalaraHttp) {}

  /** `POST /documents` — submit a document for clearance/network delivery. */
  async submitDocument(
    payload: unknown,
    meta?: Record<string, string>
  ): Promise<{
    data: Avalara.DocumentSubmitResponse | null;
    error: AvalaraError | null;
  }> {
    return this.http.request<Avalara.DocumentSubmitResponse>(
      "einvoicing",
      "POST",
      "/documents",
      { body: { document: payload, metadata: meta } }
    );
  }

  /** `GET /documents/{id}/status`. */
  async getDocumentStatus(documentId: string): Promise<{
    data: Avalara.DocumentStatusEvent | null;
    error: AvalaraError | null;
  }> {
    return this.http.request<Avalara.DocumentStatusEvent>(
      "einvoicing",
      "GET",
      `/documents/${encodeURIComponent(documentId)}/status`
    );
  }

  /** `GET /documents`. */
  async listDocuments(
    query?: Record<string, string | number | undefined>
  ): Promise<{
    data: Avalara.DocumentStatusEvent[] | null;
    error: AvalaraError | null;
  }> {
    const { data, error } = await this.http.request<{
      value?: Avalara.DocumentStatusEvent[];
    }>("einvoicing", "GET", "/documents", { query });
    if (error) return { data: null, error };
    return { data: data?.value ?? [], error: null };
  }

  /** `GET /mandates` — country/mandate discovery for routing. */
  async listMandates(): Promise<{
    data: Avalara.Mandate[] | null;
    error: AvalaraError | null;
  }> {
    const { data, error } = await this.http.request<{
      value?: Avalara.Mandate[];
    }>("einvoicing", "GET", "/mandates");
    if (error) return { data: null, error };
    return { data: data?.value ?? [], error: null };
  }
}
