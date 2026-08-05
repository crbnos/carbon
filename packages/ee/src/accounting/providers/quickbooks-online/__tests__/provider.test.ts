import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SYNC_CONFIG, ProviderID } from "../../../core/models";
import type { ProviderCredentials } from "../../../core/types";
import { AccountingApiError } from "../../../core/utils";
import { Qbo } from "../models";
import {
  extractQboErrorDetails,
  isQboDuplicateNameError,
  isQboStaleObjectError,
  QBO_CDC_ENTITY_TYPES,
  QBO_FAULT_CODES,
  type QboEnvironment,
  QboProvider
} from "../provider";

const REALM_ID = "9130357849328710";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function tokenResponse(accessToken: string, refreshToken: string): Response {
  return jsonResponse({
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: 3600
  });
}

function makeProvider(environment?: QboEnvironment) {
  const onTokenRefresh = vi.fn(
    async (_creds: ProviderCredentials): Promise<void> => undefined
  );

  const provider = new QboProvider({
    companyId: "company-1",
    clientId: "client-id",
    clientSecret: "client-secret",
    accessToken: "stale-token",
    refreshToken: "stale-refresh",
    realmId: REALM_ID,
    environment,
    syncConfig: DEFAULT_SYNC_CONFIG,
    onTokenRefresh
  });

  return { provider, onTokenRefresh };
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
  return decodeURIComponent(String(fetchMock.mock.calls[callIndex]?.[0]));
}

function requestInit(callIndex: number): RequestInit | undefined {
  return fetchMock.mock.calls[callIndex]?.[1];
}

describe("QboProvider base URL", () => {
  it("targets the production host by default, under /v3/company/{realmId} with the pinned minorversion", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ QueryResponse: { Account: [] } })
    );

    const { provider } = makeProvider();
    await provider.query<Qbo.Account>("Account");

    expect(requestUrl(0)).toContain(
      `https://quickbooks.api.intuit.com/v3/company/${REALM_ID}/query`
    );
    expect(requestUrl(0)).toContain("minorversion=75");
  });

  it("targets the sandbox host when environment is sandbox", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ QueryResponse: { Account: [] } })
    );

    const { provider } = makeProvider("sandbox");
    await provider.query<Qbo.Account>("Account");

    expect(requestUrl(0)).toContain(
      `https://sandbox-quickbooks.api.intuit.com/v3/company/${REALM_ID}/query`
    );
  });

  it("identifies as the quickbooks provider", () => {
    const { provider } = makeProvider();
    expect(provider.id).toBe(ProviderID.QUICKBOOKS);
    expect(provider.capabilities).toEqual({
      transport: "rest",
      supportsWebhooks: false,
      supportsJournalPush: true,
      maxJournalDimensionSlots: 2
    });
  });
});

