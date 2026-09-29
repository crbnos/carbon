import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  foldNetSuiteCredentials,
  unfoldNetSuiteCredentials
} from "../../../netsuite/credentials";
import { DEFAULT_SYNC_CONFIG } from "../../core/models";
import { JournalEntrySyncError } from "../../core/posting";
import type { Accounting, ProviderCredentials } from "../../core/types";
import { AccountingApiError } from "../../core/utils";
import {
  netSuiteSignatureBaseString,
  netsuiteOrigin,
  netsuiteRealm,
  oauthEncode,
  signNetSuiteRequest
} from "./auth";
import {
  mapJournalEntryToNetSuiteJournalEntry,
  sumNetSuiteJournalDebitTotals
} from "./journal";
import { buildNetSuiteSyncConfig, NetSuiteProvider } from "./provider";

const TBA: ProviderCredentials = {
  type: "tba",
  accountId: "1234567-sb1",
  consumerKey: "ck",
  consumerSecret: "cs",
  tokenId: "tk",
  tokenSecret: "ts"
};

function journal(
  overrides?: Partial<Accounting.JournalEntry>
): Accounting.JournalEntry {
  return {
    id: "je-1",
    companyId: "co",
    journalEntryId: "JE0001",
    description: "Purchase Receipt",
    postingDate: "2026-07-01",
    status: "Posted",
    sourceType: "Purchase Receipt",
    reversalOfId: null,
    reversedById: null,
    reversal: false,
    lines: [
      { id: "l1", accountId: "a1", amount: 10.1, description: null },
      { id: "l2", accountId: "a2", amount: -10.1, description: "credit line" }
    ],
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides
  };
}

describe("token-based auth", () => {
  it("normalizes the account id for the host and the realm", () => {
    expect(netsuiteOrigin("1234567_SB1")).toBe(
      "https://1234567-sb1.suitetalk.api.netsuite.com"
    );
    expect(netsuiteRealm("1234567-sb1")).toBe("1234567_SB1");
  });

  it("signs the exact request url", () => {
    const url =
      "https://1234567-sb1.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql?limit=1&offset=0";
    const base = netSuiteSignatureBaseString({
      method: "POST",
      url,
      consumerKey: "ck",
      tokenId: "tk",
      nonce: "n",
      timestamp: "1700000000"
    });

    const params = [
      "limit=1",
      "oauth_consumer_key=ck",
      "oauth_nonce=n",
      "oauth_signature_method=HMAC-SHA256",
      "oauth_timestamp=1700000000",
      "oauth_token=tk",
      "oauth_version=1.0",
      "offset=0"
    ].join("&");
    expect(base).toBe(
      [
        "POST",
        oauthEncode(url.slice(0, url.indexOf("?"))),
        oauthEncode(params)
      ].join("&")
    );

    const signed = signNetSuiteRequest({
      method: "POST",
      url,
      realm: "1234567_SB1",
      consumerKey: "ck",
      consumerSecret: "cs",
      tokenId: "tk",
      tokenSecret: "ts",
      nonce: "n",
      timestamp: "1700000000"
    });
    const signature = createHmac("sha256", "cs&ts")
      .update(base)
      .digest("base64");
    expect(signed.authorization).toContain('realm="1234567_SB1"');
    expect(signed.authorization).toContain(
      `oauth_signature="${oauthEncode(signature)}"`
    );
  });
});

describe("credentials form", () => {
  it("folds the flat fields into tba credentials and unfolds them", () => {
    const folded = foldNetSuiteCredentials({
      accountId: " 1234567-sb1 ",
      consumerKey: "ck",
      consumerSecret: "cs",
      tokenId: "tk",
      tokenSecret: "ts",
      subsidiaryId: " 3 "
    });

    expect(folded.credentials).toEqual({
      type: "tba",
      accountId: "1234567-sb1",
      consumerKey: "ck",
      consumerSecret: "cs",
      tokenId: "tk",
      tokenSecret: "ts",
      providerMetadata: { subsidiaryId: "3" }
    });
    expect(unfoldNetSuiteCredentials(folded).accountId).toBe("1234567-sb1");
    expect(unfoldNetSuiteCredentials(folded).subsidiaryId).toBe("3");
  });

  it("leaves metadata alone when the account id is missing", () => {
    const metadata = { consumerKey: "ck" };
    expect(foldNetSuiteCredentials(metadata)).toBe(metadata);
  });
});

describe("sync config", () => {
  it("pushes journals and leaves the other entities off", () => {
    const config = buildNetSuiteSyncConfig(DEFAULT_SYNC_CONFIG);
    expect(config.entities.journalEntry.enabled).toBe(true);
    expect(config.entities.journalEntry.direction).toBe("push-to-accounting");
    expect(config.entities.invoice.enabled).toBe(false);
    expect(config.entities.bill.enabled).toBe(false);
    expect(config.entities.customer.enabled).toBe(false);
    expect(config.entities.payment.enabled).toBe(false);
  });
});

