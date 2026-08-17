import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SYNC_CONFIG, ProviderID } from "../../../core/models";
import type {
  GlobalSyncConfig,
  ProviderCredentials
} from "../../../core/types";
import { AccountingApiError, RatelimitError } from "../../../core/utils";
import type { RilletJournalEntryCreate } from "../models";
import {
  buildRilletIdempotencyKey,
  buildRilletSyncConfig,
  extractRilletErrorDetails,
  RILLET_API_VERSION,
  RilletProvider
} from "../provider";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function makeProvider(overrides?: {
  environment?: "production" | "sandbox";
  credentials?: ProviderCredentials | null;
}) {
  const credentials: ProviderCredentials | undefined =
    overrides?.credentials === null
      ? undefined
      : (overrides?.credentials ?? {
          type: "apiKey",
          apiKey: "rillet-key",
          environment: overrides?.environment ?? "production"
        });

  return new RilletProvider({
    companyId: "company-1",
    credentials,
    syncConfig: DEFAULT_SYNC_CONFIG
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

function requestUrl(callIndex: number): string {
  return String(fetchMock.mock.calls[callIndex]?.[0]);
}

function requestInit(callIndex: number): RequestInit | undefined {
  return fetchMock.mock.calls[callIndex]?.[1];
}

function requestHeaders(callIndex: number): Record<string, string> {
  return (requestInit(callIndex)?.headers ?? {}) as Record<string, string>;
}

const JOURNAL_PAYLOAD: RilletJournalEntryCreate = {
  name: "Carbon JE000042 je_123",
  date: "2026-07-01",
  currency: "USD",
  items: [
    {
      account_code: "1400",
      amount: { amount: "150.00", currency: "USD" },
      side: "DEBIT"
    },
    {
      account_code: "2100",
      amount: { amount: "150.00", currency: "USD" },
      side: "CREDIT"
    }
  ]
};

describe("RilletProvider base URL + headers", () => {
  it("targets the production host by default with the bearer key and pinned API version", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ accounts: [] }));

    const provider = makeProvider();
    await provider.listChartOfAccounts();

    expect(requestUrl(0)).toBe("https://api.rillet.com/accounts");
    const headers = requestHeaders(0);
    expect(headers.Authorization).toBe("Bearer rillet-key");
    expect(headers["X-Rillet-API-Version"]).toBe(RILLET_API_VERSION);
    expect(headers.Accept).toBe("application/json");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("targets the sandbox host when the stored key is a sandbox key", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ accounts: [] }));

    const provider = makeProvider({ environment: "sandbox" });
    await provider.listChartOfAccounts();

    expect(requestUrl(0)).toBe("https://sandbox.api.rillet.com/accounts");
  });

  it("identifies as the rillet provider", () => {
    const provider = makeProvider();
    expect(provider.id).toBe(ProviderID.RILLET);
    expect(provider.capabilities).toEqual({
      transport: "rest",
      supportsWebhooks: true,
      supportsJournalPush: true
    });
  });
});

