// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QboProvider } from "../providers/quickbooks-online";
import { RilletProvider } from "../providers/rillet";
import { XeroProvider } from "../providers/xero";
import { DEFAULT_SYNC_CONFIG } from "./models";
import { fetchRemoteTrialBalance } from "./remote-trial-balance";
import { isTrialBalanceProvider } from "./trial-balance";
import { AccountingApiError } from "./utils";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
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

function makeXero() {
  return new XeroProvider({
    companyId: "company-1",
    clientId: "client-id",
    clientSecret: "client-secret",
    accessToken: "token",
    refreshToken: "refresh",
    tenantId: "tenant-1",
    syncConfig: DEFAULT_SYNC_CONFIG
  });
}

function makeQbo() {
  return new QboProvider({
    companyId: "company-1",
    clientId: "client-id",
    clientSecret: "client-secret",
    accessToken: "token",
    refreshToken: "refresh",
    realmId: "realm-1",
    syncConfig: DEFAULT_SYNC_CONFIG
  });
}

describe("fetchRemoteTrialBalance", () => {
  it("reads Xero's trial balance as at the date", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        Reports: [
          {
            Rows: [
              {
                RowType: "Header",
                Cells: [
                  { Value: "Account" },
                  { Value: "Debit" },
                  { Value: "Credit" },
                  { Value: "YTD Debit" },
                  { Value: "YTD Credit" }
                ]
              },
              {
                RowType: "Section",
                Title: "Assets",
                Rows: [
                  {
                    RowType: "Row",
                    Cells: [
                      {
                        Value: "Bank (090)",
                        Attributes: [{ Id: "account", Value: "acc-bank" }]
                      },
                      { Value: "" },
                      { Value: "" },
                      { Value: "500.00" },
                      { Value: "" }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      })
    );

    const result = await fetchRemoteTrialBalance(makeXero(), "2026-09-30");

    expect(result).toEqual({
      supported: true,
      rows: [
        { externalId: "acc-bank", code: "090", name: "Bank", debitSigned: 500 }
      ]
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://api.xero.com/api.xro/2.0/Reports/TrialBalance?date=2026-09-30"
    );
    expect(init?.method).toBe("GET");
  });

  it("throws an AccountingApiError carrying a Xero 403 (token without the report scope)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ Title: "Forbidden", Status: 403 }, 403)
    );

    const error = await fetchRemoteTrialBalance(makeXero(), "2026-09-30").catch(
      (e: unknown) => e
    );

    expect(error).toBeInstanceOf(AccountingApiError);
    expect((error as AccountingApiError).details.statusCode).toBe(403);
  });

  it("reads QuickBooks Online's accrual trial balance ending at the date", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        Columns: {
          Column: [
            { ColTitle: "", ColType: "Account" },
            { ColTitle: "Debit", ColType: "Money" },
            { ColTitle: "Credit", ColType: "Money" }
          ]
        },
        Rows: {
          Row: [
            {
              ColData: [
                { value: "Sales", id: "79" },
                { value: "" },
                { value: "900.00" }
              ]
            }
          ]
        }
      })
    );

    const result = await fetchRemoteTrialBalance(makeQbo(), "2026-09-30");

    expect(result).toEqual({
      supported: true,
      rows: [{ externalId: "79", code: null, name: "Sales", debitSigned: -900 }]
    });
    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.pathname).toBe("/v3/company/realm-1/reports/TrialBalance");
    expect(url.searchParams.get("end_date")).toBe("2026-09-30");
    expect(url.searchParams.get("accounting_method")).toBe("Accrual");
    expect(url.searchParams.has("minorversion")).toBe(true);
  });

  it("reports Rillet as unsupported without calling it", async () => {
    const rillet = new RilletProvider({
      companyId: "company-1",
      credentials: { type: "apiKey", apiKey: "key", environment: "production" },
      syncConfig: DEFAULT_SYNC_CONFIG
    });

    expect(await fetchRemoteTrialBalance(rillet, "2026-09-30")).toEqual({
      supported: false
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("offers the pull for exactly the providers it reads", () => {
    // The wizard shows the button by `isTrialBalanceProvider`; the tests
    // above show which providers `fetchRemoteTrialBalance` reads.
    const rillet = new RilletProvider({
      companyId: "company-1",
      credentials: { type: "apiKey", apiKey: "key", environment: "production" },
      syncConfig: DEFAULT_SYNC_CONFIG
    });
    expect(isTrialBalanceProvider(makeXero().id)).toBe(true);
    expect(isTrialBalanceProvider(makeQbo().id)).toBe(true);
    expect(isTrialBalanceProvider(rillet.id)).toBe(false);
  });
});