describe("QboProvider refresh-on-401", () => {
  it("refreshes the token once via the Intuit bearer endpoint and replays the request", async () => {
    // 1st: API rejects the stale token
    fetchMock.mockResolvedValueOnce(jsonResponse({ Fault: {} }, 401));
    // 2nd: refresh_token grant succeeds
    fetchMock.mockResolvedValueOnce(tokenResponse("new-token", "new-refresh"));
    // 3rd: replayed API call succeeds
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        CompanyInfo: { Id: "1", CompanyName: "Sandbox Company_US_1" }
      })
    );

    const { provider, onTokenRefresh } = makeProvider();
    const companyInfo = await provider.getCompanyInfo();

    expect(companyInfo?.CompanyName).toBe("Sandbox Company_US_1");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // The refresh went to Intuit's bearer endpoint with Basic auth and the
    // refresh_token grant
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(TOKEN_URL);
    const tokenInit = requestInit(1);
    expect((tokenInit?.headers as Record<string, string>).Authorization).toBe(
      `Basic ${btoa("client-id:client-secret")}`
    );
    expect(String(tokenInit?.body)).toContain("grant_type=refresh_token");
    expect(String(tokenInit?.body)).toContain("refresh_token=stale-refresh");

    // The replay used the refreshed bearer token
    const retryInit = requestInit(2);
    expect((retryInit?.headers as Record<string, string>).Authorization).toBe(
      "Bearer new-token"
    );

    // The new credentials were persisted through the onTokenRefresh callback
    expect(onTokenRefresh).toHaveBeenCalledTimes(1);
    expect(onTokenRefresh.mock.calls[0]?.[0]).toMatchObject({
      type: "oauth2",
      accessToken: "new-token",
      refreshToken: "new-refresh"
    });
  });

  it("retries at most once — a second 401 is returned, not refreshed again", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ Fault: {} }, 401));
    fetchMock.mockResolvedValueOnce(tokenResponse("new-token", "new-refresh"));
    fetchMock.mockResolvedValueOnce(jsonResponse({ Fault: {} }, 401));

    const { provider, onTokenRefresh } = makeProvider();
    const response = await provider.request("GET", `/companyinfo/${REALM_ID}`);

    expect(response.error).toBe(true);
    expect(response.code).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(onTokenRefresh).toHaveBeenCalledTimes(1);
  });
});

describe("QboProvider query pagination", () => {
  it("pages with STARTPOSITION/MAXRESULTS until a short page", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        QueryResponse: { Customer: [{ Id: "1" }, { Id: "2" }] }
      })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ QueryResponse: { Customer: [{ Id: "3" }] } })
    );

    const { provider } = makeProvider();
    const customers = await provider.query<{ Id: string }>(
      "Customer",
      "Active = true",
      1,
      2
    );

    expect(customers.map((customer) => customer.Id)).toEqual(["1", "2", "3"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestUrl(0)).toContain(
      "SELECT * FROM Customer WHERE Active = true STARTPOSITION 1 MAXRESULTS 2"
    );
    expect(requestUrl(1)).toContain("STARTPOSITION 3 MAXRESULTS 2");
  });

  it("caps MAXRESULTS at 1000 and handles a QueryResponse without the entity key", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ QueryResponse: {} }));

    const { provider } = makeProvider();
    const items = await provider.query<Qbo.Item>("Item", undefined, 1, 5000);

    expect(items).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestUrl(0)).toContain("MAXRESULTS 1000");
  });

  it("throws a structured AccountingApiError when the query fails", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ Fault: { type: "ValidationFault" } }, 400)
    );

    const { provider } = makeProvider();

    await expect(provider.query("Customer")).rejects.toThrow(
      /query Customer failed/
    );
  });
});

describe("Qbo models", () => {
  it("parses a journal entry with Debit/Credit posting types", () => {
    const journal = Qbo.JournalEntrySchema.parse({
      Id: "147",
      SyncToken: "0",
      DocNumber: "JE000042",
      TxnDate: "2026-07-01",
      PrivateNote: "Carbon je_123",
      Line: [
        {
          Description: "Inventory",
          Amount: 150,
          DetailType: "JournalEntryLineDetail",
          JournalEntryLineDetail: {
            PostingType: "Debit",
            AccountRef: { value: "82", name: "Inventory Asset" }
          }
        },
        {
          Amount: 150,
          DetailType: "JournalEntryLineDetail",
          JournalEntryLineDetail: {
            PostingType: "Credit",
            AccountRef: { value: "90" }
          }
        }
      ]
    });

    expect(
      journal.Line.map((line) => line.JournalEntryLineDetail.PostingType)
    ).toEqual(["Debit", "Credit"]);

    expect(() =>
      Qbo.JournalEntryLineSchema.parse({
        Amount: 150,
        DetailType: "JournalEntryLineDetail",
        JournalEntryLineDetail: {
          PostingType: "DEBIT",
          AccountRef: { value: "82" }
        }
      })
    ).toThrow();
  });

  it("parses an account with an optional AcctNum", () => {
    const account = Qbo.AccountSchema.parse({
      Id: "82",
      Name: "Inventory Asset",
      AccountType: "Other Current Asset",
      Classification: "Asset",
      Active: true
    });

    expect(account.AcctNum).toBeUndefined();
  });
});

