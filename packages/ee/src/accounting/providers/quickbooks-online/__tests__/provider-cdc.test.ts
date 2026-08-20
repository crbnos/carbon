import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SYNC_CONFIG } from "../../../core/models";
import { AccountingApiError } from "../../../core/utils";
import { isQboDuplicateNameError, QboProvider } from "../provider";

const REALM_ID = "9130357849328710";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function makeProvider() {
  return new QboProvider({
    companyId: "company-1",
    clientId: "client-id",
    clientSecret: "client-secret",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    realmId: REALM_ID,
    syncConfig: DEFAULT_SYNC_CONFIG,
    onTokenRefresh: vi.fn(async () => undefined)
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
  return decodeURIComponent(String(fetchMock.mock.calls[callIndex]?.[0]));
}

/**
 * Realistic CDC envelope: one QueryResponse per changed entity type, mixing
 * full objects (whose extra fields the minimal parse ignores) with a
 * `status: "Deleted"` tombstone stub.
 */
const CDC_FIXTURE = {
  CDCResponse: [
    {
      QueryResponse: [
        {
          Customer: [
            {
              Id: "63",
              SyncToken: "4",
              DisplayName: "Acme Machining",
              Active: true,
              MetaData: {
                CreateTime: "2026-06-01T09:00:00-07:00",
                LastUpdatedTime: "2026-07-08T13:07:59-07:00"
              }
            },
            {
              domain: "QBO",
              status: "Deleted",
              Id: "77",
              MetaData: { LastUpdatedTime: "2026-07-08T14:00:00-07:00" }
            }
          ],
          startPosition: 1,
          maxResults: 2
        },
        {
          Vendor: [
            {
              Id: "41",
              SyncToken: "1",
              DisplayName: "Bolts R Us",
              MetaData: { LastUpdatedTime: "2026-07-08T10:30:00-07:00" }
            }
          ],
          startPosition: 1,
          maxResults: 1
        },
        {
          Invoice: [
            {
              Id: "145",
              SyncToken: "2",
              CustomerRef: { value: "63" },
              Line: [],
              MetaData: { LastUpdatedTime: "2026-07-08T15:45:12-07:00" }
            }
          ],
          startPosition: 1,
          maxResults: 1
        }
      ]
    }
  ],
  time: "2026-07-08T16:00:00-07:00"
};

describe("QboProvider.changeDataCapture", () => {
  it("requests /cdc with the entity list + changedSince and normalizes mixed entities including Deleted stubs", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(CDC_FIXTURE));

    const provider = makeProvider();
    const changes = await provider.changeDataCapture(
      ["Customer", "Vendor", "Invoice"],
      "2026-07-01T00:00:00.000Z"
    );

    expect(requestUrl(0)).toContain(`/v3/company/${REALM_ID}/cdc`);
    expect(requestUrl(0)).toContain("entities=Customer,Vendor,Invoice");
    expect(requestUrl(0)).toContain("changedSince=2026-07-01T00:00:00.000Z");
    expect(requestUrl(0)).toContain("minorversion=75");

    expect(changes).toEqual([
      {
        entityName: "Customer",
        id: "63",
        deleted: false,
        lastUpdatedTime: "2026-07-08T13:07:59-07:00"
      },
      {
        entityName: "Customer",
        id: "77",
        deleted: true,
        lastUpdatedTime: "2026-07-08T14:00:00-07:00"
      },
      {
        entityName: "Vendor",
        id: "41",
        deleted: false,
        lastUpdatedTime: "2026-07-08T10:30:00-07:00"
      },
      {
        entityName: "Invoice",
        id: "145",
        deleted: false,
        lastUpdatedTime: "2026-07-08T15:45:12-07:00"
      }
    ]);
  });

  it("returns [] for an empty CDC window", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        CDCResponse: [{ QueryResponse: [] }],
        time: "2026-07-08T16:00:00-07:00"
      })
    );

    const provider = makeProvider();
    await expect(
      provider.changeDataCapture(["Customer"], "2026-07-01T00:00:00.000Z")
    ).resolves.toEqual([]);
  });

  it("skips records that fail the minimal identity parse and keeps the rest", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        CDCResponse: [
          {
            QueryResponse: [
              {
                Customer: [
                  { DisplayName: "No id — unparseable" },
                  {
                    Id: "88",
                    DisplayName: "Kept",
                    // No MetaData: still processable, timestamp is null
                    SyncToken: "0"
                  }
                ]
              }
            ]
          }
        ]
      })
    );

    const provider = makeProvider();
    const changes = await provider.changeDataCapture(
      ["Customer"],
      "2026-07-01T00:00:00.000Z"
    );

    expect(changes).toEqual([
      {
        entityName: "Customer",
        id: "88",
        deleted: false,
        lastUpdatedTime: null
      }
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("throws a structured AccountingApiError carrying the Intuit fault on failure", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          Fault: {
            Error: [
              {
                Message: "Invalid query",
                Detail: "changedSince cannot be more than 30 days ago",
                code: "4000"
              }
            ],
            type: "ValidationFault"
          }
        },
        400
      )
    );

    const provider = makeProvider();

    let thrown: unknown;
    try {
      await provider.changeDataCapture(
        ["Customer"],
        "2026-01-01T00:00:00.000Z"
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AccountingApiError);
    expect((thrown as AccountingApiError).details.providerErrorCode).toBe(
      "4000"
    );
    // Sanity: the fault-code classifiers see the same structured details
    expect(isQboDuplicateNameError(thrown)).toBe(false);
  });
});