describe("RilletProvider auth (API key, no OAuth)", () => {
  it("throws the no-OAuth message from authenticate and every OAuth surface", async () => {
    const provider = makeProvider();

    await expect(provider.authenticate()).rejects.toThrow(/no OAuth flow/);
    expect(() => provider.auth.getAuthUrl([], "")).toThrow(/no OAuth flow/);
    expect(() => provider.auth.exchangeCode("code", "uri")).toThrow(
      /no OAuth flow/
    );
    expect(() => provider.auth.refresh()).toThrow(/no OAuth flow/);
  });

  it("throws a descriptive error when no credentials are stored", async () => {
    const provider = makeProvider({ credentials: null });

    expect(() => provider.auth.getCredentials()).toThrow(
      /no stored credentials/
    );
    await expect(provider.createCustomer({ name: "Acme" })).rejects.toThrow(
      /no stored credentials/
    );
  });

  it("rejects a non-apiKey credentials variant", async () => {
    const provider = makeProvider({
      credentials: { type: "oauth2", accessToken: "token" }
    });

    await expect(provider.createCustomer({ name: "Acme" })).rejects.toThrow(
      /apiKey credentials/
    );
  });

  it("does not retry on 401 — a rejected key is terminal", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ title: "Unauthorized", status: 401 }, 401)
    );

    const provider = makeProvider();
    const response = await provider.request("GET", "/accounts");

    expect(response.error).toBe(true);
    expect(response.code).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("RilletProvider idempotency", () => {
  it("sends the Idempotency-Key header on creates", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: "je-remote-1", ...JOURNAL_PAYLOAD })
    );

    const provider = makeProvider();
    const created = await provider.createJournalEntry(
      JOURNAL_PAYLOAD,
      "idem-key-123"
    );

    expect(created.id).toBe("je-remote-1");
    expect(requestUrl(0)).toBe("https://api.rillet.com/journal-entries");
    expect(requestInit(0)?.method).toBe("POST");
    expect(requestHeaders(0)["Idempotency-Key"]).toBe("idem-key-123");
    expect(JSON.parse(String(requestInit(0)?.body))).toEqual(JOURNAL_PAYLOAD);
  });

  it("buildRilletIdempotencyKey is stable and entity-scoped (payload drift must not mint a fresh key)", () => {
    // A crash between the remote create and the local mapping write
    // retries the push; the retry's payload may have drifted (dimension
    // resolution, an edit between attempts). The key must dedupe on the
    // logical create — company + operation + local entity — so the retry
    // replays Rillet's stored response instead of double-creating.
    const args = {
      companyId: "company-1",
      operation: "journal-entry",
      localId: "je_123"
    };

    const key = buildRilletIdempotencyKey(args);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(buildRilletIdempotencyKey(args)).toBe(key);
    expect(buildRilletIdempotencyKey({ ...args, localId: "je_456" })).not.toBe(
      key
    );
    expect(buildRilletIdempotencyKey({ ...args, operation: "bill" })).not.toBe(
      key
    );
  });
});

describe("RilletProvider rate limiting + errors", () => {
  it("throws RatelimitError on 429", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("", { status: 429, headers: { "Retry-After": "30" } })
    );

    const provider = makeProvider();
    await expect(provider.createCustomer({ name: "Acme" })).rejects.toThrow(
      RatelimitError
    );
  });

  it("extracts RFC 9457 problem details including the errors[] extension", () => {
    const details = extractRilletErrorDetails(422, "Unprocessable Entity", {
      type: "https://api.rillet.com/errors/validation",
      title: "Validation failed",
      status: 422,
      detail: "items must contain at least 2 elements",
      errors: [
        { pointer: "/items", detail: "too few items" },
        "currency is required"
      ]
    });

    expect(details.providerErrorType).toBe(
      "https://api.rillet.com/errors/validation"
    );
    expect(details.providerErrorCode).toBe(422);
    expect(details.providerMessage).toBe(
      "items must contain at least 2 elements"
    );
    expect(details.validationErrors).toEqual([
      { field: "/items", message: "too few items" },
      { message: "currency is required" }
    ]);
  });

  it("falls back to title when detail is absent, and to the raw string body", () => {
    expect(
      extractRilletErrorDetails(500, "Internal Server Error", {
        type: "about:blank",
        title: "Internal error",
        status: 500
      }).providerMessage
    ).toBe("Internal error");

    expect(
      extractRilletErrorDetails(400, "Bad Request", "plain text error")
        .providerMessage
    ).toBe("plain text error");
  });

  it("throws a structured AccountingApiError on write failure", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          type: "https://api.rillet.com/errors/validation",
          title: "Validation failed",
          status: 422,
          detail: "name is required"
        },
        422
      )
    );

    const provider = makeProvider();

    let thrown: unknown;
    try {
      await provider.createVendor({ name: "Acme" });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AccountingApiError);
    expect((thrown as AccountingApiError).provider).toBe("rillet");
    expect((thrown as AccountingApiError).details.providerMessage).toBe(
      "name is required"
    );
  });

  it("returns null from getCustomer when the read fails", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ title: "Not Found", status: 404 }, 404)
    );

    const provider = makeProvider();
    await expect(provider.getCustomer("missing")).resolves.toBeNull();
  });

  it("unwraps a wrapped single-object envelope defensively", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ customer: { id: "cus-1", name: "Acme" } })
    );

    const provider = makeProvider();
    const created = await provider.createCustomer({ name: "Acme" });
    expect(created.id).toBe("cus-1");
  });
});