describe("QBO fault parsing", () => {
  const duplicateNameFault = {
    Fault: {
      Error: [
        {
          Message: "Duplicate Name Exists Error",
          Detail:
            "The name supplied already exists. : Another customer, vendor or employee is already using this name.",
          code: "6240",
          element: "DisplayName"
        }
      ],
      type: "ValidationFault"
    },
    time: "2026-07-08T13:07:59.334-07:00"
  };

  it("extracts type, code, message and validation errors from a Fault body", () => {
    const details = extractQboErrorDetails(
      400,
      "Bad Request",
      duplicateNameFault
    );

    expect(details.providerErrorType).toBe("ValidationFault");
    expect(details.providerErrorCode).toBe("6240");
    expect(details.providerMessage).toContain("already exists");
    expect(details.validationErrors).toEqual([
      {
        field: "DisplayName",
        message:
          "The name supplied already exists. : Another customer, vendor or employee is already using this name."
      }
    ]);
  });

  it("classifies duplicate-name and stale-object faults by Intuit code", () => {
    const duplicate = new AccountingApiError(
      "quickbooks",
      "create customer",
      extractQboErrorDetails(400, "Bad Request", duplicateNameFault)
    );
    expect(isQboDuplicateNameError(duplicate)).toBe(true);
    expect(isQboStaleObjectError(duplicate)).toBe(false);

    const stale = new AccountingApiError(
      "quickbooks",
      "update customer",
      extractQboErrorDetails(400, "Bad Request", {
        Fault: {
          Error: [
            {
              Message: "Stale Object Error",
              Detail: "Stale Object Error : You and another user...",
              code: QBO_FAULT_CODES.STALE_OBJECT
            }
          ],
          type: "ValidationFault"
        }
      })
    );
    expect(isQboStaleObjectError(stale)).toBe(true);
    expect(isQboDuplicateNameError(stale)).toBe(false);

    expect(isQboDuplicateNameError(new Error("boom"))).toBe(false);
  });
});

describe("QboProvider chart of accounts", () => {
  it("queries active accounts and normalizes to { id, code, name } with code = AcctNum ?? Id", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        QueryResponse: {
          Account: [
            {
              Id: "82",
              Name: "Inventory Asset",
              AcctNum: "1400",
              AccountType: "Other Current Asset",
              Active: true
            },
            {
              Id: "90",
              Name: "Accrued Liabilities",
              AccountType: "Other Current Liability",
              Active: true
            }
          ]
        }
      })
    );

    const { provider } = makeProvider();
    const accounts = await provider.listChartOfAccounts();

    expect(requestUrl(0)).toContain(
      "SELECT * FROM Account WHERE Active = true"
    );
    expect(accounts).toEqual([
      { id: "82", code: "1400", name: "Inventory Asset" },
      { id: "90", code: "90", name: "Accrued Liabilities" }
    ]);
  });

  it("returns [] instead of throwing when the query fails (Xero-parity contract)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ Fault: { type: "ValidationFault" } }, 400)
    );

    const { provider } = makeProvider();
    await expect(provider.listChartOfAccounts()).resolves.toEqual([]);
  });
});

