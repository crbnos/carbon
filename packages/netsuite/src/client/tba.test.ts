import { describe, expect, it } from "vitest";

import { accountHostLabel, accountRealm, restBaseUrl } from "./account.ts";
import { percentEncode, signTbaRequest } from "./tba.ts";

const credentials = {
  accountId: "1234567_SB1",
  consumerKey: "ck",
  consumerSecret: "cs",
  tokenId: "tk",
  tokenSecret: "ts"
};

describe("account identifiers", () => {
  it("derives the DNS label and the OAuth realm from either input form", () => {
    expect(accountHostLabel("1234567_SB1")).toBe("1234567-sb1");
    expect(accountRealm("1234567-sb1")).toBe("1234567_SB1");
    // Idempotent: feeding a value back through its own derivation is a no-op.
    expect(accountHostLabel(accountHostLabel("1234567_SB1"))).toBe(
      "1234567-sb1"
    );
    expect(restBaseUrl("1234567_SB1")).toBe(
      "https://1234567-sb1.suitetalk.api.netsuite.com/services/rest"
    );
  });
});

describe("percentEncode", () => {
  it("escapes the characters encodeURIComponent leaves alone", () => {
    expect(percentEncode("!*'()")).toBe("%21%2A%27%28%29");
    expect(percentEncode("a b+c/d")).toBe("a%20b%2Bc%2Fd");
  });
});

describe("signTbaRequest", () => {
  it("is deterministic for a fixed nonce and timestamp", () => {
    const header = signTbaRequest(
      credentials,
      "GET",
      "https://x.suitetalk.api.netsuite.com/a",
      {
        nonce: "n",
        timestamp: 1_700_000_000
      }
    );
    const again = signTbaRequest(
      credentials,
      "GET",
      "https://x.suitetalk.api.netsuite.com/a",
      {
        nonce: "n",
        timestamp: 1_700_000_000
      }
    );
    expect(header).toBe(again);
  });

  it("uses the uppercase underscore realm, not the DNS label", () => {
    const header = signTbaRequest(
      credentials,
      "GET",
      "https://x.example.com/a",
      {
        nonce: "n",
        timestamp: 1
      }
    );
    expect(header.startsWith('OAuth realm="1234567_SB1"')).toBe(true);
  });

  it("signs over query parameters, so reordering them keeps one signature", () => {
    const a = signTbaRequest(
      credentials,
      "GET",
      "https://x.example.com/a?limit=1&offset=2",
      {
        nonce: "n",
        timestamp: 1
      }
    );
    const b = signTbaRequest(
      credentials,
      "GET",
      "https://x.example.com/a?offset=2&limit=1",
      {
        nonce: "n",
        timestamp: 1
      }
    );
    expect(a).toBe(b);

    const different = signTbaRequest(
      credentials,
      "GET",
      "https://x.example.com/a?limit=2&offset=2",
      { nonce: "n", timestamp: 1 }
    );
    expect(different).not.toBe(a);
  });

  it("produces a different signature per HTTP method", () => {
    const get = signTbaRequest(credentials, "GET", "https://x.example.com/a", {
      nonce: "n",
      timestamp: 1
    });
    const post = signTbaRequest(
      credentials,
      "POST",
      "https://x.example.com/a",
      {
        nonce: "n",
        timestamp: 1
      }
    );
    expect(get).not.toBe(post);
  });
});