describe("RilletProvider chart of accounts", () => {
  it("normalizes to { id, code, name }, dropping INACTIVE and code-less accounts", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        accounts: [
          {
            id: "a-1",
            code: "1400",
            name: "Inventory",
            type: "ASSET",
            status: "ACTIVE"
          },
          { id: "a-2", code: "9999", name: "Old", status: "INACTIVE" },
          { id: "a-3", code: null, name: "No code", status: "ACTIVE" },
          { id: "a-4", code: "4000", name: null, status: "ACTIVE" }
        ]
      })
    );

    const provider = makeProvider();
    await expect(provider.listChartOfAccounts()).resolves.toEqual([
      { id: "a-1", code: "1400", name: "Inventory" },
      { id: "a-4", code: "4000", name: "4000" }
    ]);
  });

  it("returns [] instead of throwing when the request fails (Xero-parity contract)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ title: "Unauthorized", status: 401 }, 401)
    );

    const provider = makeProvider();
    await expect(provider.listChartOfAccounts()).resolves.toEqual([]);
  });
});

describe("RilletProvider field values", () => {
  it("recovers the existing value when the create 400s with already-exists", async () => {
    // POST /fields/{id}/values is NOT idempotent server-side (sandbox-verified
    // 2026-08-14): a value provisioned by an earlier instance or seeded in the
    // Rillet UI 400s. The provider must fall back to GET /fields and return
    // the existing value instead of failing the whole document push.
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          title: "Bad Request",
          status: 400,
          detail: 'Value "Headquarters" already exists'
        },
        400
      )
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        fields: [
          {
            id: "field-1",
            name: "Location",
            values: [{ id: "val-1", name: "Headquarters" }]
          }
        ]
      })
    );

    const provider = makeProvider();
    await expect(
      provider.upsertFieldValue("field-1", "Headquarters")
    ).resolves.toMatchObject({ id: "val-1", name: "Headquarters" });

    const urls = fetchMock.mock.calls.map((call) => call[0] as string);
    expect(urls[0]).toContain("/fields/field-1/values");
    expect(urls[1]).toContain("/fields");
  });

  it("rethrows a non-duplicate failure without listing fields", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ title: "Unauthorized", status: 401 }, 401)
    );

    const provider = makeProvider();
    await expect(provider.upsertFieldValue("field-1", "HQ")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("RilletProvider cursor pagination", () => {
  it("follows pagination.next_cursor with limit=100 until absent", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        customers: [
          { id: "c-1", name: "A" },
          { id: "c-2", name: "B" }
        ],
        pagination: { next_cursor: "cur-2" }
      })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ customers: [{ id: "c-3", name: "C" }], pagination: {} })
    );

    const provider = makeProvider();
    const customers = await provider.listCustomers();

    expect(customers.map((customer) => customer.id)).toEqual([
      "c-1",
      "c-2",
      "c-3"
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestUrl(0)).toBe("https://api.rillet.com/customers?limit=100");
    expect(requestUrl(1)).toBe(
      "https://api.rillet.com/customers?limit=100&cursor=cur-2"
    );
  });
});

describe("RilletProvider validate", () => {
  it("is true when GET /accounts succeeds", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ accounts: [] }));
    await expect(makeProvider().validate()).resolves.toBe(true);
  });

  it("is false on an API failure or unusable credentials", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ title: "Unauthorized", status: 401 }, 401)
    );
    await expect(makeProvider().validate()).resolves.toBe(false);

    await expect(makeProvider({ credentials: null }).validate()).resolves.toBe(
      false
    );
  });
});

