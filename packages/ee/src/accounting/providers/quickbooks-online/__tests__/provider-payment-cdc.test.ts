import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SYNC_CONFIG } from "../../../core/models";
import { QboProvider } from "../provider";

const REALM_ID = "9130357849328710";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

// DEFAULT_SYNC_CONFIG has payment disabled, but the QBO constructor overlays
// buildQboSyncConfig which forces payment → pull-from-accounting + enabled, so
// the CDC sweep requests Payment/BillPayment.
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

describe("QboProvider.listChanges — payment CDC entries", () => {
  it("emits an AP `payment` change with the canonical bill: composite + bill dependency", async () => {
    // 1st fetch: /cdc → one BillPayment delta (identity only)
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        CDCResponse: [
          {
            QueryResponse: [
              {
                BillPayment: [
                  {
                    Id: "bp-1",
                    MetaData: { LastUpdatedTime: "2026-08-01T13:07:59-07:00" }
                  }
                ]
              }
            ]
          }
        ]
      })
    );
    // 2nd fetch: GET /billpayment/bp-1 → the full object (LinkedTxn → bill)
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        BillPayment: {
          Id: "bp-1",
          TotalAmt: 500,
          TxnDate: "2026-08-01",
          CurrencyRef: { value: "USD" },
          Line: [
            { Amount: 500, LinkedTxn: [{ TxnId: "bill-9", TxnType: "Bill" }] }
          ],
          MetaData: { LastUpdatedTime: "2026-08-01T13:07:59-07:00" }
        }
      })
    );

    const result = await makeProvider().listChanges({
      since: "2026-07-15T00:00:00.000Z"
    });

    expect(result.changes).toEqual([
      {
        entityType: "payment",
        remoteId: "bill:bill-9:bp-1",
        updatedAt: new Date("2026-08-01T13:07:59-07:00").toISOString(),
        dependsOnMapping: { entityType: "bill", remoteId: "bill-9" }
      }
    ]);
  });

  it("emits an AR `payment` change with the prefix-less invoice composite", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        CDCResponse: [
          {
            QueryResponse: [
              {
                Payment: [
                  {
                    Id: "pay-1",
                    MetaData: { LastUpdatedTime: "2026-08-01T14:00:00-07:00" }
                  }
                ]
              }
            ]
          }
        ]
      })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        Payment: {
          Id: "pay-1",
          TotalAmt: 125,
          TxnDate: "2026-08-01",
          CurrencyRef: { value: "USD" },
          Line: [
            { Amount: 125, LinkedTxn: [{ TxnId: "inv-7", TxnType: "Invoice" }] }
          ],
          MetaData: { LastUpdatedTime: "2026-08-01T14:00:00-07:00" }
        }
      })
    );

    const result = await makeProvider().listChanges({
      since: "2026-07-15T00:00:00.000Z"
    });

    expect(result.changes).toEqual([
      {
        entityType: "payment",
        remoteId: "inv-7:pay-1",
        updatedAt: new Date("2026-08-01T14:00:00-07:00").toISOString(),
        dependsOnMapping: { entityType: "invoice", remoteId: "inv-7" }
      }
    ]);
  });

  it("emits a deleted-flagged bare-id change for a deleted payment tombstone (no refetch)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        CDCResponse: [
          {
            QueryResponse: [
              {
                BillPayment: [
                  {
                    Id: "bp-9",
                    status: "Deleted",
                    MetaData: { LastUpdatedTime: "2026-08-02T09:00:00-07:00" }
                  }
                ]
              }
            ]
          }
        ]
      })
    );

    const result = await makeProvider().listChanges({
      since: "2026-07-15T00:00:00.000Z"
    });

    // Deleted tombstone → a bare-id deleted-flagged change (no dependsOnMapping,
    // the settled document is unknown); the sweep resolves the composite from
    // the existing mapping and enqueues the void.
    expect(result.changes).toEqual([
      {
        entityType: "payment",
        remoteId: "bp-9",
        updatedAt: "2026-08-02T09:00:00-07:00",
        deleted: true
      }
    ]);
    // Only the CDC call — no refetch for a tombstone.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
