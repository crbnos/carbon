// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  INTERNAL_CALL_WINDOW_MS,
  signInternalCall,
  verifyInternalCall
} from "./internal-call";

const SECRET = "session-secret";
const NOW = 1_800_000_000_000;
const body = JSON.stringify({ type: "jobOperation", id: "op1", quantity: 2 });
const call = {
  name: "issue",
  companyId: "c1",
  userId: "u1",
  mode: "system" as const
};

function signed(overrides: Record<string, string> = {}, authorization = "") {
  return new Headers({
    ...signInternalCall(
      SECRET,
      { ...call, mode: authorization ? "caller" : "system" },
      body,
      authorization,
      NOW
    ),
    ...overrides
  });
}

describe("internal calls", () => {
  it("accepts what the secret signed, with its nonce", () => {
    const verified = verifyInternalCall(SECRET, "issue", signed(), body, NOW);
    expect(verified).toMatchObject(call);
    expect(verified?.nonce).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("gives every call its own nonce", () => {
    const a = signed().get("x-carbon-nonce");
    expect(a).not.toBe(signed().get("x-carbon-nonce"));
  });

  it("refuses another secret, another posting, another body", () => {
    expect(
      verifyInternalCall("other", "issue", signed(), body, NOW)
    ).toBeNull();
    expect(
      verifyInternalCall(SECRET, "post-picking", signed(), body, NOW)
    ).toBeNull();
    expect(
      verifyInternalCall(SECRET, "issue", signed(), `${body} `, NOW)
    ).toBeNull();
  });

  it("refuses a changed company, user or mode", () => {
    for (const header of ["x-carbon-company", "x-carbon-user"]) {
      expect(
        verifyInternalCall(
          SECRET,
          "issue",
          signed({ [header]: "x" }),
          body,
          NOW
        )
      ).toBeNull();
    }
    expect(
      verifyInternalCall(
        SECRET,
        "issue",
        signed({ "x-carbon-mode": "caller", authorization: "Bearer t" }),
        body,
        NOW
      )
    ).toBeNull();
  });

  it("refuses a call outside the window, either way", () => {
    const headers = signed();
    expect(
      verifyInternalCall(
        SECRET,
        "issue",
        headers,
        body,
        NOW + INTERNAL_CALL_WINDOW_MS
      )
    ).not.toBeNull();
    expect(
      verifyInternalCall(
        SECRET,
        "issue",
        headers,
        body,
        NOW + INTERNAL_CALL_WINDOW_MS + 1
      )
    ).toBeNull();
    expect(
      verifyInternalCall(
        SECRET,
        "issue",
        headers,
        body,
        NOW - INTERNAL_CALL_WINDOW_MS - 1
      )
    ).toBeNull();
  });

  it("binds a caller-mode call to the token it was signed with", () => {
    const headers = signed({}, "Bearer token-a");
    expect(verifyInternalCall(SECRET, "issue", headers, body, NOW)?.mode).toBe(
      "caller"
    );
    headers.set("authorization", "Bearer token-b");
    expect(verifyInternalCall(SECRET, "issue", headers, body, NOW)).toBeNull();
    headers.delete("authorization");
    expect(verifyInternalCall(SECRET, "issue", headers, body, NOW)).toBeNull();
  });

  it("refuses an unsigned or garbled request", () => {
    expect(
      verifyInternalCall(SECRET, "issue", new Headers(), body, NOW)
    ).toBeNull();
    expect(
      verifyInternalCall(
        SECRET,
        "issue",
        signed({ "x-carbon-signature": "nope" }),
        body,
        NOW
      )
    ).toBeNull();
    expect(
      verifyInternalCall(
        SECRET,
        "issue",
        signed({ "x-carbon-timestamp": "1e12" }),
        body,
        NOW
      )
    ).toBeNull();
  });

  it("will not sign a caller call without a token, or a system call with one", () => {
    expect(() =>
      signInternalCall(SECRET, { ...call, mode: "caller" }, body)
    ).toThrow();
    expect(() => signInternalCall(SECRET, call, body, "Bearer t")).toThrow();
  });
});