describe("buildRilletSyncConfig", () => {
  it("forces push-only, pull-only and disabled entities regardless of stored overrides", () => {
    const stored: GlobalSyncConfig = {
      entities: {
        ...DEFAULT_SYNC_CONFIG.entities,
        // Stored overrides that Rillet cannot honor
        customer: { enabled: false, direction: "two-way", owner: "accounting" },
        invoice: {
          enabled: true,
          direction: "pull-from-accounting",
          owner: "accounting"
        },
        payment: { enabled: false, direction: "two-way", owner: "carbon" },
        purchaseOrder: {
          enabled: true,
          direction: "push-to-accounting",
          owner: "carbon"
        }
      }
    };

    const built = buildRilletSyncConfig(stored);

    // Push-only forced; per-company enabled survives
    expect(built.entities.customer).toEqual({
      enabled: false,
      direction: "push-to-accounting",
      owner: "carbon"
    });
    expect(built.entities.invoice).toEqual({
      enabled: true,
      direction: "push-to-accounting",
      owner: "carbon"
    });
    expect(built.entities.journalEntry.direction).toBe("push-to-accounting");
    expect(built.entities.journalEntry.owner).toBe("carbon");
    // Always-on: journalEntry is FORCED enabled — a stale stored
    // enabled:false override cannot turn automated postings off.
    expect(built.entities.journalEntry.enabled).toBe(true);
    expect(
      buildRilletSyncConfig({
        entities: {
          ...DEFAULT_SYNC_CONFIG.entities,
          journalEntry: {
            enabled: false,
            direction: "push-to-accounting",
            owner: "carbon"
          }
        }
      }).entities.journalEntry.enabled
    ).toBe(true);

    // Payment: two-way (pull inbound + push Carbon-born outbound, Phase G),
    // owner accounting, and FORCED enabled (no per-company toggle — the
    // documents-mode families gate governs whether it runs)
    expect(built.entities.payment).toEqual({
      enabled: true,
      direction: "two-way",
      owner: "accounting"
    });

    // Unsupported entities forced off
    expect(built.entities.purchaseOrder.enabled).toBe(false);
    expect(built.entities.salesOrder.enabled).toBe(false);
    expect(built.entities.inventoryAdjustment.enabled).toBe(false);
    expect(built.entities.employee.enabled).toBe(false);
  });
});