describe("journal payload", () => {
  const accounts = new Map([
    ["a1", "11"],
    ["a2", "22"]
  ]);

  it("splits debit and credit and stamps the subsidiary", () => {
    const payload = mapJournalEntryToNetSuiteJournalEntry({
      journal: journal(),
      accountIdsById: accounts,
      currencyId: "1",
      subsidiaryId: "3",
      pushDate: "2026-07-01"
    });

    expect(payload).toEqual({
      externalId: "je-1",
      tranDate: "2026-07-01",
      memo: "Purchase Receipt",
      currency: { id: "1" },
      subsidiary: { id: "3" },
      line: {
        items: [
          { account: { id: "11" }, debit: 10.1, memo: "Purchase Receipt" },
          {
            account: { id: "22" },
            credit: 10.1,
            memo: "credit line"
          }
        ]
      }
    });
  });

  it("negates a reversal and drops a zero line", () => {
    const payload = mapJournalEntryToNetSuiteJournalEntry({
      journal: journal({
        reversal: true,
        lines: [
          { id: "l1", accountId: "a1", amount: 5, description: null },
          { id: "l0", accountId: "a2", amount: 0, description: null }
        ]
      }),
      accountIdsById: accounts,
      currencyId: "1",
      subsidiaryId: null,
      pushDate: "2026-07-02",
      redatedFromDate: "2026-07-01"
    });

    expect(payload.externalId).toBe("je-1:reversal");
    expect(payload.memo).toBe(
      "Reversal of Purchase Receipt | original date 2026-07-01"
    );
    expect(payload.subsidiary).toBeUndefined();
    expect(payload.line.items).toEqual([
      { account: { id: "11" }, credit: 5, memo: "Purchase Receipt" }
    ]);
  });

  it("refuses an unmapped account", () => {
    expect(() =>
      mapJournalEntryToNetSuiteJournalEntry({
        journal: journal(),
        accountIdsById: new Map(),
        currencyId: "1",
        subsidiaryId: null,
        pushDate: "2026-07-01"
      })
    ).toThrow(JournalEntrySyncError);
  });
});

describe("sumNetSuiteJournalDebitTotals", () => {
  it("nets debit and credit by account id", () => {
    const totals = sumNetSuiteJournalDebitTotals({
      line: {
        items: [
          { account: { id: "11" }, debit: 10.1 },
          { account: { id: "11" }, credit: 0.1 },
          { account: { id: "22" }, credit: 10 }
        ]
      }
    });
    expect(totals.get("11")).toBe(10);
    expect(totals.get("22")).toBe(-10);
  });
});

describe("NetSuiteProvider", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  function provider() {
    return new NetSuiteProvider({
      companyId: "co",
      credentials: TBA,
      syncConfig: DEFAULT_SYNC_CONFIG
    });
  }

  it("lists postable accounts and follows hasMore", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            hasMore: true,
            items: [{ id: "1", acctnumber: "1000", fullname: "Cash" }]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            hasMore: false,
            items: [{ id: "2", fullname: "Opening balance" }]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

    await expect(provider().listChartOfAccounts()).resolves.toEqual([
      { id: "1", code: "1000", name: "Cash" },
      { id: "2", code: "2", name: "Opening balance" }
    ]);

    const firstUrl = String(fetchMock.mock.calls[0]?.[0]);
    const secondUrl = String(fetchMock.mock.calls[1]?.[0]);
    expect(firstUrl).toBe(
      "https://1234567-sb1.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql?limit=1000&offset=0"
    );
    expect(secondUrl).toContain("offset=1");
    const header = (
      fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>
    ).Authorization;
    expect(header).toEqual(expect.stringContaining('realm="1234567_SB1"'));
    expect(header?.startsWith("OAuth ")).toBe(true);
  });

  it("validate is false when SuiteQL is rejected", async () => {
    fetchMock.mockResolvedValue(
      new Response("no", { status: 401, statusText: "Unauthorized" })
    );
    await expect(provider().validate()).resolves.toBe(false);
  });

  it("reuses a journal that already has the external id", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "99" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    await expect(
      provider().upsertJournalEntry({
        externalId: "je-1",
        tranDate: "2026-07-01",
        currency: { id: "1" },
        line: { items: [] }
      })
    ).resolves.toBe("99");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/journalEntry/eid:je-1"
    );
  });

  it("treats a missing journal as absent and fails any other lookup", async () => {
    fetchMock.mockResolvedValueOnce(new Response("missing", { status: 404 }));
    await expect(provider().getJournalEntry("9")).resolves.toBeNull();

    fetchMock.mockResolvedValueOnce(
      new Response("down", { status: 500, statusText: "Server Error" })
    );
    await expect(provider().getJournalEntry("9")).rejects.toBeInstanceOf(
      AccountingApiError
    );
  });

  it("creates a journal when the external id is missing", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("missing", { status: 404 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "100" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );

    await expect(
      provider().upsertJournalEntry({
        externalId: "je-1",
        tranDate: "2026-07-01",
        currency: { id: "1" },
        line: { items: [] }
      })
    ).resolves.toBe("100");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not create a journal when the external-id lookup fails", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("down", { status: 500, statusText: "Server Error" })
    );
    await expect(
      provider().upsertJournalEntry({
        externalId: "je-1",
        tranDate: "2026-07-01",
        currency: { id: "1" },
        line: { items: [] }
      })
    ).rejects.toBeInstanceOf(AccountingApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns no accounts when the call fails", async () => {
    fetchMock.mockResolvedValue(new Response("no", { status: 500 }));
    await expect(provider().listChartOfAccounts()).resolves.toEqual([]);
  });
});
