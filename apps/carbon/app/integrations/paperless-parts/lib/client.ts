type PaperlessPartsResponse<T extends object> =
  | {
      data: null;
      error: string;
    }
  | {
      data: T;
      error: null;
    };

export class PaperlessPartsClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.baseUrl = "https://api.paperless-parts.com/";
  }

  async listNewOrders() {
    return this._request("/orders/public/new");
  }

  async getOrderDetails(id: number) {
    return this._request(`/orders/public/${id}`);
  }

  async listNewQuotesAndRevisions() {
    return this._request("/quotes/public/new");
  }

  async listQuoteHeaders() {
    return this._request("/quotes/public");
  }

  async getQuoteHeader(id: string) {
    return this._request(`/quotes/public/${id}`);
  }

  async getQuoteDetails(id: number) {
    return this._request(`/quotes/public/${id}`);
  }

  async getQuoteItem(id: number) {
    return this._request(`/quotes/public/items/${id}`);
  }

  async getOperationDetails(id: string) {
    return this._request(`/quotes/public/operations/${id}`);
  }

  async getAddOnDetails(id: string) {
    return this._request(`/quotes/public/add_ons/${id}`);
  }

  async getDiscountDetails(id: string) {
    return this._request(`/quotes/public/discounts/${id}`);
  }

  async getPricingItem(id: string) {
    return this._request(`/quotes/public/pricing_items/${id}`);
  }

  async getQuoteFileDetails(quoteId: string, fileId: string) {
    return this._request(`/quotes/public/${quoteId}/files/${fileId}`);
  }

  async getPricingItemQuantity(id: string) {
    return this._request(`/quotes/public/pricing_item_quantities/${id}`);
  }

  async _request<T extends object>(
    path: string,
    args?: {
      method?:
        | "GET"
        | "POST"
        | "PUT"
        | "DELETE"
        | "get"
        | "post"
        | "put"
        | "delete";
      body?: any;
    }
  ): Promise<PaperlessPartsResponse<T>> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: args?.method ?? "GET",
      headers: {
        Authorization: `API-Token ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      ...(args?.body && { body: JSON.stringify(args.body) }),
    });

    if (!response.ok) {
      return { data: null, error: response.statusText };
    }

    try {
      const data = await response.json();
      if ("text/plain" in data?.content) {
        return {
          data: null,
          error: data.content["text/plain"]?.schema?.title ?? "Unknown error",
        };
      }

      return {
        data: data?.content?.["application/json"]?.schema ?? {},
        error: null,
      };
    } catch (error) {
      return { data: null, error: "Failed to parse JSON response" };
    }
  }
}