describe("listChanges (SupportsIncrementalPull)", () => {
  it("declares no lookback cap (updated.gt reaches arbitrarily far back)", () => {
    expect(makeProvider().pullLookbackDays).toBeUndefined();
  });

  it("lists changed invoice payments as composite-id changes with an invoice dependency", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        payments: [
          {
            id: "pay-1",
            status: "SUCCESSFUL",
            invoice_id: "inv-1",
            amount: { amount: "100.00", currency: "USD" },
            updated_at: "2026-07-31T12:00:00.000Z"
          },
          // No invoice_id → unaddressable, logged and dropped
          { id: "pay-2", status: "UNCLEARED" }
        ]
      })
    );
    // AP changed-bills feed — empty for this AR-focused case.
    fetchMock.mockResolvedValueOnce(jsonResponse({ bills: [] }));

    const result = await makeProvider().listChanges({
      since: "2026-07-30T00:00:00.000Z"
    });

    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toContain("/invoice-payments?");
    expect(url).toContain(
      `updated.gt=${encodeURIComponent("2026-07-30T00:00:00.000Z")}`
    );
    expect(url).toContain("sort_by=updated");

    expect(result.changes).toEqual([
      {
        entityType: "payment",
        remoteId: "inv-1:pay-1",
        updatedAt: "2026-07-31T12:00:00.000Z",
        dependsOnMapping: { entityType: "invoice", remoteId: "inv-1" }
      }
    ]);
  });

  it("lists changed bill payments as `bill:`-prefixed changes with a bill dependency", async () => {
    // AR invoice-payments feed — empty for this AP-focused case.
    fetchMock.mockResolvedValueOnce(jsonResponse({ payments: [] }));
    // AP feed is COMPOSED (GET /bill-payments does not exist): changed bills…
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        bills: [{ id: "bill-1", updated_at: "2026-08-01T12:00:00.000Z" }]
      })
    );
    // …then that bill's payments.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        payments: [
          {
            id: "bp-1",
            status: "SUCCESSFUL",
            bill_id: "bill-1",
            amount: { amount: "500.00", currency: "USD" },
            updated_at: "2026-08-01T12:00:00.000Z"
          },
          // No bill_id / updated_at of its own → stamped with the bill's
          { id: "bp-2", status: "UNCLEARED" }
        ]
      })
    );

    const result = await makeProvider().listChanges({
      since: "2026-07-30T00:00:00.000Z"
    });

    const billsUrl = fetchMock.mock.calls[1]?.[0] as string;
    expect(billsUrl).toContain("/bills?");
    expect(billsUrl).toContain(
      `updated.gt=${encodeURIComponent("2026-07-30T00:00:00.000Z")}`
    );
    expect(billsUrl).toContain("sort_by=updated");

    const billPaymentsUrl = fetchMock.mock.calls[2]?.[0] as string;
    expect(billPaymentsUrl).toContain("/bills/bill-1/payments");

    expect(result.changes).toEqual([
      {
        entityType: "payment",
        remoteId: "bill:bill-1:bp-1",
        updatedAt: "2026-08-01T12:00:00.000Z",
        dependsOnMapping: { entityType: "bill", remoteId: "bill-1" }
      },
      {
        entityType: "payment",
        remoteId: "bill:bill-1:bp-2",
        updatedAt: "2026-08-01T12:00:00.000Z",
        dependsOnMapping: { entityType: "bill", remoteId: "bill-1" }
      }
    ]);
  });

  it("emits AR and AP changes together from one sweep", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        payments: [
          {
            id: "pay-1",
            status: "SUCCESSFUL",
            invoice_id: "inv-1",
            updated_at: "2026-07-31T12:00:00.000Z"
          }
        ]
      })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        bills: [{ id: "bill-1", updated_at: "2026-08-01T12:00:00.000Z" }]
      })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        payments: [
          {
            id: "bp-1",
            status: "SUCCESSFUL",
            bill_id: "bill-1",
            updated_at: "2026-08-01T12:00:00.000Z"
          }
        ]
      })
    );

    const result = await makeProvider().listChanges({
      since: "2026-07-30T00:00:00.000Z"
    });

    expect(result.changes.map((change) => change.remoteId)).toEqual([
      "inv-1:pay-1",
      "bill:bill-1:bp-1"
    ]);
    expect(
      result.changes.map((change) => change.dependsOnMapping?.entityType)
    ).toEqual(["invoice", "bill"]);
  });

  it("follows pagination across pages (both feeds)", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          payments: [
            {
              id: "pay-1",
              status: "SUCCESSFUL",
              invoice_id: "inv-1",
              updated_at: "2026-07-31T12:00:00.000Z"
            }
          ],
          pagination: { next_cursor: "cursor-2" }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          payments: [
            {
              id: "pay-2",
              status: "CLEARED",
              invoice_id: "inv-2",
              updated_at: "2026-07-31T13:00:00.000Z"
            }
          ],
          pagination: { next_cursor: null }
        })
      )
      // AP changed-bills feed — single empty page, so no per-bill calls.
      .mockResolvedValueOnce(jsonResponse({ bills: [] }));

    const result = await makeProvider().listChanges({
      since: "2026-07-30T00:00:00.000Z"
    });

    // 2 invoice-payment pages + 1 changed-bills page
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.changes.map((change) => change.remoteId)).toEqual([
      "inv-1:pay-1",
      "inv-2:pay-2"
    ]);
  });
});