describe("QboProvider entity reads/writes", () => {
  it("creates a customer via POST /customer and unwraps the envelope", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        Customer: { Id: "42", SyncToken: "0", DisplayName: "Acme" }
      })
    );

    const { provider } = makeProvider();
    const created = await provider.createCustomer({
      DisplayName: "Acme",
      Active: true
    });

    expect(created.Id).toBe("42");
    expect(requestUrl(0)).toContain(`/v3/company/${REALM_ID}/customer`);
    const body = JSON.parse(String(requestInit(0)?.body));
    expect(body).toEqual({ DisplayName: "Acme", Active: true });
  });

  it("sends updates sparse with the echoed Id + SyncToken", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        Customer: { Id: "42", SyncToken: "1", DisplayName: "Acme Ltd" }
      })
    );

    const { provider } = makeProvider();
    await provider.updateCustomer({
      Id: "42",
      SyncToken: "0",
      DisplayName: "Acme Ltd",
      Active: true
    });

    const body = JSON.parse(String(requestInit(0)?.body));
    expect(body).toEqual({
      Id: "42",
      SyncToken: "0",
      DisplayName: "Acme Ltd",
      Active: true,
      sparse: true
    });
  });

  it("throws a structured AccountingApiError carrying the Intuit fault code on write failure", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          Fault: {
            Error: [
              {
                Message: "Duplicate Name Exists Error",
                Detail: "The name supplied already exists.",
                code: "6240"
              }
            ],
            type: "ValidationFault"
          }
        },
        400
      )
    );

    const { provider } = makeProvider();

    let thrown: unknown;
    try {
      await provider.createCustomer({ DisplayName: "Acme" });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AccountingApiError);
    expect(isQboDuplicateNameError(thrown)).toBe(true);
  });

  it("returns null from getCustomer when the read fails", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ Fault: { type: "ValidationFault" } }, 404)
    );

    const { provider } = makeProvider();
    await expect(provider.getCustomer("missing")).resolves.toBeNull();
  });
});

describe("listChanges (SupportsIncrementalPull)", () => {
  it("maps the six CDC entity names onto Carbon entity types", () => {
    expect(QBO_CDC_ENTITY_TYPES).toEqual({
      Customer: "customer",
      Vendor: "vendor",
      Item: "item",
      Invoice: "invoice",
      Bill: "bill",
      PurchaseOrder: "purchaseOrder"
    });
  });

  it("declares the 29-day CDC lookback cap", () => {
    const { provider } = makeProvider();
    expect(provider.pullLookbackDays).toBe(29);
  });

  it("fetches only pull-direction entities and normalizes changes", async () => {
    const { provider } = makeProvider();

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        CDCResponse: [
          {
            QueryResponse: [
              {
                Customer: [
                  {
                    Id: "63",
                    MetaData: { LastUpdatedTime: "2026-07-08T13:07:59-07:00" }
                  }
                ],
                Invoice: [{ Id: "7", status: "Deleted", MetaData: {} }]
              }
            ]
          }
        ]
      })
    );

    const result = await provider.listChanges({
      since: "2026-07-08T00:00:00.000Z"
    });

    // DEFAULT_SYNC_CONFIG: customer/vendor/invoice/bill are two-way; item
    // and purchaseOrder are push-only and never requested
    const cdcUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(cdcUrl).toContain(
      `entities=${encodeURIComponent("Customer,Vendor,Invoice,Bill")}`
    );

    expect(result.changes).toEqual([
      {
        entityType: "customer",
        remoteId: "63",
        updatedAt: "2026-07-08T13:07:59-07:00",
        deleted: false
      },
      {
        entityType: "invoice",
        remoteId: "7",
        updatedAt: null,
        deleted: true
      }
    ]);
  });

  it("returns no changes without an API call when nothing has a pull direction", async () => {
    const { provider } = makeProvider();
    const pushOnlyConfig = structuredClone(DEFAULT_SYNC_CONFIG);
    for (const entityConfig of Object.values(pushOnlyConfig.entities)) {
      entityConfig.direction = "push-to-accounting";
    }
    const pushOnly = new QboProvider({
      companyId: "company-1",
      clientId: "client-id",
      clientSecret: "client-secret",
      accessToken: "token",
      refreshToken: "refresh",
      realmId: REALM_ID,
      syncConfig: pushOnlyConfig,
      onTokenRefresh: async () => undefined
    });

    const result = await pushOnly.listChanges({
      since: "2026-07-08T00:00:00.000Z"
    });
    expect(result.changes).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    void provider;
  });
});
