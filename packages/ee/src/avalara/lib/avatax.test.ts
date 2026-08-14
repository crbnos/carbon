import { beforeEach, describe, expect, it, vi } from "vitest";
import { AvataxApi } from "./avatax";
import { AvalaraHttp } from "./client";

function mockResponse(
  status: number,
  body?: unknown,
  headers: Record<string, string> = {}
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n: string) => headers[n] ?? null },
    text: async () => (body === undefined ? "" : JSON.stringify(body))
  } as unknown as Response;
}

function makeApi(fetchImpl: typeof fetch, companyCode = "ACME") {
  const http = new AvalaraHttp({
    environment: "sandbox",
    accountId: "acct",
    licenseKey: "key",
    fetchImpl,
    sleepImpl: async () => undefined
  });
  return { api: new AvataxApi(http, companyCode), http };
}

describe("AvataxApi", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("ping treats authenticated:false as an auth error", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        mockResponse(200, { version: "1", authenticated: false })
      );
    const { api } = makeApi(fetchImpl as unknown as typeof fetch);

    const { data, error } = await api.ping();
    expect(data).toBeNull();
    expect(error?.kind).toBe("auth");
  });

  it("createTransaction(SalesOrder) posts the right body and parses tax", async () => {
    const responseBody = {
      code: "INV-1",
      totalTax: 8.25,
      lines: [{ lineNumber: "1", tax: 8.25, details: [{ rate: 0.0825 }] }]
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(mockResponse(200, responseBody));
    const { api } = makeApi(fetchImpl as unknown as typeof fetch);

    const { data, error } = await api.createTransaction({
      type: "SalesOrder",
      date: "2026-07-06",
      customerCode: "CUST-1",
      lines: [{ amount: 100 }]
    });

    expect(error).toBeNull();
    expect(data?.totalTax).toBe(8.25);
    expect(data?.lines?.[0]?.details?.[0]?.rate).toBe(0.0825);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(
      "https://sandbox-rest.avatax.com/api/v2/transactions/create"
    );
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent.type).toBe("SalesOrder");
    expect(sent.companyCode).toBe("ACME");
    expect(sent.commit).toBeUndefined();
  });

  it("does not retry a committed createTransaction on 503", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockResponse(503, {}));
    const { api } = makeApi(fetchImpl as unknown as typeof fetch);

    const { error } = await api.createTransaction({
      type: "SalesInvoice",
      date: "2026-07-06",
      customerCode: "CUST-1",
      code: "INV-1",
      commit: true,
      lines: [{ amount: 100 }]
    });

    expect(error?.kind).toBe("transient");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("voidTransaction hits the company-scoped path", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        mockResponse(200, { code: "INV-1", status: "Cancelled" })
      );
    const { api } = makeApi(fetchImpl as unknown as typeof fetch);

    const { data } = await api.voidTransaction("INV-1");
    expect(data?.status).toBe("Cancelled");

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(
      "https://sandbox-rest.avatax.com/api/v2/companies/ACME/transactions/INV-1/void"
    );
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      code: "DocVoided"
    });
  });

  it("getCompanyByCode escapes single quotes in the $filter", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      mockResponse(200, {
        value: [{ id: 1, companyCode: "O'HARE", name: "O'Hare" }]
      })
    );
    const { api } = makeApi(fetchImpl as unknown as typeof fetch, "O'HARE");

    const { data, error } = await api.getCompanyByCode("O'HARE");
    expect(error).toBeNull();
    expect(data?.id).toBe(1);

    const [url] = fetchImpl.mock.calls[0]!;
    // The single quote is doubled per OData escaping (URLSearchParams encodes
    // the spaces as `+`, so assert on the doubled-quote literal itself).
    expect(decodeURIComponent(url as string)).toContain("'O''HARE'");
  });

  it("getCompanyByCode returns not_found when no match", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(mockResponse(200, { value: [] }));
    const { api } = makeApi(fetchImpl as unknown as typeof fetch);

    const { data, error } = await api.getCompanyByCode("NOPE");
    expect(data).toBeNull();
    expect(error?.kind).toBe("not_found");
  });
});
